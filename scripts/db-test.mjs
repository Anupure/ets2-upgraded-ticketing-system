import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const schemaPath = "roguerpm-db/prisma/schema.prisma";
const prismaCli = resolve("node_modules/prisma/build/index.js");

function fail(message) {
  console.error(`Database safety check failed: ${message}`);
  process.exit(1);
}

function readLocalEnvironment() {
  let content;
  try {
    content = readFileSync(resolve(".env.local"), "utf8");
  } catch {
    fail("Could not read .env.local. Create it from .env.example first.");
  }

  const values = {};
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;

    const [, key] = match;
    let value = match[2];
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        fail(`Invalid quoted value for ${key} on line ${index + 1} of .env.local.`);
      }
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'")) fail(`Unclosed quote for ${key} on line ${index + 1} of .env.local.`);
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[key] = value;
  }
  return values;
}

const localEnv = readLocalEnvironment();

function parseConnection(name) {
  const value = localEnv[name];
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
  if (!url.hostname.toLowerCase().endsWith(".neon.tech")) {
    fail(`${name} must point to a Neon host; refusing an unknown target.`);
  }

  return {
    host: url.hostname.toLowerCase(),
    normalizedHost: url.hostname.toLowerCase().replace("-pooler.", "."),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    pooled: url.hostname.toLowerCase().includes("-pooler."),
  };
}

if (localEnv.DB_ENVIRONMENT !== "test") {
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
const expectedHost = localEnv.DB_EXPECTED_BRANCH_HOST?.toLowerCase();
if (!expectedHost || expectedHost !== direct.host) {
  fail("DIRECT_URL does not match DB_EXPECTED_BRANCH_HOST in .env.local.");
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
  env: {
    ...process.env,
    DB_ENVIRONMENT: localEnv.DB_ENVIRONMENT,
    DATABASE_URL: localEnv.DATABASE_URL,
    DIRECT_URL: localEnv.DIRECT_URL,
  },
});

if (result.error) fail(`Could not start Prisma: ${result.error.message}`);
process.exit(result.status ?? 1);
