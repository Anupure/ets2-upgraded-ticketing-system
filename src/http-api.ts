import type { Db } from "./booking-service.js";
import { checkIn, confirmBoarding, getSeatMap, purchaseTicket } from "./booking-service.js";
import { disembarkPassenger, markNoShow } from "./passenger-lifecycle-service.js";
import { getOperatorDashboard, getPassengerManifest } from "./operator-dashboard-service.js";
import {
  arriveAtStop,
  closeBooking,
  completeJourneyAtFinalStop,
  departStop,
  openBoardingAtStop,
} from "./journey-stop-service.js";
import { BookingError } from "./errors.js";

export interface ApiSession {
  /** Must come from a verified, server-side authentication session. */
  userId: string;
}

export interface ApiRequest {
  method: string;
  url: string;
  headers?: Readonly<Record<string, string | undefined>>;
  /** The hosting adapter must parse JSON; this dispatcher validates its shape. */
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface ApiDependencies {
  db: Db;
  /** Return null for anonymous requests. Never derive this from request body or query. */
  getSession(request: ApiRequest): Promise<ApiSession | null>;
}

const jsonSafe = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  )) as unknown;

function response(status: number, body: Record<string, unknown>): ApiResponse {
  return { status, body: jsonSafe(body) as Record<string, unknown> };
}

function header(request: ApiRequest, name: string): string | undefined {
  const entry = Object.entries(request.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function objectBody(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function mapError(error: unknown): ApiResponse {
  if (error instanceof BookingError) {
    const statusByCode: Record<string, number> = {
      USER_UNAVAILABLE: 403,
      WALLET_NOT_FOUND: 409,
      JOURNEY_NOT_OPEN: 409,
      INVALID_SEGMENT: 400,
      SEAT_UNAVAILABLE: 409,
      INSUFFICIENT_TOKENS: 409,
      ACTIVE_TICKET_EXISTS: 409,
      TICKET_NOT_FOUND: 404,
      CHECK_IN_CLOSED: 409,
      ALREADY_CHECKED_IN: 409,
      IDEMPOTENCY_CONFLICT: 409,
      BOARDING_NOT_ALLOWED: 403,
    };
    return response(statusByCode[error.code] ?? 400, {
      error: { code: error.code, message: error.message },
    });
  }
  if (error instanceof RangeError) {
    return response(400, { error: { code: "INVALID_REQUEST", message: error.message } });
  }
  // Do not leak SQL, Prisma metadata, stack traces or secrets to API clients.
  return response(500, { error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
}

/**
 * Framework-neutral HTTP API dispatcher. Mount this behind a Next.js route
 * handler or another HTTP adapter. Authentication is injected so the API
 * never trusts browser-supplied user IDs or roles.
 */
export function createApiHandler({ db, getSession }: ApiDependencies) {
  return async function handleApiRequest(request: ApiRequest): Promise<ApiResponse> {
    try {
      const url = new URL(request.url, "http://localhost");
      const method = request.method.toUpperCase();
      const path = url.pathname.replace(/\/$/, "") || "/";
      const session = await getSession(request);

      if (method === "GET" && path === "/api/journeys/active") {
        const journey = await db.journey.findFirst({
          where: { status: { in: ["BOOKING_OPEN", "BOARDING", "IN_PROGRESS", "PAUSED"] } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, journeyNumber: true, name: true, description: true,
            status: true, ticketPrice: true, currentStopSequence: true,
            departureAt: true, startedAt: true,
            stops: { orderBy: { sequence: "asc" }, select: {
              id: true, sequence: true, name: true, locationDescription: true,
              status: true, arrivalAt: true, departedAt: true,
            } },
          },
        });
        return response(200, { journey });
      }

      const seatMatch = path.match(/^\/api\/journeys\/([^/]+)\/seats$/);
      if (method === "GET" && seatMatch) {
        const journeyId = seatMatch[1]!;
        if (!isUuid(journeyId)) return response(400, { error: { code: "INVALID_ID", message: "Invalid journey ID." } });
        const fromRaw = url.searchParams.get("from");
        const toRaw = url.searchParams.get("to");
        if ((fromRaw === null) !== (toRaw === null)) {
          return response(400, { error: { code: "INVALID_SEGMENT", message: "Both from and to are required together." } });
        }
        const from = fromRaw === null ? undefined : Number(fromRaw);
        const to = toRaw === null ? undefined : Number(toRaw);
        if ((from !== undefined && !Number.isInteger(from)) || (to !== undefined && !Number.isInteger(to))) {
          return response(400, { error: { code: "INVALID_SEGMENT", message: "from and to must be integers." } });
        }
        return response(200, { seats: await getSeatMap(db, journeyId, from, to) });
      }

      const purchaseMatch = path.match(/^\/api\/journeys\/([^/]+)\/tickets$/);\n      if (method === "POST" && purchaseMatch) {
        if (!session) return response(401, { error: { code: "UNAUTHENTICATED", message: "Sign in to purchase a ticket." } });
        const body = objectBody(request.body);
        if (!body || !hasOnlyKeys(body, ["journeyId", "originStopId", "destinationStopId", "seatNumber"]) ||
            !isUuid(body.journeyId) || !isUuid(body.originStopId) ||
            !isUuid(body.destinationStopId) || typeof body.seatNumber !== "string" ||
            body.seatNumber.length < 1 || body.seatNumber.length > 10) {
          return response(400, { error: { code: "INVALID_BODY", message: "Provide originStopId, destinationStopId and seatNumber only." } });
        }
        const idempotencyKey = header(request, "Idempotency-Key");
        if (!idempotencyKey || idempotencyKey.length > 140) {
          return response(400, { error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide a stable Idempotency-Key header." } });
        }
        const journey = await db.journey.findUnique({
          where: { id: purchaseMatch[1] }, select: { ticketPrice: true },
        });
        if (!journey) return response(404, { error: { code: "JOURNEY_NOT_FOUND", message: "Journey not found." } });
        const result = await purchaseTicket(db, {
          userId: session.userId,
          journeyId: purchaseMatch[1]!,
          originStopId: body.originStopId,
          destinationStopId: body.destinationStopId,
          seatNumber: body.seatNumber,
          idempotencyKey,
          expectedPrice: journey.ticketPrice,
        });
        return response(result.replayed ? 200 : 201, {
          ticket: {
            id: result.ticket.id,
            ticketNumber: result.ticket.ticketNumber,
            status: result.ticket.status,
            pricePaid: result.ticket.pricePaid.toString(),
            purchasedAt: result.ticket.purchasedAt,
          },
          replayed: result.replayed,
        });
      }

      const checkInMatch = path.match(/^\/api\/tickets\/([^/]+)\/check-in$/);
      if (method === "POST" && checkInMatch) {
        if (!session) return response(401, { error: { code: "UNAUTHENTICATED", message: "Sign in to check in." } });
        if (!isUuid(checkInMatch[1])) return response(400, { error: { code: "INVALID_ID", message: "Invalid ticket ID." } });
        const result = await checkIn(db, session.userId, checkInMatch[1]);
        return response(200, { ticket: result.ticket, alreadyCheckedIn: result.alreadyCheckedIn });
      }

      const operatorTicketMatch = path.match(/^\/api\/operator\/tickets\/([^/]+)\/(board|disembark|no-show)$/);
      if (method === "POST" && operatorTicketMatch) {
        if (!session) return response(401, { error: { code: "UNAUTHENTICATED", message: "Sign in to perform this action." } });
        if (!isUuid(operatorTicketMatch[1])) return response(400, { error: { code: "INVALID_ID", message: "Invalid ticket ID." } });
        const ticketId = operatorTicketMatch[1];
        const action = operatorTicketMatch[2];
        if (action === "board") return response(200, await confirmBoarding(db, session.userId, ticketId));
        if (action === "disembark") return response(200, await disembarkPassenger(db, session.userId, ticketId));
        return response(200, await markNoShow(db, session.userId, ticketId));
      }

      const dashboardMatch = path.match(/^\/api\/operator\/journeys\/([^/]+)\/dashboard$/);
      if (method === "GET" && dashboardMatch) {
        if (!session) return response(401, { error: { code: "UNAUTHENTICATED", message: "Sign in to view the operator dashboard." } });
        if (!isUuid(dashboardMatch[1])) return response(400, { error: { code: "INVALID_ID", message: "Invalid journey ID." } });
        return response(200, { dashboard: await getOperatorDashboard(db, session.userId, dashboardMatch[1]) });
      }

      const manifestMatch = path.match(/^\/api\/operator\/journeys\/([^/]+)\/stops\/([^/]+)\/manifest$/);
      if (method === "GET" && manifestMatch) {
        if (!session) return response(401, { error: { code: "UNAUTHENTICATED", message: "Sign in to view the passenger manifest." } });
        if (!isUuid(manifestMatch[1]) || !isUuid(manifestMatch[2])) return response(400, { error: { code: "INVALID_ID", message: "Invalid journey or stop ID." } });
        return response(200, { manifest: await getPassengerManifest(db, session.userId, manifestMatch[1], manifestMatch[2]) });
      }

      const journeyAction = path.match(/^\/api\/operator\/journeys\/([^/]+)\/(close-booking|complete)$/);
      if (method === "POST" && journeyAction) {
        if (!session) return response(401, { error: { code: "UNAUTHENTICATED", message: "Sign in to control the journey." } });
        if (!isUuid(journeyAction[1])) return response(400, { error: { code: "INVALID_ID", message: "Invalid journey ID." } });
        const [, journeyId, action] = journeyAction;
        if (action === "close-booking") return response(200, await closeBooking(db, session.userId, journeyId!));
        return response(200, await completeJourneyAtFinalStop(db, session.userId, journeyId!));
      }

      const stopAction = path.match(/^\/api\/operator\/journeys\/([^/]+)\/stops\/([^/]+)\/(arrive|open-boarding|depart)$/);
      if (method === "POST" && stopAction) {
        if (!session) return response(401, { error: { code: "UNAUTHENTICATED", message: "Sign in to control journey stops." } });
        if (!isUuid(stopAction[1]) || !isUuid(stopAction[2])) return response(400, { error: { code: "INVALID_ID", message: "Invalid journey or stop ID." } });
        const [, journeyId, stopId, action] = stopAction;
        if (action === "arrive") return response(200, await arriveAtStop(db, session.userId, journeyId!, stopId!));
        if (action === "open-boarding") return response(200, await openBoardingAtStop(db, session.userId, journeyId!, stopId!));
        return response(200, await departStop(db, session.userId, journeyId!, stopId!));
      }

      if (method === "GET" && path === "/api/me/wallet") {
        if (!session) return response(401, { error: { code: "UNAUTHENTICATED", message: "Sign in to view your wallet." } });
        const user = await db.user.findUnique({ where: { id: session.userId }, select: { id: true, status: true } });
        if (!user || user.status !== "ACTIVE") return response(403, { error: { code: "USER_UNAVAILABLE", message: "User is unavailable." } });
        const wallet = await db.wallet.findUnique({ where: { userId: session.userId }, select: { balance: true } });
        if (!wallet) return response(404, { error: { code: "WALLET_NOT_FOUND", message: "Wallet has not been provisioned." } });
        return response(200, { balance: wallet.balance.toString() });
      }

      return response(404, { error: { code: "NOT_FOUND", message: "API route not found." } });
    } catch (error) {
      return mapError(error);
    }
  };
}
