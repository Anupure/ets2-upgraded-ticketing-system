import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const schemaPath = "roguerpm-db/prisma/schema.prisma";
const prismaCli = resolve("node_modules/prisma/build/index.js");
const isCi = process.env.CI === "true";

function fail(message) {
  console.error(`Database safety check failed: ${message}`);
  process.exit(1);
}

function readLocalEnvironment() {
  // GitHub Actions uses its disposable PostgreSQL service, never a developer's
  // Neon database. Accept only explicit loopback URLs in CI.
  if (isCi) {
    return {
      DB_ENVIRONMENT: process.env.DB_ENVIRONMENT,
      DATABASE_URL: process.env.DATABASE_URL,
      DIRECT_URL: process.env.DIRECT_URL,
    };
  }

  let content;
  try {
    content = readFileSync(resolve(".env.integration"), "utf8");
  } catch {
    fail("Could not read .env.integration. Copy .env.integration.example to .env.integration and configure a dedicated empty Neon integration-test branch.");
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
        fail(`Invalid quoted value for ${key} on line ${index + 1} of .env.integration.`);
      }
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'")) fail(`Unclosed quote for ${key} on line ${index + 1} of .env.integration.`);
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
  if (!value) fail(`${name} is missing from ${isCi ? "the CI job environment" : ".env.integration"}.`);

  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} is not a valid PostgreSQL connection URL.`);
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    fail(`${name} must use PostgreSQL.`);
  }

  const host = url.hostname.toLowerCase();
  const loopbackHosts = ["localhost", "127.0.0.1", "::1", "[::1]"];
  if (isCi ? !loopbackHosts.includes(host) : !host.endsWith(".neon.tech")) {
    fail(isCi
      ? `${name} must point to the disposable local CI PostgreSQL service; refusing any external database.`
      : `${name} must point to a Neon host; refusing an unknown target.`);
  }

  return {
    host,
    port: url.port || (url.protocol === "postgres:" ? "5432" : "5432"),
    normalizedHost: host.replace("-pooler.", "."),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    pooled: host.includes("-pooler."),
  };
}

if (localEnv.DB_ENVIRONMENT !== "test") {
  fail(`Set DB_ENVIRONMENT="test" in ${isCi ? "the CI job environment" : ".env.integration"} before running database tests.`);
}

const pooled = parseConnection("DATABASE_URL");
const direct = parseConnection("DIRECT_URL");

if (isCi) {
  if (pooled.host !== direct.host || pooled.port !== direct.port) {
    fail("DATABASE_URL and DIRECT_URL must point to the same local CI PostgreSQL service.");
  }
} else {
  if (!pooled.pooled) {
    fail("DATABASE_URL must use the Neon pooled hostname (containing -pooler.).");
  }
  if (direct.pooled) {
    fail("DIRECT_URL must use the Neon direct hostname (without -pooler.).");
  }
  const expectedHost = localEnv.DB_EXPECTED_BRANCH_HOST?.toLowerCase();
  if (!expectedHost || expectedHost !== direct.host) {
    fail("DIRECT_URL does not match DB_EXPECTED_BRANCH_HOST in .env.integration.");
  }
  if (pooled.normalizedHost !== direct.normalizedHost) {
    fail("DATABASE_URL and DIRECT_URL point to different Neon branches.");
  }
}

if (pooled.database !== direct.database) {
  fail("DATABASE_URL and DIRECT_URL point to different database names.");
}

const args = process.argv.slice(2);
if (args.length === 0) {
  fail("No command supplied.");
}

// Vitest does not automatically load .env.integration. Run it through this guard so
// integration tests receive the verified TEST database URLs, never inherited
// shell values (which could point at production).
const isVitest = args[0] === "test";
const vitestCli = resolve("node_modules/vitest/vitest.mjs");
const command = isVitest ? vitestCli : prismaCli;
const commandArgs = isVitest
  ? args.slice(1)
  : [...args, "--schema", schemaPath];

if (isVitest && commandArgs.length === 0) {
  commandArgs.push("run");
}

console.log(isCi
  ? "Database target verified: disposable local CI PostgreSQL service."
  : "Database target verified: dedicated Neon INTEGRATION branch.");
console.log(`Host: ${direct.host}`);
console.log(`Database: ${direct.database}`);
console.log(`Running: ${isVitest ? "vitest" : "prisma"} ${commandArgs.join(" ")}`);

const result = spawnSync(process.execPath, [command, ...commandArgs], {
  stdio: "inherit",
  env: {
    ...process.env,
    DB_ENVIRONMENT: localEnv.DB_ENVIRONMENT,
    DATABASE_URL: localEnv.DATABASE_URL,
    DIRECT_URL: localEnv.DIRECT_URL,
  },
});

if (result.error) {
  fail(`Could not start ${isVitest ? "Vitest" : "Prisma"}: ${result.error.message}`);
}

process.exit(result.status ?? 1);
