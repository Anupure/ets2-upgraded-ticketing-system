import { randomUUID } from "node:crypto";
import { PrismaClient, JourneyStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const integration = process.env.DATABASE_URL ? describe : describe.skip;

async function waitForJourneyAdvisoryLock(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND l.mode = 'ExclusiveLock' AND NOT l.granted AND a.query ILIKE '%UPDATE%') AS waiting"
    ) as Array<{ waiting: boolean }>;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Structural edit did not wait for the journey advisory lock");
}
integration("booked route and bus layout integrity", () => {
  it("allows concurrent journey creation with nested stops", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const userIds: string[] = [];
    const layoutIds: string[] = [];
    const journeyIds: string[] = [];

    try {
      const fixtures = await Promise.all([1, 2].map(async (index) => {
        const user = await prisma.user.create({
          data: { username: `parallel_create_${suffix}_${index}`, displayName: "Parallel Create Test" },
        });
        userIds.push(user.id);
        const layout = await prisma.busLayout.create({
          data: {
            name: `Parallel Create Coach ${suffix} ${index}`,
            capacity: 1,
            seats: { create: [{ seatNumber: "1A", rowNumber: 1, columnNumber: 1 }] },
          },
        });
        layoutIds.push(layout.id);
        return { user, layout };
      }));

      const journeys = await Promise.all(fixtures.map(({ user, layout }, index) =>
        prisma.journey.create({
          data: {
            name: `Parallel Create Journey ${suffix} ${index}`,
            busLayoutId: layout.id,
            createdBy: user.id,
            status: JourneyStatus.DRAFT,
            stops: { create: [{ sequence: 1, name: "Origin" }, { sequence: 2, name: "Destination" }] },
          },
        }).then((journey) => {
          journeyIds.push(journey.id);
          return journey;
        })
      ));
      expect(journeys).toHaveLength(2);
    } finally {
      if (journeyIds.length) await prisma.journey.deleteMany({ where: { id: { in: journeyIds } } });
      if (layoutIds.length) await prisma.busLayout.deleteMany({ where: { id: { in: layoutIds } } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }, 15_000);

  it("freezes structural edits after ticketing but permits stop metadata corrections", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    let userId: string | undefined;
    let journeyId: string | undefined;
    let layoutId: string | undefined;
    let alternateLayoutId: string | undefined;

    try {
      const user = await prisma.user.create({
        data: { username: `integrity_${suffix}`, displayName: "Integrity Test Passenger" },
      });
      userId = user.id;

      const layout = await prisma.busLayout.create({
        data: {
          name: `Integrity Coach ${suffix}`,
          capacity: 2,
          seats: {
            create: [
              { seatNumber: "1A", rowNumber: 1, columnNumber: 1 },
              { seatNumber: "1B", rowNumber: 1, columnNumber: 2 },
            ],
          },
        },
        include: { seats: true },
      });
      layoutId = layout.id;

      const alternateLayout = await prisma.busLayout.create({
        data: {
          name: `Alternate Coach ${suffix}`,
          capacity: 1,
          seats: { create: [{ seatNumber: "1A", rowNumber: 1, columnNumber: 1 }] },
        },
      });
      alternateLayoutId = alternateLayout.id;

      const journey = await prisma.journey.create({
        data: {
          name: `Integrity Journey ${suffix}`,
          busLayoutId: layout.id,
          createdBy: user.id,
          // The database permits only one operational journey globally; this
          // integrity test only needs a journey with ticket history.
          status: JourneyStatus.DRAFT,
          stops: {
            create: [
              { sequence: 1, name: "Origin" },
              { sequence: 2, name: "Middle" },
              { sequence: 3, name: "Destination" },
            ],
          },
        },
        include: { stops: { orderBy: { sequence: "asc" } } },
      });
      journeyId = journey.id;

      const [origin, middle, destination] = journey.stops;
      if (!origin || !middle || !destination) throw new Error("Test journey stops were not created");

      const ticket = await prisma.ticket.create({
        data: {
          ticketNumber: `T-${suffix}`,
          idempotencyKey: `integrity-ticket-${suffix}`,
          journeyId: journey.id,
          userId: user.id,
          originStopId: origin.id,
          destinationStopId: destination.id,
          pricePaid: 100n,
        },
      });

      // Structural route edits must fail even when the changed stop is not
      // directly referenced by the ticket.
      await expect(prisma.journeyStop.update({
        where: { id: middle.id }, data: { sequence: 4 },
      })).rejects.toThrow(/structurally changed after tickets exist/);

      await expect(prisma.journeyStop.create({
        data: { journeyId: journey.id, sequence: 4, name: "Added stop" },
      })).rejects.toThrow(/structurally changed after tickets exist/);

      await expect(prisma.journeyStop.delete({
        where: { id: middle.id },
      })).rejects.toThrow(/structurally changed after tickets exist/);

      // Display-only correction remains allowed.
      await expect(prisma.journeyStop.update({
        where: { id: middle.id }, data: { name: "Corrected middle stop" },
      })).resolves.toMatchObject({ name: "Corrected middle stop" });

      await expect(prisma.journey.update({
        where: { id: journey.id }, data: { busLayoutId: alternateLayout.id },
      })).rejects.toThrow(/bus layout cannot change after tickets exist/);

      await expect(prisma.busLayout.update({
        where: { id: layout.id }, data: { capacity: 3 },
      })).rejects.toThrow(/layout structure cannot change/);

      await expect(prisma.busLayout.update({
        where: { id: layout.id }, data: { layout: { rows: 3 } },
      })).rejects.toThrow(/layout structure cannot change/);

      await expect(prisma.busSeat.update({
        where: { id: layout.seats[0]!.id }, data: { isBookable: false },
      })).rejects.toThrow(/seats cannot be structurally changed/);

      await expect(prisma.busSeat.create({
        data: {
          busLayoutId: layout.id,
          seatNumber: "2A",
          rowNumber: 2,
          columnNumber: 1,
        },
      })).rejects.toThrow(/seats cannot be structurally changed/);

      // An unused layout remains editable.
      await expect(prisma.busLayout.update({
        where: { id: alternateLayout.id }, data: { capacity: 2 },
      })).resolves.toMatchObject({ capacity: 2 });
    } finally {
      if (journeyId) {
        await prisma.ticket.deleteMany({ where: { journeyId } });
        await prisma.journeyStop.deleteMany({ where: { journeyId } });
        await prisma.journey.deleteMany({ where: { id: journeyId } });
      }
      if (layoutId) await prisma.busLayout.deleteMany({ where: { id: layoutId } });
      if (alternateLayoutId) await prisma.busLayout.deleteMany({ where: { id: alternateLayoutId } });
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    }
  });


  it("serializes a seat edit behind a booking without deadlocking", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    let userId: string | undefined;
    let journeyId: string | undefined;
    let layoutId: string | undefined;

    try {
      const user = await prisma.user.create({
        data: { username: `seat_race_${suffix}`, displayName: "Seat Race Test Passenger" },
      });
      userId = user.id;

      const layout = await prisma.busLayout.create({
        data: {
          name: `Seat Race Coach ${suffix}`,
          capacity: 1,
          seats: { create: [{ seatNumber: "1A", rowNumber: 1, columnNumber: 1 }] },
        },
        include: { seats: true },
      });
      layoutId = layout.id;

      const journey = await prisma.journey.create({
        data: {
          name: `Seat Race Journey ${suffix}`,
          busLayoutId: layout.id,
          createdBy: user.id,
          status: JourneyStatus.DRAFT,
          stops: {
            create: [
              { sequence: 1, name: "Origin" },
              { sequence: 2, name: "Destination" },
            ],
          },
        },
        include: { stops: { orderBy: { sequence: "asc" } } },
      });
      journeyId = journey.id;
      const [origin, destination] = journey.stops;
      if (!origin || !destination) throw new Error("Test journey stops were not created");

      let signalJourneyLocked!: () => void;
      let releaseBooking!: () => void;
      const journeyLocked = new Promise<void>((resolve) => { signalJourneyLocked = resolve; });
      const bookingMayContinue = new Promise<void>((resolve) => { releaseBooking = resolve; });

      const booking = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT acquire_journey_mutation_shared_lock()`;
        await tx.$queryRaw`SELECT id FROM journeys WHERE id = ${journey.id}::uuid FOR UPDATE`;
        signalJourneyLocked();
        await bookingMayContinue;

        const ticket = await tx.ticket.create({
          data: {
            ticketNumber: `RACE-${suffix}`,
            idempotencyKey: `seat-race-ticket-${suffix}`,
            journeyId: journey.id,
            userId: user.id,
            originStopId: origin.id,
            destinationStopId: destination.id,
            pricePaid: 100n,
          },
        });

        await tx.seatReservation.create({
          data: {
            ticketId: ticket.id,
            journeyId: journey.id,
            seatId: layout.seats[0]!.id,
            fromSequence: 1,
            toSequence: 2,
            reservedUntil: new Date(Date.now() + 60_000),
          },
        });
        return ticket;
      }, { timeout: 15000 });

      await journeyLocked;
      // Changing a key column takes a stronger row lock and exercises the
      // lock-order hazard that a non-key isBookable update would not expose.
      const seatEdit = prisma.busSeat.update({
        where: { id: layout.seats[0]!.id },
        data: { seatNumber: "1B" },
      }).then(
        (value) => ({ fulfilled: true as const, value }),
        (error: unknown) => ({ fulfilled: false as const, error }),
      );

      let lockWaitError: unknown;
      try {
        // Observe the ungranted exclusive advisory lock rather than relying on a sleep.
        await waitForJourneyAdvisoryLock();
      } catch (error) {
        lockWaitError = error;
      } finally {
        releaseBooking();
      }

      await expect(booking).resolves.toMatchObject({ journeyId: journey.id });
      expect(lockWaitError).toBeUndefined();
      const seatEditOutcome = await seatEdit;
      expect(seatEditOutcome.fulfilled).toBe(false);
      if (seatEditOutcome.fulfilled) throw new Error("Seat edit unexpectedly succeeded");
      expect(String(seatEditOutcome.error)).toMatch(/seats cannot be structurally changed/);
    } finally {
      if (journeyId) {
        await prisma.seatReservation.deleteMany({ where: { journeyId } });
        await prisma.ticket.deleteMany({ where: { journeyId } });
        await prisma.journeyStop.deleteMany({ where: { journeyId } });
        await prisma.journey.deleteMany({ where: { id: journeyId } });
      }
      if (layoutId) await prisma.busLayout.deleteMany({ where: { id: layoutId } });
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  it("serializes a stop-sequence edit behind a booking without deadlocking", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    let userId: string | undefined;
    let journeyId: string | undefined;
    let layoutId: string | undefined;
    try {
      const user = await prisma.user.create({ data: { username: `stop_race_${suffix}`, displayName: "Stop Race Test Passenger" } });
      userId = user.id;
      const layout = await prisma.busLayout.create({
        data: { name: `Stop Race Coach ${suffix}`, capacity: 1, seats: { create: [{ seatNumber: "1A", rowNumber: 1, columnNumber: 1 }] } },
        include: { seats: true },
      });
      layoutId = layout.id;
      const journey = await prisma.journey.create({
        data: { name: `Stop Race Journey ${suffix}`, busLayoutId: layout.id, createdBy: user.id, status: JourneyStatus.DRAFT, stops: { create: [{ sequence: 1, name: "Origin" }, { sequence: 2, name: "Destination" }] } },
        include: { stops: { orderBy: { sequence: "asc" } } },
      });
      journeyId = journey.id;
      const [origin, destination] = journey.stops;
      if (!origin || !destination) throw new Error("Test journey stops were not created");
      let signalJourneyLocked!: () => void;
      let releaseBooking!: () => void;
      const journeyLocked = new Promise<void>((resolve) => { signalJourneyLocked = resolve; });
      const bookingMayContinue = new Promise<void>((resolve) => { releaseBooking = resolve; });
      const booking = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT acquire_journey_mutation_shared_lock()`;
        await tx.$queryRawUnsafe("SELECT id FROM journeys WHERE id = $1::uuid FOR UPDATE", journey.id);
        signalJourneyLocked();
        await bookingMayContinue;
        const ticket = await tx.ticket.create({ data: { ticketNumber: `STOP-RACE-${suffix}`, idempotencyKey: `stop-race-ticket-${suffix}`, journeyId: journey.id, userId: user.id, originStopId: origin.id, destinationStopId: destination.id, pricePaid: 100n } });
        await tx.seatReservation.create({ data: { ticketId: ticket.id, journeyId: journey.id, seatId: layout.seats[0]!.id, fromSequence: 1, toSequence: 2, reservedUntil: new Date(Date.now() + 60_000) } });
        return ticket;
      }, { timeout: 15000 });
      await journeyLocked;
      const stopEdit = prisma.journeyStop.update({ where: { id: destination.id }, data: { sequence: 3 } }).then(
        (value) => ({ fulfilled: true as const, value }),
        (error: unknown) => ({ fulfilled: false as const, error }),
      );
      let lockWaitError: unknown;
      try { await waitForJourneyAdvisoryLock(); }
      catch (error) { lockWaitError = error; }
      finally { releaseBooking(); }
      await expect(booking).resolves.toMatchObject({ journeyId: journey.id });
      expect(lockWaitError).toBeUndefined();
      const stopEditOutcome = await stopEdit;
      expect(stopEditOutcome.fulfilled).toBe(false);
      if (stopEditOutcome.fulfilled) throw new Error("Stop edit unexpectedly succeeded");
      expect(String(stopEditOutcome.error)).toMatch(/structurally changed after tickets exist/);
    } finally {
      if (journeyId) {
        await prisma.seatReservation.deleteMany({ where: { journeyId } });
        await prisma.ticket.deleteMany({ where: { journeyId } });
        await prisma.journeyStop.deleteMany({ where: { journeyId } });
        await prisma.journey.deleteMany({ where: { id: journeyId } });
      }
      if (layoutId) await prisma.busLayout.deleteMany({ where: { id: layoutId } });
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    }
  });
});
