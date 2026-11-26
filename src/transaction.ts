import { Prisma, PrismaClient } from "@prisma/client";

/** Retry only PostgreSQL serialization conflicts; never replay domain failures. */
export async function withSerializableRetry<T>(
  db: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { isolationLevel: Prisma.TransactionIsolationLevel; timeout?: number },
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(operation, options);
    } catch (error) {
      const serializationConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!serializationConflict || attempt >= maxAttempts) throw error;
      // Small bounded backoff prevents immediate retry collisions.
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}
