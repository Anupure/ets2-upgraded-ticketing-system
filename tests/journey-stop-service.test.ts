import { describe, expect, it, vi } from "vitest";
import {
  arriveAtStop, closeBooking, openBoardingAtStop, departStop, completeJourneyAtFinalStop,
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
      .rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
  });

  it("rejects arrival when the actor is not an active operator", async () => {
    await expect(arriveAtStop(databaseWithInactiveOperator(), "user-1", "journey-1", "stop-1"))
      .rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
  });

  it("rejects opening boarding when the actor is not an active operator", async () => {
    await expect(openBoardingAtStop(databaseWithInactiveOperator(), "user-1", "journey-1", "stop-1"))
      .rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
  });

  it("rejects final completion when the actor is not an active operator", async () => {
    await expect(completeJourneyAtFinalStop(databaseWithInactiveOperator(), "user-1", "journey-1"))
      .rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
  });

  it("rejects departure when the actor is not an active operator", async () => {
    await expect(departStop(databaseWithInactiveOperator(), "user-1", "journey-1", "stop-1"))
      .rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
  });

  it("blocks departure while a passenger due to board remains unresolved", async () => {
    const stop = { id: "stop-1", sequence: 1, status: "BOARDING_OPEN" };
    const journey = {
      id: "journey-1",
      status: "BOARDING",
      currentStopSequence: 1,
      stops: [stop, { id: "stop-2", sequence: 2, status: "UPCOMING" }],
    };
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: "operator-1", role: "OPERATOR", status: "ACTIVE" }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: "journey-1" }]),
      journey: { findUnique: vi.fn().mockResolvedValue(journey) },
      ticket: { findMany: vi.fn().mockResolvedValue([{ id: "ticket-pending-board" }]) },
    };
    const db = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never;

    await expect(departStop(db, "operator-1", "journey-1", "stop-1"))
      .rejects.toMatchObject({ code: "BOARDING_NOT_ALLOWED" });
    expect(tx.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        journeyId: "journey-1",
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
        originStop: { sequence: 1 },
      }),
    }));
  });
});
