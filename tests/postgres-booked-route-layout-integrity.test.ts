import { randomUUID } from "node:crypto";
import { PrismaClient, JourneyStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("booked route and bus layout integrity", () => {
  it("freezes structural edits after ticketing but permits stop metadata corrections", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    let userId: string | undefined;
    let journeyId: string | undefined;
    let layoutId: string | undefined;
    let alternateLayoutId: string | undefined;
    let ticketId: string | undefined;

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
          status: JourneyStatus.BOOKING_OPEN,
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
      ticketId = ticket.id;

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
});
