import { describe, expect, it, vi } from "vitest";
import { getOperatorDashboard, getPassengerManifest } from "../src/operator-dashboard-service.js";

function databaseWithInactiveOperator() {
  const tx = { user: { findUnique: vi.fn().mockResolvedValue(null) } };
  return {
    user: tx.user,
  } as never;
}

describe("operator dashboard authorization", () => {
  it("rejects dashboard access for a non-operator", async () => {
    await expect(getOperatorDashboard(databaseWithInactiveOperator(), "user-1", "journey-1"))
      .rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
  });

  it("rejects passenger manifest access for a non-operator", async () => {
    await expect(getPassengerManifest(databaseWithInactiveOperator(), "user-1", "journey-1", "stop-1"))
      .rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
  });
});
