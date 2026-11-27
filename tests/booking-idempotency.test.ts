import { describe, expect, it, vi } from "vitest";
import { purchaseTicket, type Db } from "../src/booking-service.js";

const input = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  journeyId: "11111111-1111-4111-8111-111111111111",
  originStopId: "22222222-2222-4222-8222-222222222222",
  destinationStopId: "33333333-3333-4333-8333-333333333333",
  seatNumber: "12",
  idempotencyKey: "stable-booking-key",
  expectedPrice: 150n,
};

function makeDb(seatNumber: string) {
  const prior = {
    id: "44444444-4444-4444-8444-444444444444",
    userId: input.userId,
    journeyId: input.journeyId,
    originStopId: input.originStopId,
    destinationStopId: input.destinationStopId,
    pricePaid: input.expectedPrice,
    seatReservations: [{ seat: { seatNumber } }],
  };
  const tx = { ticket: { findUnique: vi.fn().mockResolvedValue(prior) } };
  const db = {
    $transaction: vi.fn(async (operation: (transaction: unknown) => unknown) => operation(tx)),
  } as unknown as Db;
  return { db, tx };
}

describe("ticket purchase idempotency", () => {
  it("replays the original ticket when the same seat and payload are retried", async () => {
    const { db } = makeDb(input.seatNumber);

    await expect(purchaseTicket(db, input)).resolves.toMatchObject({
      replayed: true,
      ticket: { id: "44444444-4444-4444-8444-444444444444" },
    });
  });

  it("rejects reuse of an idempotency key with a different seat", async () => {
    const { db } = makeDb("13");

    await expect(purchaseTicket(db, input)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });
});
