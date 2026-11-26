import {
  Prisma, PrismaClient, JourneyStatus, TicketStatus, StopStatus, UserRole, UserStatus,
} from "@prisma/client";
import { BookingError } from "./errors.js";

type Db = PrismaClient;

async function lockJourney(tx: Prisma.TransactionClient, journeyId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM journeys WHERE id = ${journeyId}::uuid FOR UPDATE
  `;
  if (rows.length === 0) throw new BookingError("JOURNEY_NOT_OPEN", "Journey not found.");
}

async function requireOperator(tx: Prisma.TransactionClient, operatorId: string) {
  const user = await tx.user.findUnique({
    where: { id: operatorId }, select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== UserStatus.ACTIVE ||
      user.role !== UserRole.OPERATOR && user.role !== UserRole.ADMIN) {
    throw new BookingError("BOARDING_NOT_ALLOWED", "Only an active operator or administrator can control journey stops.");
  }
}

async function recordStopEvent(
  tx: Prisma.TransactionClient, journeyId: string, operatorId: string,
  eventType: string, stopId: string, sequence: number,
) {
  await tx.journeyEvent.create({
    data: { journeyId, actorId: operatorId, eventType, payload: { stopId, stopSequence: sequence } },
  });
}

/**
 * Close ticket sales and lock the journey before the operator starts the route.
 * PAUSED with no current stop is the explicit pre-departure/booking-closed state.
 */
export async function closeBooking(db: Db, operatorId: string, journeyId: string) {
  return db.$transaction(async (tx) => {
    await requireOperator(tx, operatorId);
    await lockJourney(tx, journeyId);
    const journey = await tx.journey.findUnique({ where: { id: journeyId } });
    if (!journey) throw new BookingError("JOURNEY_NOT_OPEN", "Journey not found.");
    if (journey.status === JourneyStatus.PAUSED && journey.currentStopSequence === null) {
      return { journey, alreadyClosed: true };
    }
    if (journey.status !== JourneyStatus.BOOKING_OPEN || journey.currentStopSequence !== null) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "Only an open-booking journey that has not started can be closed.");
    }
    const updated = await tx.journey.update({
      where: { id: journeyId }, data: { status: JourneyStatus.PAUSED },
    });
    await tx.journeyEvent.create({
      data: { journeyId, actorId: operatorId, eventType: "journey.booking_closed", payload: {} },
    });
    return { journey: updated, alreadyClosed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Mark arrival at the current stop. For the first stop, a journey must have
 * ticket sales closed (PAUSED with no current stop); later arrivals require IN_PROGRESS.
 */
export async function arriveAtStop(db: Db, operatorId: string, journeyId: string, stopId: string) {
  return db.$transaction(async (tx) => {
    await requireOperator(tx, operatorId);
    await lockJourney(tx, journeyId);
    const journey = await tx.journey.findUnique({
      where: { id: journeyId }, include: { stops: { orderBy: { sequence: "asc" } } },
    });
    if (!journey) throw new BookingError("JOURNEY_NOT_OPEN", "Journey not found.");
    const stop = journey.stops.find((item) => item.id === stopId);
    if (!stop) throw new BookingError("INVALID_SEGMENT", "Stop does not belong to this journey.");
    if (stop.status === StopStatus.ARRIVED || stop.status === StopStatus.BOARDING_OPEN) {
      return { journey, stop, alreadyArrived: true };
    }
    const firstStop = journey.stops[0];
    const isFirstArrival = journey.status === JourneyStatus.PAUSED &&
      journey.currentStopSequence === null && firstStop?.id === stopId &&
      stop.status === StopStatus.UPCOMING;
    const isNextArrival = journey.status === JourneyStatus.IN_PROGRESS &&
      journey.currentStopSequence !== null &&
      stop.sequence === journey.currentStopSequence + 1 &&
      stop.status === StopStatus.UPCOMING;
    if (!isFirstArrival && !isNextArrival) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "Only the first stop after ticket sales close, or the next stop after departure, can be marked arrived.");
    }

    const now = new Date();
    await tx.journeyStop.update({
      where: { id: stopId }, data: { status: StopStatus.ARRIVED, arrivalAt: now },
    });
    const updatedJourney = await tx.journey.update({
      where: { id: journeyId },
      data: {
        status: JourneyStatus.PAUSED,
        currentStopSequence: stop.sequence,
        ...(isFirstArrival ? { startedAt: now } : {}),
      },
    });
    await recordStopEvent(tx, journeyId, operatorId, "journey.stop_arrived", stopId, stop.sequence);
    return {
      journey: updatedJourney,
      stop: await tx.journeyStop.findUniqueOrThrow({ where: { id: stopId } }),
      alreadyArrived: false,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Open the passenger check-in and physical boarding window at the arrived stop. */
export async function openBoardingAtStop(db: Db, operatorId: string, journeyId: string, stopId: string) {
  return db.$transaction(async (tx) => {
    await requireOperator(tx, operatorId);
    await lockJourney(tx, journeyId);
    const journey = await tx.journey.findUnique({ where: { id: journeyId } });
    if (!journey) throw new BookingError("JOURNEY_NOT_OPEN", "Journey not found.");
    const stop = await tx.journeyStop.findFirst({ where: { id: stopId, journeyId } });
    if (!stop) throw new BookingError("INVALID_SEGMENT", "Stop does not belong to this journey.");
    if (stop.status === StopStatus.BOARDING_OPEN && journey.status === JourneyStatus.BOARDING) {
      return { journey, stop, alreadyOpen: true };
    }
    if (stop.status !== StopStatus.ARRIVED || journey.currentStopSequence !== stop.sequence ||
        journey.status !== JourneyStatus.PAUSED) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "Boarding can open only at the current arrived stop.");
    }

    await tx.journeyStop.update({ where: { id: stopId }, data: { status: StopStatus.BOARDING_OPEN } });
    const updatedJourney = await tx.journey.update({
      where: { id: journeyId }, data: { status: JourneyStatus.BOARDING },
    });
    await recordStopEvent(tx, journeyId, operatorId, "journey.boarding_opened", stopId, stop.sequence);
    return {
      journey: updatedJourney,
      stop: await tx.journeyStop.findUniqueOrThrow({ where: { id: stopId } }),
      alreadyOpen: false,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Close boarding and depart. The next stop can only be arrived at after this
 * transition. At the final stop, complete the journey instead of advancing.
 */
export async function departStop(db: Db, operatorId: string, journeyId: string, stopId: string) {
  return db.$transaction(async (tx) => {
    await requireOperator(tx, operatorId);
    await lockJourney(tx, journeyId);
    const journey = await tx.journey.findUnique({
      where: { id: journeyId }, include: { stops: { orderBy: { sequence: "asc" } } },
    });
    if (!journey) throw new BookingError("JOURNEY_NOT_OPEN", "Journey not found.");
    const stop = journey.stops.find((item) => item.id === stopId);
    if (!stop) throw new BookingError("INVALID_SEGMENT", "Stop does not belong to this journey.");
    if (stop.status === StopStatus.DEPARTED) {
      return { journey, stop, alreadyDeparted: true };
    }
    if (stop.status !== StopStatus.BOARDING_OPEN ||
        journey.status !== JourneyStatus.BOARDING ||
        journey.currentStopSequence !== stop.sequence) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "The current stop must have an open boarding window before departure.");
    }

    const nextStop = journey.stops.find((item) => item.sequence > stop.sequence);
    const now = new Date();
    await tx.journeyStop.update({
      where: { id: stopId }, data: { status: StopStatus.DEPARTED, departedAt: now },
    });
    const updatedJourney = await tx.journey.update({
      where: { id: journeyId },
      data: nextStop
        ? { status: JourneyStatus.IN_PROGRESS, ...(stop.sequence === journey.stops[0]?.sequence ? { departureAt: now } : {}) }
        : { status: JourneyStatus.COMPLETED, completedAt: now },
    });
    await recordStopEvent(
      tx, journeyId, operatorId,
      nextStop ? "journey.stop_departed" : "journey.completed",
      stopId, stop.sequence,
    );
    return {
      journey: updatedJourney,
      stop: await tx.journeyStop.findUniqueOrThrow({ where: { id: stopId } }),
      nextStop: nextStop ?? null,
      alreadyDeparted: false,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}


/**
 * Complete the journey after arrival at its final stop and after every
 * passenger ticket has reached a terminal state. The coach does not need
 * to open another boarding window or depart the destination.
 */
export async function completeJourneyAtFinalStop(db: Db, operatorId: string, journeyId: string) {
  return db.$transaction(async (tx) => {
    await requireOperator(tx, operatorId);
    await lockJourney(tx, journeyId);
    const journey = await tx.journey.findUnique({
      where: { id: journeyId }, include: { stops: { orderBy: { sequence: "asc" } } },
    });
    if (!journey) throw new BookingError("JOURNEY_NOT_OPEN", "Journey not found.");
    if (journey.status === JourneyStatus.COMPLETED) {
      return { journey, alreadyCompleted: true };
    }

    const finalStop = journey.stops[journey.stops.length - 1];
    if (!finalStop || journey.status !== JourneyStatus.PAUSED ||
        journey.currentStopSequence !== finalStop.sequence ||
        finalStop.status !== StopStatus.ARRIVED) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "A journey can be completed only after arrival at its final stop.");
    }

    const unresolvedTickets = await tx.ticket.count({
      where: {
        journeyId,
        status: { in: [TicketStatus.CONFIRMED, TicketStatus.CHECKED_IN, TicketStatus.BOARDED] },
      },
    });
    if (unresolvedTickets > 0) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "Resolve all remaining passenger tickets before completing the journey.");
    }

    const now = new Date();
    const updated = await tx.journey.update({
      where: { id: journeyId },
      data: { status: JourneyStatus.COMPLETED, completedAt: now },
    });
    await tx.journeyEvent.create({
      data: {
        journeyId, actorId: operatorId, eventType: "journey.completed",
        payload: { finalStopId: finalStop.id, stopSequence: finalStop.sequence },
      },
    });
    return { journey: updated, alreadyCompleted: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
