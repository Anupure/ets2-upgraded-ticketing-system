import {
  Prisma, PrismaClient, JourneyStatus, TicketStatus, SeatReservationStatus,
  UserRole, UserStatus,
} from "@prisma/client";
import { BookingError } from "./errors.js";

type Db = PrismaClient;
const visibleTicketStatuses: TicketStatus[] = [
  TicketStatus.CONFIRMED, TicketStatus.CHECKED_IN, TicketStatus.BOARDED,
  TicketStatus.COMPLETED, TicketStatus.NO_SHOW, TicketStatus.LEFT_BEHIND,
];
const activeReservationStatuses: SeatReservationStatus[] = [
  SeatReservationStatus.HELD, SeatReservationStatus.CONFIRMED, SeatReservationStatus.OCCUPIED,
];

async function requireOperator(db: Prisma.TransactionClient | PrismaClient, operatorId: string) {
  const actor = await db.user.findUnique({
    where: { id: operatorId }, select: { id: true, role: true, status: true },
  });
  if (!actor || actor.status !== UserStatus.ACTIVE ||
      actor.role !== UserRole.OPERATOR && actor.role !== UserRole.ADMIN) {
    throw new BookingError("OPERATOR_REQUIRED", "Only an active operator or administrator can access the operator dashboard.");
  }
}

/**
 * Operator-only overview. This intentionally returns no email, wallet data,
 * auth/session data, or private ticket credentials.
 */
export async function getOperatorDashboard(db: Db, operatorId: string, journeyId: string) {
  await requireOperator(db, operatorId);
  const journey = await db.journey.findUnique({
    where: { id: journeyId },
    include: {
      stops: { orderBy: { sequence: "asc" } },
      busLayout: {
        select: {
          id: true, name: true, capacity: true,
          seats: { select: { id: true, isBookable: true } },
        },
      },
    },
  });
  if (!journey) throw new BookingError("JOURNEY_NOT_OPEN", "Journey not found.");

  const tickets = await db.ticket.findMany({
    where: { journeyId },
    select: {
      id: true, status: true, originStopId: true, destinationStopId: true,
      originStop: { select: { sequence: true } },
      destinationStop: { select: { sequence: true } },
      seatReservations: {
        where: { status: { in: activeReservationStatuses } },
        select: { seatId: true, status: true, fromSequence: true, toSequence: true },
      },
    },
  });

  const counts = Object.fromEntries(
    Object.values(TicketStatus).map((status) => [status, 0]),
  ) as Record<TicketStatus, number>;
  for (const ticket of tickets) counts[ticket.status] += 1;

  const currentSequence = journey.currentStopSequence;
  const currentLegReservations = currentSequence === null ? [] : tickets.flatMap((ticket) =>
    ticket.seatReservations.filter((reservation) =>
      reservation.fromSequence <= currentSequence && reservation.toSequence > currentSequence &&
      (reservation.status === SeatReservationStatus.CONFIRMED || reservation.status === SeatReservationStatus.OCCUPIED || reservation.status === SeatReservationStatus.HELD),
    ),
  );

  return {
    journey: {
      id: journey.id,
      journeyNumber: journey.journeyNumber.toString(),
      name: journey.name,
      status: journey.status,
      ticketPrice: journey.ticketPrice.toString(),
      currentStopSequence: journey.currentStopSequence,
      departureAt: journey.departureAt,
      startedAt: journey.startedAt,
      completedAt: journey.completedAt,
    },
    bus: {
      id: journey.busLayout.id,
      name: journey.busLayout.name,
      capacity: journey.busLayout.capacity,
      configuredSeats: journey.busLayout.seats.length,
      bookableSeats: journey.busLayout.seats.filter((seat) => seat.isBookable).length,
    },
    stops: journey.stops.map((stop) => ({
      id: stop.id, sequence: stop.sequence, name: stop.name,
      status: stop.status, arrivalAt: stop.arrivalAt, departedAt: stop.departedAt,
    })),
    passengerCounts: {
      totalTickets: tickets.length,
      byStatus: counts,
      currentLegReservedSeats: currentLegReservations.filter((r) => r.status !== SeatReservationStatus.HELD).length,
      currentLegOccupiedSeats: currentLegReservations.filter((r) => r.status === SeatReservationStatus.OCCUPIED).length,
    },
  };
}

/**
 * Operator-only manifest for one stop. Includes tickets whose travel segment
 * covers the stop, but only exposes seat numbers and basic passenger identity.
 */
export async function getPassengerManifest(
  db: Db, operatorId: string, journeyId: string, stopId: string,
) {
  await requireOperator(db, operatorId);
  const stop = await db.journeyStop.findFirst({
    where: { id: stopId, journeyId },
    select: { id: true, sequence: true, name: true, status: true },
  });
  if (!stop) throw new BookingError("INVALID_SEGMENT", "Stop does not belong to this journey.");

  const tickets = await db.ticket.findMany({
    where: {
      journeyId,
      status: { in: visibleTicketStatuses },
      originStop: { sequence: { lte: stop.sequence } },
      destinationStop: { sequence: { gte: stop.sequence } },
    },
    orderBy: [{ purchasedAt: "asc" }],
    select: {
      id: true, ticketNumber: true, status: true, purchasedAt: true, checkedInAt: true, boardedAt: true, completedAt: true,
      user: {
        select: {
          displayName: true,
          avatar: { select: { imageUrl: true, name: true } },
        },
      },
      originStop: { select: { id: true, name: true, sequence: true } },
      destinationStop: { select: { id: true, name: true, sequence: true } },
      seatReservations: {
        where: { status: { in: activeReservationStatuses } },
        select: {
          status: true, fromSequence: true, toSequence: true,
          seat: { select: { seatNumber: true } },
        },
      },
      passengerJourney: { select: { status: true, actualBoardedAt: true, actualDisembarkedAt: true } },
    },
  });

  return {
    stop,
    passengers: tickets.map((ticket) => {
      const reservation = ticket.seatReservations.find((item) =>
        item.fromSequence <= stop.sequence && item.toSequence > stop.sequence,
      );
      return {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        ticketStatus: ticket.status,
        passengerStatus: ticket.passengerJourney?.status ?? null,
        displayName: ticket.user.displayName,
        avatarUrl: ticket.user.avatar?.imageUrl ?? null,
        avatarName: ticket.user.avatar?.name ?? null,
        seatNumber: reservation?.seat.seatNumber ?? null,
        seatReservationStatus: reservation?.status ?? null,
        origin: ticket.originStop,
        destination: ticket.destinationStop,
        stopAction: ticket.originStop.sequence === stop.sequence
          ? "BOARD"
          : ticket.destinationStop.sequence === stop.sequence ? "ALIGHT" : "ONBOARD",
        purchasedAt: ticket.purchasedAt,
        checkedInAt: ticket.checkedInAt,
        boardedAt: ticket.boardedAt,
        completedAt: ticket.completedAt,
        actualBoardedAt: ticket.passengerJourney?.actualBoardedAt ?? null,
        actualDisembarkedAt: ticket.passengerJourney?.actualDisembarkedAt ?? null,
      };
    }),
  };
}
