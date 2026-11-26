-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PASSENGER', 'MODERATOR', 'OPERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('YOUTUBE');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'BOOKING_OPEN', 'BOARDING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StopStatus" AS ENUM ('UPCOMING', 'ARRIVED', 'BOARDING_OPEN', 'DEPARTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'LEFT_BEHIND');

-- CreateEnum
CREATE TYPE "SeatType" AS ENUM ('STANDARD', 'WINDOW', 'AISLE', 'ACCESSIBLE', 'OPERATOR', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "SeatReservationStatus" AS ENUM ('HELD', 'CONFIRMED', 'OCCUPIED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PassengerJourneyStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'ONBOARD', 'COMPLETED', 'NO_SHOW', 'LEFT_BEHIND', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BoardingEventType" AS ENUM ('CHECK_IN', 'BOARDED', 'DISEMBARKED', 'NO_SHOW', 'REJECTED', 'LEFT_BEHIND');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('INITIAL_BONUS', 'TICKET_PURCHASE', 'TICKET_REFUND', 'REWARD', 'ADMIN_CREDIT', 'ADMIN_DEBIT', 'EVENT_REWARD');

-- CreateEnum
CREATE TYPE "BreakType" AS ENUM ('PERSONAL', 'MANDATORY');

-- CreateEnum
CREATE TYPE "BreakStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'BREAK_STARTED', 'RETURNED', 'REJECTED', 'EXPIRED', 'LEFT_BEHIND', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BreakCreditTransactionType" AS ENUM ('INITIAL_ALLOWANCE', 'BREAK_USED', 'ADMIN_GRANT', 'REFUND');

-- CreateEnum
CREATE TYPE "StreamStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(30) NOT NULL,
    "display_name" VARCHAR(60) NOT NULL,
    "email" VARCHAR(255),
    "name" VARCHAR(120),
    "email_verified" TIMESTAMPTZ(3),
    "image" TEXT,
    "avatar_id" UUID,
    "role" "UserRole" NOT NULL DEFAULT 'PASSENGER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatars" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "image_url" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(255) NOT NULL,
    "provider" VARCHAR(255) NOT NULL,
    "provider_account_id" VARCHAR(255) NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" VARCHAR(255),
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" VARCHAR(255),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "session_token" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" VARCHAR(255) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL
);

-- CreateTable
CREATE TABLE "chat_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'YOUTUBE',
    "platform_user_id" VARCHAR(255) NOT NULL,
    "platform_username" VARCHAR(100) NOT NULL,
    "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "actor_id" UUID,
    "amount" BIGINT NOT NULL,
    "transaction_type" "WalletTransactionType" NOT NULL,
    "reference_type" VARCHAR(60),
    "reference_id" UUID,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_layouts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "layout_json" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bus_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_seats" (
    "id" UUID NOT NULL,
    "bus_layout_id" UUID NOT NULL,
    "seat_number" VARCHAR(10) NOT NULL,
    "row_number" INTEGER NOT NULL,
    "column_number" INTEGER NOT NULL,
    "seat_type" "SeatType" NOT NULL DEFAULT 'STANDARD',
    "is_bookable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bus_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journeys" (
    "id" UUID NOT NULL,
    "journey_number" BIGSERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "bus_layout_id" UUID NOT NULL,
    "status" "JourneyStatus" NOT NULL DEFAULT 'DRAFT',
    "ticket_price" BIGINT NOT NULL DEFAULT 150,
    "break_interval_minutes" INTEGER NOT NULL DEFAULT 150,
    "personal_break_limit" INTEGER NOT NULL DEFAULT 2,
    "personal_break_seconds" INTEGER NOT NULL DEFAULT 120,
    "grace_period_seconds" INTEGER NOT NULL DEFAULT 30,
    "current_stop_sequence" INTEGER,
    "departure_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_stops" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "location_description" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "arrival_at" TIMESTAMPTZ(3),
    "departed_at" TIMESTAMPTZ(3),
    "status" "StopStatus" NOT NULL DEFAULT 'UPCOMING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "ticket_number" VARCHAR(30) NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "journey_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "origin_stop_id" UUID NOT NULL,
    "destination_stop_id" UUID NOT NULL,
    "price_paid" BIGINT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'CONFIRMED',
    "purchased_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_at" TIMESTAMPTZ(3),
    "boarded_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_reservations" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "from_sequence" INTEGER NOT NULL,
    "to_sequence" INTEGER NOT NULL,
    "status" "SeatReservationStatus" NOT NULL DEFAULT 'HELD',
    "reserved_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),

    CONSTRAINT "seat_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_journeys" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "status" "PassengerJourneyStatus" NOT NULL DEFAULT 'BOOKED',
    "current_stop_sequence" INTEGER,
    "actual_boarded_at" TIMESTAMPTZ(3),
    "actual_disembarked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "passenger_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boarding_events" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "stop_id" UUID NOT NULL,
    "event_type" "BoardingEventType" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boarding_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_requests" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "passenger_journey_id" UUID,
    "requested_by_id" UUID,
    "break_type" "BreakType" NOT NULL,
    "status" "BreakStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "deadline_at" TIMESTAMPTZ(3),
    "grace_deadline_at" TIMESTAMPTZ(3),
    "returned_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "operator_notes" TEXT,

    CONSTRAINT "break_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_credit_transactions" (
    "id" UUID NOT NULL,
    "passenger_journey_id" UUID NOT NULL,
    "break_request_id" UUID,
    "amount" INTEGER NOT NULL,
    "transaction_type" "BreakCreditTransactionType" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stream_sessions" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'YOUTUBE',
    "broadcast_id" VARCHAR(255) NOT NULL,
    "live_chat_id" VARCHAR(255),
    "status" "StreamStatus" NOT NULL DEFAULT 'SCHEDULED',
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stream_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_command_logs" (
    "id" UUID NOT NULL,
    "stream_session_id" UUID NOT NULL,
    "platform_message_id" VARCHAR(255) NOT NULL,
    "platform_user_id" VARCHAR(255) NOT NULL,
    "command" VARCHAR(60) NOT NULL,
    "response" TEXT,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_command_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_events" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "actor_id" UUID,
    "event_type" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journey_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" UUID,
    "old_values" JSONB,
    "new_values" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "avatars_is_active_sort_order_idx" ON "avatars"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "chat_identities_user_id_idx" ON "chat_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_identities_platform_platform_user_id_key" ON "chat_identities"("platform", "platform_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_idempotency_key_key" ON "wallet_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "wallet_transactions"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_reference_type_reference_id_idx" ON "wallet_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "bus_seats_bus_layout_id_row_number_column_number_idx" ON "bus_seats"("bus_layout_id", "row_number", "column_number");

-- CreateIndex
CREATE UNIQUE INDEX "bus_seats_bus_layout_id_seat_number_key" ON "bus_seats"("bus_layout_id", "seat_number");

-- CreateIndex
CREATE UNIQUE INDEX "journeys_journey_number_key" ON "journeys"("journey_number");

-- CreateIndex
CREATE INDEX "journeys_status_created_at_idx" ON "journeys"("status", "created_at");

-- CreateIndex
CREATE INDEX "journey_stops_journey_id_status_idx" ON "journey_stops"("journey_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journey_stops_journey_id_sequence_key" ON "journey_stops"("journey_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_ticket_number_key" ON "tickets"("ticket_number");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_idempotency_key_key" ON "tickets"("idempotency_key");

-- CreateIndex
CREATE INDEX "tickets_journey_id_status_idx" ON "tickets"("journey_id", "status");

-- CreateIndex
CREATE INDEX "tickets_user_id_purchased_at_idx" ON "tickets"("user_id", "purchased_at");

-- CreateIndex
CREATE INDEX "seat_reservations_journey_id_seat_id_status_idx" ON "seat_reservations"("journey_id", "seat_id", "status");

-- CreateIndex
CREATE INDEX "seat_reservations_ticket_id_idx" ON "seat_reservations"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "passenger_journeys_ticket_id_key" ON "passenger_journeys"("ticket_id");

-- CreateIndex
CREATE INDEX "passenger_journeys_journey_id_status_idx" ON "passenger_journeys"("journey_id", "status");

-- CreateIndex
CREATE INDEX "passenger_journeys_user_id_created_at_idx" ON "passenger_journeys"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "boarding_events_ticket_id_created_at_idx" ON "boarding_events"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "boarding_events_stop_id_event_type_idx" ON "boarding_events"("stop_id", "event_type");

-- CreateIndex
CREATE INDEX "break_requests_journey_id_status_requested_at_idx" ON "break_requests"("journey_id", "status", "requested_at");

-- CreateIndex
CREATE INDEX "break_requests_passenger_journey_id_requested_at_idx" ON "break_requests"("passenger_journey_id", "requested_at");

-- CreateIndex
CREATE INDEX "break_credit_transactions_passenger_journey_id_created_at_idx" ON "break_credit_transactions"("passenger_journey_id", "created_at");

-- CreateIndex
CREATE INDEX "stream_sessions_journey_id_status_idx" ON "stream_sessions"("journey_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stream_sessions_platform_broadcast_id_key" ON "stream_sessions"("platform", "broadcast_id");

-- CreateIndex
CREATE INDEX "chat_command_logs_stream_session_id_processed_at_idx" ON "chat_command_logs"("stream_session_id", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_command_logs_stream_session_id_platform_message_id_key" ON "chat_command_logs"("stream_session_id", "platform_message_id");

-- CreateIndex
CREATE INDEX "journey_events_journey_id_created_at_idx" ON "journey_events"("journey_id", "created_at");

-- CreateIndex
CREATE INDEX "journey_events_event_type_created_at_idx" ON "journey_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "avatars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_identities" ADD CONSTRAINT "chat_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_seats" ADD CONSTRAINT "bus_seats_bus_layout_id_fkey" FOREIGN KEY ("bus_layout_id") REFERENCES "bus_layouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_bus_layout_id_fkey" FOREIGN KEY ("bus_layout_id") REFERENCES "bus_layouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_stops" ADD CONSTRAINT "journey_stops_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_origin_stop_id_fkey" FOREIGN KEY ("origin_stop_id") REFERENCES "journey_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_destination_stop_id_fkey" FOREIGN KEY ("destination_stop_id") REFERENCES "journey_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_reservations" ADD CONSTRAINT "seat_reservations_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_reservations" ADD CONSTRAINT "seat_reservations_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_reservations" ADD CONSTRAINT "seat_reservations_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "bus_seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_journeys" ADD CONSTRAINT "passenger_journeys_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_journeys" ADD CONSTRAINT "passenger_journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_journeys" ADD CONSTRAINT "passenger_journeys_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boarding_events" ADD CONSTRAINT "boarding_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boarding_events" ADD CONSTRAINT "boarding_events_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "journey_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_requests" ADD CONSTRAINT "break_requests_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_requests" ADD CONSTRAINT "break_requests_passenger_journey_id_fkey" FOREIGN KEY ("passenger_journey_id") REFERENCES "passenger_journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_requests" ADD CONSTRAINT "break_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_credit_transactions" ADD CONSTRAINT "break_credit_transactions_passenger_journey_id_fkey" FOREIGN KEY ("passenger_journey_id") REFERENCES "passenger_journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_credit_transactions" ADD CONSTRAINT "break_credit_transactions_break_request_id_fkey" FOREIGN KEY ("break_request_id") REFERENCES "break_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stream_sessions" ADD CONSTRAINT "stream_sessions_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_command_logs" ADD CONSTRAINT "chat_command_logs_stream_session_id_fkey" FOREIGN KEY ("stream_session_id") REFERENCES "stream_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_events" ADD CONSTRAINT "journey_events_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_events" ADD CONSTRAINT "journey_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Custom PostgreSQL integrity constraints
-- Apply after the Prisma-generated initial migration, or incorporate these
-- statements into the initial migration before deploying to production.
-- Prisma cannot express partial unique indexes, exclusion constraints,
-- cross-table segment validation, or all business invariants in schema.prisma.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Only one operational journey may exist at a time.
CREATE UNIQUE INDEX journeys_one_operational_journey
ON journeys ((true))
WHERE status IN ('BOOKING_OPEN', 'BOARDING', 'IN_PROGRESS', 'PAUSED');

-- MVP policy: one non-terminal ticket per passenger per journey.
CREATE UNIQUE INDEX tickets_one_active_per_user_per_journey
ON tickets (journey_id, user_id)
WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'BOARDED');

-- Prevent overlapping allocations for the same seat on the same journey.
-- Half-open ranges [from, to) allow a seat to be reused at the exact stop
-- where the previous passenger disembarks.
ALTER TABLE seat_reservations
ADD CONSTRAINT seat_reservations_valid_segment
CHECK (from_sequence >= 1 AND to_sequence > from_sequence);

ALTER TABLE seat_reservations
ADD CONSTRAINT seat_reservations_no_overlap
EXCLUDE USING gist (
  journey_id WITH =,
  seat_id WITH =,
  int4range(from_sequence, to_sequence, '[)') WITH &&
)
WHERE (status IN ('HELD', 'CONFIRMED', 'OCCUPIED'));

-- A held seat must have an expiry; confirmed/occupied reservations do not.
ALTER TABLE seat_reservations
ADD CONSTRAINT seat_reservations_held_expiry
CHECK (status <> 'HELD' OR reserved_until IS NOT NULL);

-- Basic non-negative/configuration checks.
ALTER TABLE wallets
ADD CONSTRAINT wallets_balance_nonnegative CHECK (balance >= 0);

ALTER TABLE journeys
ADD CONSTRAINT journeys_positive_capacity_settings CHECK (
  break_interval_minutes > 0 AND
  personal_break_limit >= 0 AND
  personal_break_seconds > 0 AND
  grace_period_seconds >= 0 AND
  ticket_price >= 0
);

ALTER TABLE bus_layouts
ADD CONSTRAINT bus_layouts_capacity_positive CHECK (capacity > 0);

ALTER TABLE bus_seats
ADD CONSTRAINT bus_seats_coordinates_positive CHECK (
  row_number > 0 AND column_number > 0
);

ALTER TABLE tickets
ADD CONSTRAINT tickets_price_nonnegative CHECK (price_paid >= 0);

ALTER TABLE break_credit_transactions
ADD CONSTRAINT break_credit_transactions_nonzero CHECK (amount <> 0);

-- Validate that ticket origin/destination belong to the same journey and
-- that origin sequence is strictly before destination sequence.
CREATE OR REPLACE FUNCTION validate_ticket_segment()
RETURNS trigger AS $$
DECLARE
  origin_journey uuid;
  destination_journey uuid;
  origin_sequence integer;
  destination_sequence integer;
BEGIN
  SELECT journey_id, sequence
    INTO origin_journey, origin_sequence
    FROM journey_stops WHERE id = NEW.origin_stop_id;

  SELECT journey_id, sequence
    INTO destination_journey, destination_sequence
    FROM journey_stops WHERE id = NEW.destination_stop_id;

  IF origin_journey IS NULL OR destination_journey IS NULL THEN
    RAISE EXCEPTION 'Ticket origin and destination must reference existing journey stops';
  END IF;

  IF origin_journey <> NEW.journey_id OR destination_journey <> NEW.journey_id THEN
    RAISE EXCEPTION 'Ticket stops must belong to the ticket journey';
  END IF;

  IF origin_sequence >= destination_sequence THEN
    RAISE EXCEPTION 'Ticket origin must precede destination';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_validate_segment
BEFORE INSERT OR UPDATE OF journey_id, origin_stop_id, destination_stop_id
ON tickets
FOR EACH ROW EXECUTE FUNCTION validate_ticket_segment();

-- Validate that a seat belongs to the bus layout assigned to the journey,
-- and that reservation segment is inside the journey's stop range.
CREATE OR REPLACE FUNCTION validate_seat_reservation()
RETURNS trigger AS $$
DECLARE
  journey_layout uuid;
  seat_layout uuid;
  max_sequence integer;
BEGIN
  SELECT bus_layout_id INTO journey_layout
    FROM journeys WHERE id = NEW.journey_id;

  SELECT bus_layout_id INTO seat_layout
    FROM bus_seats WHERE id = NEW.seat_id;

  SELECT MAX(sequence) INTO max_sequence
    FROM journey_stops WHERE journey_id = NEW.journey_id;

  IF journey_layout IS NULL OR seat_layout IS NULL OR journey_layout <> seat_layout THEN
    RAISE EXCEPTION 'Seat must belong to the bus layout assigned to the journey';
  END IF;

  IF max_sequence IS NULL OR NEW.from_sequence < 1 OR NEW.to_sequence > max_sequence OR NEW.to_sequence <= NEW.from_sequence THEN
    RAISE EXCEPTION 'Seat reservation segment is outside the journey stop range';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = NEW.ticket_id
      AND t.journey_id = NEW.journey_id
      AND (SELECT sequence FROM journey_stops WHERE id = t.origin_stop_id) = NEW.from_sequence
      AND (SELECT sequence FROM journey_stops WHERE id = t.destination_stop_id) = NEW.to_sequence
  ) THEN
    RAISE EXCEPTION 'Seat reservation segment must match its ticket segment';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seat_reservations_validate
BEFORE INSERT OR UPDATE OF ticket_id, journey_id, seat_id, from_sequence, to_sequence
ON seat_reservations
FOR EACH ROW EXECUTE FUNCTION validate_seat_reservation();

-- One active personal break request per passenger journey.
CREATE UNIQUE INDEX break_requests_one_open_personal_break
ON break_requests (passenger_journey_id)
WHERE break_type = 'PERSONAL'
  AND passenger_journey_id IS NOT NULL
  AND status IN ('REQUESTED', 'ACCEPTED', 'BREAK_STARTED');

-- One live/pending stream session per journey.
CREATE UNIQUE INDEX stream_sessions_one_live_per_journey
ON stream_sessions (journey_id)
WHERE status IN ('SCHEDULED', 'LIVE', 'DISCONNECTED');

-- At most one passenger-requested break may be pending/active for the whole bus.
-- Mandatory breaks are controlled separately by the operator.
CREATE UNIQUE INDEX break_requests_one_open_personal_break_per_journey
ON break_requests (journey_id, (true))
WHERE break_type = 'PERSONAL'
  AND status IN ('REQUESTED', 'ACCEPTED', 'BREAK_STARTED');
