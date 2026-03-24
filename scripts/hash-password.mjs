#!/usr/bin/env node
// Generates a password hash and writes it directly to .dev.vars.
// Uses identical parameters to hashPassword() in src/middleware/auth.ts.
//
// Usage:  node scripts/hash-password.mjs <password>

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs <password>');
  process.exit(1);
}

const encoder = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const keyMaterial = await crypto.subtle.importKey(
  'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
  keyMaterial,
  256
);
const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
const newHash = `pbkdf2:${saltHex}:${hashHex}`;

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
