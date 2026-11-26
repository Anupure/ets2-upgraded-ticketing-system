import {
  Prisma, PrismaClient, JourneyStatus, TicketStatus, SeatReservationStatus,
  PassengerJourneyStatus, BoardingEventType, UserStatus, UserRole,
} from "@prisma/client";
import { BookingError } from "./errors.js";

type Db = PrismaClient;

/** Complete an onboard passenger at their booked destination and release the seat. */
export async function disembarkPassenger(db: Db, operatorId: string, ticketId: string) {
  return db.$transaction(async (tx) => {
    const operator = await tx.user.findUnique({
      where: { id: operatorId }, select: { id: true, role: true, status: true },
    });
    if (!operator || operator.status !== UserStatus.ACTIVE ||
        ![UserRole.OPERATOR, UserRole.ADMIN].includes(operator.role)) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "Only an active operator or administrator can confirm disembarkation.");
    }

    const ticketRef = await tx.ticket.findUnique({ where: { id: ticketId }, select: { journeyId: true } });
    if (!ticketRef) throw new BookingError("TICKET_NOT_FOUND", "Ticket not found.");
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM journeys WHERE id = ${ticketRef.journeyId}::uuid FOR UPDATE
    `;
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      include: { journey: true, destinationStop: true, passengerJourney: true },
    });
    if (!ticket) throw new BookingError("TICKET_NOT_FOUND", "Ticket not found.");
    if (ticket.status === TicketStatus.COMPLETED) return { ticket, alreadyDisembarked: true };
    if (ticket.status !== TicketStatus.BOARDED ||
        ![JourneyStatus.IN_PROGRESS, JourneyStatus.PAUSED].includes(ticket.journey.status)) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "Only an onboard passenger can disembark during an active journey.");
    }
    if (!["ARRIVED", "BOARDING_OPEN"].includes(ticket.destinationStop.status) || ticket.journey.currentStopSequence !== ticket.destinationStop.sequence) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "The coach has not arrived at this passenger's destination stop.");
    }

    const reservation = await tx.seatReservation.findFirst({
      where: { ticketId, status: SeatReservationStatus.OCCUPIED }, select: { id: true },
    });
    if (!reservation) throw new BookingError("SEAT_UNAVAILABLE", "No occupied seat reservation exists for this passenger.");

    const now = new Date();
    const changed = await tx.ticket.updateMany({
      where: { id: ticketId, status: TicketStatus.BOARDED },
      data: { status: TicketStatus.COMPLETED, completedAt: now },
    });
    if (changed.count !== 1) throw new BookingError("BOARDING_NOT_ALLOWED", "Ticket status changed. Refresh the passenger manifest.");

    const released = await tx.seatReservation.updateMany({
      where: { id: reservation.id, status: SeatReservationStatus.OCCUPIED },
      data: { status: SeatReservationStatus.RELEASED, releasedAt: now },
    });
    if (released.count !== 1) throw new BookingError("SEAT_UNAVAILABLE", "Seat reservation changed before disembarkation.");

    await tx.passengerJourney.updateMany({
      where: { ticketId, status: PassengerJourneyStatus.ONBOARD },
      data: { status: PassengerJourneyStatus.COMPLETED, actualDisembarkedAt: now },
    });
    await tx.boardingEvent.create({
      data: { ticketId, stopId: ticket.destinationStopId, eventType: BoardingEventType.DISEMBARKED },
    });
    await tx.journeyEvent.create({
      data: {
        journeyId: ticket.journeyId, actorId: operatorId, eventType: "passenger.disembarked",
        payload: { ticketId, seatReservationId: reservation.id, stopSequence: ticket.destinationStop.sequence },
      },
    });
    return { ticket: await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } }), alreadyDisembarked: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Finalize an unboarded passenger after the coach has departed their origin.
 * Absence is never inferred from a timer; an operator explicitly confirms it.
 */
export async function markNoShow(db: Db, operatorId: string, ticketId: string) {
  return db.$transaction(async (tx) => {
    const operator = await tx.user.findUnique({
      where: { id: operatorId }, select: { id: true, role: true, status: true },
    });
    if (!operator || operator.status !== UserStatus.ACTIVE ||
        ![UserRole.OPERATOR, UserRole.ADMIN].includes(operator.role)) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "Only an active operator or administrator can finalize a no-show.");
    }

    const ticketRef = await tx.ticket.findUnique({ where: { id: ticketId }, select: { journeyId: true } });
    if (!ticketRef) throw new BookingError("TICKET_NOT_FOUND", "Ticket not found.");
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM journeys WHERE id = ${ticketRef.journeyId}::uuid FOR UPDATE
    `;
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      include: { journey: true, originStop: true },
    });
    if (!ticket) throw new BookingError("TICKET_NOT_FOUND", "Ticket not found.");
    if (ticket.status === TicketStatus.NO_SHOW) return { ticket, alreadyNoShow: true };
    if (![TicketStatus.CONFIRMED, TicketStatus.CHECKED_IN].includes(ticket.status) ||
        ![JourneyStatus.IN_PROGRESS, JourneyStatus.PAUSED].includes(ticket.journey.status)) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "Only an unboarded ticket can be finalized as a no-show after departure.");
    }
    if (ticket.originStop.status !== "DEPARTED" || ticket.journey.currentStopSequence !== ticket.originStop.sequence) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "No-show can only be finalized at the stop where this ticket's boarding was due.");
    }

    const reservation = await tx.seatReservation.findFirst({
      where: { ticketId, status: SeatReservationStatus.CONFIRMED }, select: { id: true },
    });
    if (!reservation) throw new BookingError("SEAT_UNAVAILABLE", "No confirmed seat reservation exists to release.");

    const now = new Date();
    const changed = await tx.ticket.updateMany({
      where: { id: ticketId, status: { in: [TicketStatus.CONFIRMED, TicketStatus.CHECKED_IN] } },
      data: { status: TicketStatus.NO_SHOW },
    });
    if (changed.count !== 1) throw new BookingError("BOARDING_NOT_ALLOWED", "Ticket status changed. Refresh the passenger manifest.");

    const released = await tx.seatReservation.updateMany({
      where: { id: reservation.id, status: SeatReservationStatus.CONFIRMED },
      data: { status: SeatReservationStatus.RELEASED, releasedAt: now },
    });
    if (released.count !== 1) throw new BookingError("SEAT_UNAVAILABLE", "Seat reservation changed before no-show finalization.");

    await tx.passengerJourney.updateMany({
      where: { ticketId, status: { in: [PassengerJourneyStatus.BOOKED, PassengerJourneyStatus.CHECKED_IN] } },
      data: { status: PassengerJourneyStatus.NO_SHOW },
    });
    await tx.boardingEvent.create({
      data: { ticketId, stopId: ticket.originStopId, eventType: BoardingEventType.NO_SHOW },
    });
    await tx.journeyEvent.create({
      data: {
        journeyId: ticket.journeyId, actorId: operatorId, eventType: "passenger.no_show",
        payload: { ticketId, seatReservationId: reservation.id, stopSequence: ticket.originStop.sequence },
      },
    });
    return { ticket: await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } }), alreadyNoShow: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
