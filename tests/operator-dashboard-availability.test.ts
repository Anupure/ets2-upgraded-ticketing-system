import { describe, expect, it } from "vitest";
import { calculateSeatAvailability } from "../src/operator-dashboard-service.js";

describe("operator dashboard seat availability", () => {
  const stops = [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }];

  it("reports the tightest leg before the journey starts and allows adjacent-leg seat reuse", () => {
    const result = calculateSeatAvailability(stops, [
      { seatId: "seat-1", fromSequence: 1, toSequence: 3 },
      { seatId: "seat-2", fromSequence: 1, toSequence: 2 },
      { seatId: "seat-2", fromSequence: 2, toSequence: 3 },
    ], 42, null);

    expect(result).toEqual({ reservedSeats: 2, availableSeats: 40, scope: "tightest-route-leg" });
  });

  it("reports availability only for the current leg after departure", () => {
    const result = calculateSeatAvailability(stops, [
      { seatId: "seat-1", fromSequence: 1, toSequence: 2 },
      { seatId: "seat-2", fromSequence: 2, toSequence: 3 },
    ], 42, 2);

    expect(result).toEqual({ reservedSeats: 1, availableSeats: 41, scope: "current-leg" });
  });

  it("does not count one seat more than once on the same leg", () => {
    const result = calculateSeatAvailability(stops, [
      { seatId: "seat-1", fromSequence: 1, toSequence: 3 },
      { seatId: "seat-1", fromSequence: 1, toSequence: 2 },
    ], 42, null);

    expect(result.reservedSeats).toBe(1);
    expect(result.availableSeats).toBe(41);
  });
});
