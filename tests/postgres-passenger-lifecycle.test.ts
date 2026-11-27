import { randomUUID } from "node:crypto";
import {
  PrismaClient, JourneyStatus, TicketStatus, SeatReservationStatus,
  UserRole, UserStatus, StopStatus, PassengerJourneyStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  provisionWallet, purchaseTicket, checkIn, confirmBoarding, getSeatMap,
} from "../src/booking-service.js";
import { closeBooking, arriveAtStop, openBoardingAtStop, departStop, completeJourneyAtFinalStop } from "../src/journey-stop-service.js";
import { disembarkPassenger, markNoShow } from "../src/passenger-lifecycle-service.js";

const prisma = new PrismaClient();
const integration = process.env.DATABASE_URL ? describe : describe.skip;


async function cleanupIntegrationData(
  journeyId: string | undefined,
  layoutId: string | undefined,
  userIds: string[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (journeyId) {
      // Remove dependent records before their referenced parents.
      await tx.breakCreditTransaction.deleteMany({
        where: { passengerJourney: { journeyId } },
      });
      await tx.breakRequest.deleteMany({ where: { journeyId } });
      await tx.boardingEvent.deleteMany({
        where: { ticket: { journeyId } },
      });
      await tx.seatReservation.deleteMany({ where: { journeyId } });
      await tx.passengerJourney.deleteMany({ where: { journeyId } });
      await tx.ticket.deleteMany({ where: { journeyId } });
      await tx.journeyStop.deleteMany({ where: { journeyId } });
      await tx.streamSession.deleteMany({ where: { journeyId } });
      await tx.journeyEvent.deleteMany({ where: { journeyId } });
      await tx.journey.deleteMany({ where: { id: journeyId } });
    }

    if (layoutId) {
      await tx.busLayout.deleteMany({ where: { id: layoutId } });
    }

    if (userIds.length > 0) {
      await tx.walletTransaction.deleteMany({
        where: {
          OR: [
            { wallet: { userId: { in: userIds } } },
            { actorId: { in: userIds } },
          ],
        },
      });
      await tx.wallet.deleteMany({
        where: { userId: { in: userIds } },
      });
      await tx.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  });
}


integration("PostgreSQL passenger lifecycle", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("purchases, boards, releases and reuses a seat across adjacent segments; finalizes a no-show", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createdUserIds: string[] = [];
    let layoutId: string | undefined;
    let journeyId: string | undefined;

    try {
      const operator = await prisma.user.create({ data: {
        username: `op_${suffix}`, displayName: "CI Operator", role: UserRole.OPERATOR, status: UserStatus.ACTIVE,
      } });
      createdUserIds.push(operator.id);
      const firstPassenger = await prisma.user.create({ data: {
        username: `p1_${suffix}`, displayName: "Passenger One",
      } });
      createdUserIds.push(firstPassenger.id);
      const secondPassenger = await prisma.user.create({ data: {
        username: `p2_${suffix}`, displayName: "Passenger Two",
      } });
      createdUserIds.push(secondPassenger.id);
      const noShowPassenger = await prisma.user.create({ data: {
        username: `p3_${suffix}`, displayName: "No Show Passenger",
      } });
      createdUserIds.push(noShowPassenger.id);
      const overlappingPassenger = await prisma.user.create({ data: {
        username: `p4_${suffix}`, displayName: "Overlapping Passenger",
      } });
      createdUserIds.push(overlappingPassenger.id);
      const layout = await prisma.busLayout.create({ data: {
        name: `CI Coach ${suffix}`, capacity: 2,
        seats: { create: [
          { seatNumber: "1A", rowNumber: 1, columnNumber: 1 },
          { seatNumber: "1B", rowNumber: 1, columnNumber: 2 },
        ] },
      } });
      layoutId = layout.id;
      const journey = await prisma.journey.create({ data: {
        name: `CI Journey ${suffix}`, busLayoutId: layout.id,
        createdBy: operator.id, status: JourneyStatus.BOOKING_OPEN, ticketPrice: 100n,
        stops: { create: [
          { sequence: 1, name: "Origin" },
          { sequence: 2, name: "Middle" },
          { sequence: 3, name: "Destination" },
        ] },
      } });
      journeyId = journey.id;
      const stops = await prisma.journeyStop.findMany({
        where: { journeyId: journey.id }, orderBy: { sequence: "asc" },
      });
      const origin = stops[0]!;
      const middle = stops[1]!;
      const destination = stops[2]!;
  
      for (const user of [firstPassenger, secondPassenger, noShowPassenger, overlappingPassenger]) {
        await provisionWallet(prisma, user.id, 1_000n);
      }
  
      const first = await purchaseTicket(prisma, {
        userId: firstPassenger.id, journeyId: journey.id, originStopId: origin.id,
        destinationStopId: middle.id, seatNumber: "1A", idempotencyKey: `first-${suffix}`, expectedPrice: 100n,
      });
      const second = await purchaseTicket(prisma, {
        userId: secondPassenger.id, journeyId: journey.id, originStopId: middle.id,
        destinationStopId: destination.id, seatNumber: "1A", idempotencyKey: `second-${suffix}`, expectedPrice: 100n,
      });
      const noShow = await purchaseTicket(prisma, {
        userId: noShowPassenger.id, journeyId: journey.id, originStopId: origin.id,
        destinationStopId: middle.id, seatNumber: "1B", idempotencyKey: `noshow-${suffix}`, expectedPrice: 100n,
      });
  
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(false);
      expect(noShow.replayed).toBe(false);
      await expect(purchaseTicket(prisma, {
        userId: overlappingPassenger.id, journeyId: journey.id, originStopId: origin.id,
        destinationStopId: middle.id, seatNumber: "1A", idempotencyKey: `overlap-${suffix}`, expectedPrice: 100n,
      })).rejects.toMatchObject({ code: "SEAT_UNAVAILABLE" });
      expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: overlappingPassenger.id } })).balance).toBe(1_000n);
      expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: firstPassenger.id } })).balance).toBe(900n);
  
      await closeBooking(prisma, operator.id, journey.id);
      await arriveAtStop(prisma, operator.id, journey.id, origin.id);
      await openBoardingAtStop(prisma, operator.id, journey.id, origin.id);
      await checkIn(prisma, firstPassenger.id, first.ticket.id);
      await confirmBoarding(prisma, operator.id, first.ticket.id);
  
      const liveSeatMap = await getSeatMap(prisma, journey.id);
      expect(liveSeatMap.find((seat) => seat.seatNumber === "1A")).toMatchObject({
        state: "OCCUPIED", passenger: { displayName: "Passenger One" },
      });
  
      await departStop(prisma, operator.id, journey.id, origin.id);
      await arriveAtStop(prisma, operator.id, journey.id, middle.id);

      // The origin manifest must still be able to resolve a missed passenger
      // after the coach has advanced to a later stop.
      await markNoShow(prisma, operator.id, noShow.ticket.id);
      const noShowState = await prisma.ticket.findUniqueOrThrow({
        where: { id: noShow.ticket.id }, include: { seatReservations: true, passengerJourney: true },
      });
      expect(noShowState.status).toBe(TicketStatus.NO_SHOW);
      expect(noShowState.passengerJourney?.status).toBe(PassengerJourneyStatus.NO_SHOW);
      expect(noShowState.seatReservations[0]?.status).toBe(SeatReservationStatus.RELEASED);

      await openBoardingAtStop(prisma, operator.id, journey.id, middle.id);
      await expect(departStop(prisma, operator.id, journey.id, middle.id))
        .rejects.toMatchObject({ code: "BOARDING_NOT_ALLOWED" });
      // The journey must remain at the stop so the passenger can still disembark.
      expect((await prisma.journey.findUniqueOrThrow({ where: { id: journey.id } })).currentStopSequence)
        .toBe(middle.sequence);
      await disembarkPassenger(prisma, operator.id, first.ticket.id);
      const firstState = await prisma.ticket.findUniqueOrThrow({
        where: { id: first.ticket.id }, include: { seatReservations: true, passengerJourney: true },
      });
      expect(firstState.status).toBe(TicketStatus.COMPLETED);
      expect(firstState.passengerJourney?.status).toBe(PassengerJourneyStatus.COMPLETED);
      expect(firstState.seatReservations[0]?.status).toBe(SeatReservationStatus.RELEASED);
  
      await openBoardingAtStop(prisma, operator.id, journey.id, middle.id);
      await checkIn(prisma, secondPassenger.id, second.ticket.id);
      await confirmBoarding(prisma, operator.id, second.ticket.id);
      expect((await getSeatMap(prisma, journey.id)).find((seat) => seat.seatNumber === "1A"))
        .toMatchObject({ state: "OCCUPIED", passenger: { displayName: "Passenger Two" } });
  
      await departStop(prisma, operator.id, journey.id, middle.id);
      await arriveAtStop(prisma, operator.id, journey.id, destination.id);
      await disembarkPassenger(prisma, operator.id, second.ticket.id);
      const completed = await completeJourneyAtFinalStop(prisma, operator.id, journey.id);
      expect(completed.journey.status).toBe(JourneyStatus.COMPLETED);
      expect(completed.alreadyCompleted).toBe(false);
  
      const finalSecond = await prisma.ticket.findUniqueOrThrow({
        where: { id: second.ticket.id }, include: { seatReservations: true },
      });
      expect(finalSecond.status).toBe(TicketStatus.COMPLETED);
      expect(finalSecond.seatReservations[0]?.status).toBe(SeatReservationStatus.RELEASED);
      expect((await prisma.journeyStop.findUniqueOrThrow({ where: { id: origin.id } })).status).toBe(StopStatus.DEPARTED);
  
    } finally {
      await cleanupIntegrationData(journeyId, layoutId, createdUserIds);
    }
  }, 30_000);
});
