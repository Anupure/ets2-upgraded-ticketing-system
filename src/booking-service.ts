import { randomBytes, randomUUID } from "node:crypto";
import {
  Prisma, PrismaClient, JourneyStatus, TicketStatus, SeatReservationStatus,
  PassengerJourneyStatus, BoardingEventType, WalletTransactionType, UserStatus, UserRole,
} from "@prisma/client";
import { BookingError, isSeatConflict } from "./errors.js";
import { withSerializableRetry } from "./transaction.js";

export type Db = PrismaClient;
const ACTIVE_TICKET_STATUSES: TicketStatus[] = ["CONFIRMED", "CHECKED_IN", "BOARDED"];

function ticketNumber(): string {
  return `RRP-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}
function assertIdempotentPayload(existing: { userId: string; journeyId: string; originStopId: string; destinationStopId: string; pricePaid: bigint }, input: PurchaseTicketInput) {
  if (existing.userId !== input.userId || existing.journeyId !== input.journeyId ||
      existing.originStopId !== input.originStopId || existing.destinationStopId !== input.destinationStopId ||
      existing.pricePaid !== input.expectedPrice) {
    throw new BookingError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different booking request.");
  }
}

/** Create the wallet and the one-time welcome grant atomically. Safe to retry. */
export async function provisionWallet(db: Db, userId: string, initialTokens = 1_000n) {
  if (initialTokens < 0n) throw new RangeError("initialTokens cannot be negative");
  try {
    return await withSerializableRetry(db, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
      if (!user || user.status !== UserStatus.ACTIVE) throw new BookingError("USER_UNAVAILABLE", "User is unavailable.");
      const existing = await tx.wallet.findUnique({ where: { userId } });
      if (existing) return existing;
      const wallet = await tx.wallet.create({ data: { userId, balance: initialTokens } });
      if (initialTokens > 0n) {
        await tx.walletTransaction.create({ data: {
          walletId: wallet.id, amount: initialTokens,
          transactionType: WalletTransactionType.INITIAL_BONUS,
          idempotencyKey: `welcome:${userId}`, description: "New passenger welcome tokens",
        } });
      }
      return wallet;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    // A concurrent first-login request may win the unique wallet/user race.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const wallet = await db.wallet.findUnique({ where: { userId } });
      if (wallet) return wallet;
    }
    throw error;
  }
}

export interface PurchaseTicketInput {
  userId: string;
  journeyId: string;
  originStopId: string;
  destinationStopId: string;
  seatNumber: string;
  idempotencyKey: string;
  /** Client's displayed price; server re-checks it against the journey price. */
  expectedPrice: bigint;
}

/**
 * Atomic purchase. Wallet debit, ticket, passenger record, ledger entry and
 * seat allocation commit together. PostgreSQL exclusion constraint is the
 * final authority for concurrent overlapping seat requests.
 */
export async function purchaseTicket(db: Db, input: PurchaseTicketInput) {
  if (!input.idempotencyKey || input.idempotencyKey.length > 140) throw new RangeError("Invalid idempotency key");
  try {
    return await withSerializableRetry(db, async (tx) => {
      const prior = await tx.ticket.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (prior) {
        assertIdempotentPayload(prior, input);
        return { ticket: prior, replayed: true };
      }

      // Serialize purchases for this journey so status/price cannot change mid-purchase.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM journeys WHERE id = ${input.journeyId}::uuid FOR UPDATE
      `;
      if (locked.length === 0) throw new BookingError("JOURNEY_NOT_OPEN", "Journey does not exist.");
      const journey = await tx.journey.findUnique({
        where: { id: input.journeyId },
        include: { stops: { where: { id: { in: [input.originStopId, input.destinationStopId] } } } },
      });
      if (!journey || journey.status !== JourneyStatus.BOOKING_OPEN) throw new BookingError("JOURNEY_NOT_OPEN", "Ticket sales are not open for this journey.");
      if (journey.ticketPrice !== input.expectedPrice) throw new BookingError("IDEMPOTENCY_CONFLICT", "Ticket price changed. Refresh the journey and try again.");
      const origin = journey.stops.find(s => s.id === input.originStopId);
      const destination = journey.stops.find(s => s.id === input.destinationStopId);
      if (!origin || !destination || origin.sequence >= destination.sequence) throw new BookingError("INVALID_SEGMENT", "Choose two stops on this journey, with destination after origin.");

      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true } });
      if (!user || user.status !== UserStatus.ACTIVE) throw new BookingError("USER_UNAVAILABLE", "User is unavailable.");
      const wallet = await tx.wallet.findUnique({ where: { userId: input.userId } });
      if (!wallet) throw new BookingError("WALLET_NOT_FOUND", "Wallet has not been provisioned.");

      const activeTicket = await tx.ticket.findFirst({ where: { journeyId: input.journeyId, userId: input.userId, status: { in: ACTIVE_TICKET_STATUSES } }, select: { id: true } });
      if (activeTicket) throw new BookingError("ACTIVE_TICKET_EXISTS", "You already have an active ticket for this journey.");

      const seat = await tx.busSeat.findFirst({ where: { busLayoutId: journey.busLayoutId, seatNumber: input.seatNumber, isBookable: true } });
      if (!seat) throw new BookingError("SEAT_UNAVAILABLE", "That seat does not exist or cannot be booked.");

      const debit = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: journey.ticketPrice } }, data: { balance: { decrement: journey.ticketPrice } } });
      if (debit.count !== 1) throw new BookingError("INSUFFICIENT_TOKENS", "You do not have enough tokens for this ticket.");

      const ticket = await tx.ticket.create({ data: {
        ticketNumber: ticketNumber(), idempotencyKey: input.idempotencyKey,
        journeyId: input.journeyId, userId: input.userId,
        originStopId: origin.id, destinationStopId: destination.id,
        pricePaid: journey.ticketPrice, status: TicketStatus.CONFIRMED,
      } });
      await tx.walletTransaction.create({ data: {
        walletId: wallet.id, amount: -journey.ticketPrice,
        transactionType: WalletTransactionType.TICKET_PURCHASE,
        referenceType: "TICKET", referenceId: ticket.id,
        idempotencyKey: `ticket:${input.idempotencyKey}`,
        description: `Ticket ${ticket.ticketNumber}`,
      } });
      await tx.passengerJourney.create({ data: {
        ticketId: ticket.id, userId: input.userId, journeyId: input.journeyId,
        status: PassengerJourneyStatus.BOOKED,
      } });
      await tx.seatReservation.create({ data: {
        ticketId: ticket.id, journeyId: input.journeyId, seatId: seat.id,
        fromSequence: origin.sequence, toSequence: destination.sequence,
        status: SeatReservationStatus.CONFIRMED,
      } });
      return { ticket, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
  } catch (error) {
    if (isSeatConflict(error)) throw new BookingError("SEAT_UNAVAILABLE", "That seat was just booked for an overlapping part of the route. Choose another seat.");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const prior = await db.ticket.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (prior) { assertIdempotentPayload(prior, input); return { ticket: prior, replayed: true }; }
      throw new BookingError("ACTIVE_TICKET_EXISTS", "An active ticket already exists for this journey.");
    }
    throw error;
  }
}

/** Passenger self-check-in. It does not mark the passenger as physically aboard. */
export async function checkIn(db: Db, userId: string, ticketId: string) {
  return withSerializableRetry(db, async (tx) => {
    const reference = await tx.ticket.findFirst({ where: { id: ticketId, userId }, select: { journeyId: true } });
    if (!reference) throw new BookingError("TICKET_NOT_FOUND", "Ticket not found for this account.");
    await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM journeys WHERE id = ${reference.journeyId}::uuid FOR UPDATE`;
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId, userId }, include: { journey: true, originStop: true, passengerJourney: true } });
    if (!ticket) throw new BookingError("TICKET_NOT_FOUND", "Ticket not found for this account.");
    if (ticket.status === TicketStatus.CHECKED_IN) return { ticket, alreadyCheckedIn: true };
    if (ticket.status !== TicketStatus.CONFIRMED || ticket.journey.status !== JourneyStatus.BOARDING) throw new BookingError("CHECK_IN_CLOSED", "Check-in is available only while the operator has opened boarding.");
    const current = ticket.journey.currentStopSequence;
    if (current !== null && current !== ticket.originStop.sequence) throw new BookingError("CHECK_IN_CLOSED", "The coach is not boarding at your ticket's origin stop.");

    const changed = await tx.ticket.updateMany({ where: { id: ticket.id, status: TicketStatus.CONFIRMED }, data: { status: TicketStatus.CHECKED_IN, checkedInAt: new Date() } });
    if (changed.count !== 1) throw new BookingError("ALREADY_CHECKED_IN", "Ticket status changed. Refresh and try again.");
    if (ticket.passengerJourney) {
      await tx.passengerJourney.update({ where: { ticketId: ticket.id }, data: { status: PassengerJourneyStatus.CHECKED_IN } });
    }
    await tx.boardingEvent.create({ data: { ticketId: ticket.id, stopId: ticket.originStopId, eventType: BoardingEventType.CHECK_IN } });
    const updated = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    return { ticket: updated, alreadyCheckedIn: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Operator-confirmed physical boarding. Passenger self-check-in alone never
 * changes the seat to OCCUPIED; this operation is the authority for that state.
 */
export async function confirmBoarding(db: Db, operatorId: string, ticketId: string) {
  return withSerializableRetry(db, async (tx) => {
    const operator = await tx.user.findUnique({
      where: { id: operatorId },
      select: { id: true, role: true, status: true },
    });
    if (!operator || operator.status !== UserStatus.ACTIVE ||
        operator.role !== UserRole.OPERATOR && operator.role !== UserRole.ADMIN) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "Only an active operator or administrator can confirm physical boarding.");
    }

    const reference = await tx.ticket.findUnique({
      where: { id: ticketId }, select: { journeyId: true },
    });
    if (!reference) throw new BookingError("TICKET_NOT_FOUND", "Ticket not found.");
    await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM journeys WHERE id = ${reference.journeyId}::uuid FOR UPDATE`;
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      include: { journey: true, originStop: true, passengerJourney: true },
    });
    if (!ticket) throw new BookingError("TICKET_NOT_FOUND", "Ticket not found.");
    if (ticket.status === TicketStatus.BOARDED) return { ticket, alreadyBoarded: true };
    if (ticket.status !== TicketStatus.CHECKED_IN || ticket.journey.status !== JourneyStatus.BOARDING) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "The passenger must be checked in while boarding is open.");
    }
    const currentSequence = ticket.journey.currentStopSequence;
    if (currentSequence !== null && currentSequence !== ticket.originStop.sequence) {
      throw new BookingError("BOARDING_NOT_ALLOWED", "The coach is not boarding at this ticket's origin stop.");
    }

    const reservation = await tx.seatReservation.findFirst({
      where: {
        ticketId: ticket.id,
        status: SeatReservationStatus.CONFIRMED,
      },
      select: { id: true },
    });
    if (!reservation) throw new BookingError("SEAT_UNAVAILABLE", "This ticket has no confirmed seat reservation.");

    const changed = await tx.ticket.updateMany({
      where: { id: ticket.id, status: TicketStatus.CHECKED_IN },
      data: { status: TicketStatus.BOARDED, boardedAt: new Date() },
    });
    if (changed.count !== 1) throw new BookingError("BOARDING_NOT_ALLOWED", "Ticket status changed. Refresh the manifest.");

    const occupied = await tx.seatReservation.updateMany({
      where: { id: reservation.id, status: SeatReservationStatus.CONFIRMED },
      data: { status: SeatReservationStatus.OCCUPIED },
    });
    if (occupied.count !== 1) throw new BookingError("SEAT_UNAVAILABLE", "Seat reservation is no longer available for boarding.");

    if (ticket.passengerJourney) {
      await tx.passengerJourney.update({
        where: { ticketId: ticket.id },
        data: { status: PassengerJourneyStatus.ONBOARD, actualBoardedAt: new Date() },
      });
    }
    await tx.boardingEvent.create({
      data: { ticketId: ticket.id, stopId: ticket.originStopId, eventType: BoardingEventType.BOARDED },
    });
    await tx.journeyEvent.create({
      data: {
        journeyId: ticket.journeyId,
        actorId: operatorId,
        eventType: "passenger.boarded",
        payload: { ticketId: ticket.id, seatReservationId: reservation.id },
      },
    });

    return {
      ticket: await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } }),
      alreadyBoarded: false,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Sanitized, segment-aware seat map suitable for booking UI or OBS.
 * For a live overlay, pass the current leg [currentStopSequence, +1).
 * Passenger identity is emitted only for a physically OCCUPIED reservation.
 */
export async function getSeatMap(db: Db, journeyId: string, fromSequence?: number, toSequence?: number) {
  if ((fromSequence === undefined) !== (toSequence === undefined)) {
    throw new RangeError("fromSequence and toSequence must be supplied together");
  }
  if (fromSequence !== undefined && toSequence !== undefined &&
      (!Number.isInteger(fromSequence) || !Number.isInteger(toSequence) || fromSequence < 1 || toSequence <= fromSequence)) {
    throw new RangeError("Invalid seat-map segment range");
  }

  const journey = await db.journey.findUnique({
    where: { id: journeyId },
    select: { busLayoutId: true, currentStopSequence: true },
  });
  if (!journey) throw new BookingError("JOURNEY_NOT_OPEN", "Journey not found.");
  const seats = await db.busSeat.findMany({
    where: { busLayoutId: journey.busLayoutId },
    orderBy: [{ rowNumber: "asc" }, { columnNumber: "asc" }],
  });

  // A no-argument request defaults to the current leg when the coach has a
  // current stop. Half-open ranges make a passenger due to disembark at this
  // stop absent from the next leg's manifest.
  const effectiveFrom = fromSequence ?? journey.currentStopSequence ?? undefined;
  const effectiveTo = toSequence ?? (effectiveFrom !== undefined ? effectiveFrom + 1 : undefined);
  const segmentFilter = effectiveFrom !== undefined && effectiveTo !== undefined
    ? { fromSequence: { lt: effectiveTo }, toSequence: { gt: effectiveFrom } }
    : {};

  const reservations = await db.seatReservation.findMany({
    where: {
      journeyId,
      status: { in: [SeatReservationStatus.HELD, SeatReservationStatus.CONFIRMED, SeatReservationStatus.OCCUPIED] },
      ...segmentFilter,
    },
    include: {
      ticket: {
        select: {
          status: true,
          user: { select: { displayName: true, avatar: { select: { imageUrl: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const bySeat = new Map<string, typeof reservations>();
  for (const reservation of reservations) {
    const existing = bySeat.get(reservation.seatId) ?? [];
    existing.push(reservation);
    bySeat.set(reservation.seatId, existing);
  }

  return seats.map((seat) => {
    const matches = bySeat.get(seat.id) ?? [];
    const occupied = matches.filter((r) => r.status === SeatReservationStatus.OCCUPIED);
    const held = matches.some((r) => r.status === SeatReservationStatus.HELD);
    const booked = matches.some((r) => r.status === SeatReservationStatus.CONFIRMED);
    const occupant = occupied.length === 1 ? occupied[0] : undefined;

    return {
      seatNumber: seat.seatNumber,
      row: seat.rowNumber,
      column: seat.columnNumber,
      seatType: seat.seatType,
      bookable: seat.isBookable,
      state: !seat.isBookable ? "UNAVAILABLE" : occupied.length > 0 ? "OCCUPIED" : held ? "HELD" : booked ? "BOOKED" : "AVAILABLE",
      // Never expose the identity of someone who has only reserved a seat.
      // If data is ambiguous (multiple occupied reservations), fail closed.
      passenger: occupant ? {
        displayName: occupant.ticket.user.displayName,
        avatarUrl: occupant.ticket.user.avatar?.imageUrl ?? null,
      } : null,
    };
  });
}

// Useful for application-generated correlation IDs; not a substitute for a
// client-stable idempotency key on a retried purchase request.
export const newRequestId = () => randomUUID();
