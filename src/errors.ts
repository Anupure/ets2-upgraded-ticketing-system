export type BookingErrorCode =
  | "USER_UNAVAILABLE" | "WALLET_NOT_FOUND" | "JOURNEY_NOT_OPEN"
  | "INVALID_SEGMENT" | "SEAT_UNAVAILABLE" | "INSUFFICIENT_TOKENS"
  | "ACTIVE_TICKET_EXISTS" | "TICKET_NOT_FOUND" | "CHECK_IN_CLOSED"
  | "ALREADY_CHECKED_IN" | "IDEMPOTENCY_CONFLICT"
  | "BOARDING_NOT_ALLOWED";

export class BookingError extends Error {
  constructor(public readonly code: BookingErrorCode, message: string) {
    super(message);
    this.name = "BookingError";
  }
}

export function isSeatConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; meta?: { code?: string; message?: string } };
  const message = `${e.message ?? ""} ${e.meta?.message ?? ""}`.toLowerCase();
  return message.includes("seat_reservations_no_overlap") ||
    (e.code === "P2004" && message.includes("exclusion constraint") && message.includes("seat_reservations"));
}
