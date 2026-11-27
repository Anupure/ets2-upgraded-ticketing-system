import { describe, expect, it, vi } from "vitest";
import { createApiHandler, type ApiRequest } from "../src/http-api.js";
import type { Db } from "../src/booking-service.js";

function makeHandler(overrides: Record<string, unknown> = {}, userId: string | null = null) {
  const db = {
    journey: { findFirst: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    wallet: { findUnique: vi.fn() },
    ...overrides,
  } as unknown as Db;
  const getSession = vi.fn(async () => userId ? { userId } : null);
  return { handle: createApiHandler({ db, getSession }), db, getSession };
}

describe("HTTP API boundary", () => {
  it("requires a verified session before ticket purchase", async () => {
    const { handle, db } = makeHandler();
    const request: ApiRequest = {
      method: "POST",
      url: "/api/journeys/11111111-1111-4111-8111-111111111111/tickets",
      body: {
        originStopId: "22222222-2222-4222-8222-222222222222",
        destinationStopId: "33333333-3333-4333-8333-333333333333",
        seatNumber: "12",
      },
      headers: { "Idempotency-Key": "stable-key" },
    };

    await expect(handle(request)).resolves.toMatchObject({ status: 401 });
    expect(db.journey.findUnique).not.toHaveBeenCalled();
  });

  it("rejects client-supplied identity and unknown booking fields", async () => {
    const { handle, db } = makeHandler({}, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const request: ApiRequest = {
      method: "POST",
      url: "/api/journeys/11111111-1111-4111-8111-111111111111/tickets",
      headers: { "Idempotency-Key": "stable-key" },
      body: {
        originStopId: "22222222-2222-4222-8222-222222222222",
        destinationStopId: "33333333-3333-4333-8333-333333333333",
        seatNumber: "12",
        userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    };

    await expect(handle(request)).resolves.toMatchObject({ status: 400 });
    expect(db.journey.findUnique).not.toHaveBeenCalled();
  });

  it("serializes public journey BigInt fields as decimal strings", async () => {
    const journey = {
      id: "11111111-1111-4111-8111-111111111111",
      journeyNumber: 42n,
      name: "Test route",
      ticketPrice: 150n,
      stops: [],
    };
    const { handle, db } = makeHandler({
      journey: { findFirst: vi.fn().mockResolvedValue(journey), findUnique: vi.fn() },
    });

    const result = await handle({ method: "GET", url: "/api/journeys/active" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      journey: { journeyNumber: "42", ticketPrice: "150" },
    });
    expect(db.journey.findFirst).toHaveBeenCalledOnce();
  });

  it("returns 404 for unknown routes", async () => {
    const { handle } = makeHandler();
    await expect(handle({ method: "GET", url: "/api/does-not-exist" }))
      .resolves.toMatchObject({ status: 404 });
  });

  it("maps an operator authorization failure to 403", async () => {
    const { handle } = makeHandler({
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const result = await handle({
      method: "GET",
      url: "/api/operator/journeys/11111111-1111-4111-8111-111111111111/dashboard",
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: "OPERATOR_REQUIRED" } });
  });

  it("maps an operator journey state conflict to 409", async () => {
    const { handle } = makeHandler({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "OPERATOR",
          status: "ACTIVE",
        }),
      },
      journey: {
        findFirst: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const result = await handle({
      method: "GET",
      url: "/api/operator/journeys/11111111-1111-4111-8111-111111111111/dashboard",
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: { code: "JOURNEY_NOT_OPEN" } });
  });

  it("requires an operator session before a no-show action", async () => {
    const { handle, db } = makeHandler({}, null);
    const result = await handle({
      method: "POST",
      url: "/api/operator/tickets/11111111-1111-4111-8111-111111111111/no-show",
      body: {},
    });
    expect(result.status).toBe(401);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
