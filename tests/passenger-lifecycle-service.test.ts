import { describe, expect, it, vi } from "vitest";
import { disembarkPassenger, markNoShow } from "../src/passenger-lifecycle-service.js";
import { BookingError } from "../src/errors.js";

function databaseWithInactiveOperator() {
  const tx = {
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  return {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as never;
}

describe("operator passenger lifecycle authorization", () => {
  it("rejects disembarkation when the actor is not an active operator", async () => {
    await expect(disembarkPassenger(databaseWithInactiveOperator(), "user-1", "ticket-1"))
      .rejects.toMatchObject<Partial<BookingError>>({ code: "BOARDING_NOT_ALLOWED" });
  });

  it("rejects no-show finalization when the actor is not an active operator", async () => {
    await expect(markNoShow(databaseWithInactiveOperator(), "user-1", "ticket-1"))
      .rejects.toMatchObject<Partial<BookingError>>({ code: "BOARDING_NOT_ALLOWED" });
  });
});
