import { describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { withSerializableRetry } from "../src/transaction.js";

const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
const serializationFailure = () => new Prisma.PrismaClientKnownRequestError(
  "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
  { code: "P2034", clientVersion: "test" },
);

describe("serializable transaction retry", () => {
  it("retries a serialization conflict and returns the successful attempt", async () => {
    const operation = vi.fn().mockRejectedValueOnce(serializationFailure()).mockResolvedValueOnce("committed");
    const db = { $transaction: vi.fn(async (callback: () => Promise<unknown>) => callback()) } as unknown as PrismaClient;
    await expect(withSerializableRetry(db, operation, options)).resolves.toBe("committed");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry domain or validation errors", async () => {
    const failure = new Error("invalid booking");
    const operation = vi.fn().mockRejectedValue(failure);
    const db = { $transaction: vi.fn(async (callback: () => Promise<unknown>) => callback()) } as unknown as PrismaClient;
    await expect(withSerializableRetry(db, operation, options)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured retry limit", async () => {
    const operation = vi.fn().mockRejectedValue(serializationFailure());
    const db = { $transaction: vi.fn(async (callback: () => Promise<unknown>) => callback()) } as unknown as PrismaClient;
    await expect(withSerializableRetry(db, operation, options, 2)).rejects.toMatchObject({ code: "P2034" });
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
