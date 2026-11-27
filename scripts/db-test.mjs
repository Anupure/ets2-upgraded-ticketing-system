import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const schemaPath = "roguerpm-db/prisma/schema.prisma";
const prismaCli = resolve("node_modules/prisma/build/index.js");

function fail(message) {
  console.error(`Database safety check failed: ${message}`);
  process.exit(1);
}

function parseConnection(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is missing from .env.local.`);

  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} is not a valid PostgreSQL connection URL.`);
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    fail(`${name} must use PostgreSQL.`);
  }
  if (!url.hostname.endsWith(".neon.tech")) {
    fail(`${name} must point to a Neon host; refusing an unknown target.`);
  }

  return {
    host: url.hostname.toLowerCase(),
    normalizedHost: url.hostname.toLowerCase().replace("-pooler.", "."),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    pooled: url.hostname.toLowerCase().includes("-pooler."),
  };
}

if (process.env.DB_ENVIRONMENT !== "test") {
  fail('Set DB_ENVIRONMENT="test" in .env.local before using db:test:* commands.');
}

const pooled = parseConnection("DATABASE_URL");
const direct = parseConnection("DIRECT_URL");

if (!pooled.pooled) {
  fail("DATABASE_URL must use the Neon pooled hostname (containing -pooler.).");
}
if (direct.pooled) {
  fail("DIRECT_URL must use the Neon direct hostname (without -pooler.).");
}
if (pooled.normalizedHost !== direct.normalizedHost) {
  fail("DATABASE_URL and DIRECT_URL point to different Neon branches.");
}
if (pooled.database !== direct.database) {
  fail("DATABASE_URL and DIRECT_URL point to different database names.");
}

const args = process.argv.slice(2);
if (args.length === 0) {
  fail("No Prisma command supplied.");
}

console.log("Database target verified: Neon TEST branch.");
console.log(`Host: ${direct.host}`);
console.log(`Database: ${direct.database}`);
console.log(`Running: prisma ${args.join(" ")}`);

const result = spawnSync(process.execPath, [prismaCli, ...args, "--schema", schemaPath], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) fail(`Could not start Prisma: ${result.error.message}`);
process.exit(result.status ?? 1);
