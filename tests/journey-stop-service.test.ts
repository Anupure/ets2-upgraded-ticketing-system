import { describe, expect, it, vi } from "vitest";
import {
  arriveAtStop, closeBooking, openBoardingAtStop, departStop,
} from "../src/journey-stop-service.js";

function databaseWithInactiveOperator() {
  const tx = { user: { findUnique: vi.fn().mockResolvedValue(null) } };
  return {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as never;
}

describe("operator journey stop controls", () => {
  it("rejects booking closure when the actor is not an active operator", async () => {
    await expect(closeBooking(databaseWithInactiveOperator(), "user-1", "journey-1"))
      .rejects.toMatchObject({ code: "BOARDING_NOT_ALLOWED" });
  });


  it("rejects arrival when the actor is not an active operator", async () => {
    await expect(arriveAtStop(databaseWithInactiveOperator(), "user-1", "journey-1", "stop-1"))
      .rejects.toMatchObject({ code: "BOARDING_NOT_ALLOWED" });
  });

  it("rejects opening boarding when the actor is not an active operator", async () => {
    await expect(openBoardingAtStop(databaseWithInactiveOperator(), "user-1", "journey-1", "stop-1"))
      .rejects.toMatchObject({ code: "BOARDING_NOT_ALLOWED" });
  });

  it("rejects departure when the actor is not an active operator", async () => {
    await expect(departStop(databaseWithInactiveOperator(), "user-1", "journey-1", "stop-1"))
      .rejects.toMatchObject({ code: "BOARDING_NOT_ALLOWED" });
  });
});
