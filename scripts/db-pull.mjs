#!/usr/bin/env node
/**
 * Replace the local D1 database with a fresh export of production.
 *
 * Resolves the database through the `DB` binding in wrangler.toml rather than the
 * database name, so it works in any fork of this template without editing.
 *
 * Usage: npm run db:pull [-- ./some-other-file.sql]
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const BINDING = "DB";
const LOCAL_STATE = ".wrangler/state/v3/d1";
const output = process.argv[2] ?? "./prod-backup.sql";

function wrangler(...args) {
  const result = spawnSync("npx", ["wrangler", ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\nFailed: wrangler ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`Exporting remote ${BINDING} to ${output}...`);
wrangler("d1", "export", BINDING, "--remote", `--output=${output}`);

console.log(`\nWiping local D1 state (${LOCAL_STATE})...`);
rmSync(resolve(LOCAL_STATE), { recursive: true, force: true });

console.log(`\nImporting ${output} into local ${BINDING}...`);
wrangler("d1", "execute", BINDING, "--local", `--file=${output}`);

console.log("\nDone. The export includes schema and data — no need to re-run migrations.");
