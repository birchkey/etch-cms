#!/usr/bin/env node
// Generates a password hash and writes it directly to .dev.vars.
// For first-time setup, use `npm run setup` instead; it does this for you.
//
// Usage:  node scripts/hash-password.mjs <password>
//         node scripts/hash-password.mjs --print <password>   (print only; .dev.vars untouched)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPassword } from './lib/password.mjs';

const args = process.argv.slice(2);
const printOnly = args.includes('--print');
const password = args.find(a => a !== '--print');
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs [--print] <password>');
  process.exit(1);
}

const newHash = await hashPassword(password);

// For production secrets (or any hash you just need to copy), don't overwrite the local admin password.
if (printOnly) {
  console.log(newHash);
  process.exit(0);
}

const devVarsPath = resolve(process.cwd(), '.dev.vars');
if (!existsSync(devVarsPath)) {
  console.error('.dev.vars not found — are you running this from the project root?');
  process.exit(1);
}

let contents = readFileSync(devVarsPath, 'utf8');
if (contents.includes('ADMIN_PASSWORD_HASH=')) {
  contents = contents.replace(/^ADMIN_PASSWORD_HASH=.*$/m, `ADMIN_PASSWORD_HASH=${newHash}`);
} else {
  contents += `\nADMIN_PASSWORD_HASH=${newHash}\n`;
}
writeFileSync(devVarsPath, contents, 'utf8');
console.log(`ADMIN_PASSWORD_HASH=${newHash}`);
console.log(`\nWritten to .dev.vars. Restart wrangler dev, then log in with username "admin" and the password you provided.`);
