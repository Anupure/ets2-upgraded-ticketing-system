import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient();

integration("PostgreSQL integrity schema", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("installs the GiST range support and active-journey uniqueness index", async () => {
    const extensions = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'btree_gist'
    `;
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'journeys_one_operational_journey',
          'tickets_one_active_per_user_per_journey',
          'seat_reservations_no_overlap'
        )
    `;

    expect(extensions.map((row) => row.extname)).toContain("btree_gist");
    expect(indexes.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      "journeys_one_operational_journey",
      "tickets_one_active_per_user_per_journey",
      "seat_reservations_no_overlap",
    ]));
  });

  it("installs the cross-table ticket and seat reservation validation triggers", async () => {
    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN ('tickets_validate_segment', 'seat_reservations_validate')
    `;

    expect(triggers.map((row) => row.tgname)).toEqual(expect.arrayContaining([
      "tickets_validate_segment",
      "seat_reservations_validate",
    ]));
  });
});
