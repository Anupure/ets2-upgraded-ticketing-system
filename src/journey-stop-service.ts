import {
  Prisma, PrismaClient, JourneyStatus, StopStatus, UserRole, UserStatus,
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
 * Mark arrival at the current stop. For the first stop, a journey must have
 * ticket sales closed (BOOKING_OPEN); later arrivals require IN_PROGRESS.
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
    const isFirstArrival = journey.status === JourneyStatus.BOOKING_OPEN &&
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
