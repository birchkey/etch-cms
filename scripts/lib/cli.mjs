// Terminal helpers shared by setup.mjs and admin-reset.mjs: output, prompts, and running
// the project's own copy of wrangler.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

// ── Output ──────────────────────────────────────────────────────────────────

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = paint('1'), dim = paint('2'), green = paint('32'), red = paint('31'), cyan = paint('36'), yellow = paint('33');

let stepNo = 0;
export const step = (title) => console.log(`\n${bold(`${++stepNo}. ${title}`)}`);
export const ok = (msg) => console.log(`   ${green('✓')} ${msg}`);
export const info = (msg) => console.log(`   ${dim(msg)}`);

export class CliError extends Error {
  constructor(message, detail) { super(message); this.detail = detail; }
}

export function runMain(main) {
  main().catch((err) => {
    if (err instanceof CliError) {
      console.error(`\n${red(bold('✗'))} ${err.message}`);
      if (err.detail) console.error(dim(err.detail.split('\n').map(l => `  ${l}`).join('\n')));
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

export function requireTerminal(command) {
  if (!process.stdin.isTTY) throw new CliError(`This command is interactive. Run \`${command}\` in a terminal.`);
}

// ── Prompts ─────────────────────────────────────────────────────────────────

export async function ask(question, fallback) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`   ${question}${fallback ? dim(` (${fallback})`) : ''}: `)).trim();
    return answer || fallback || '';
  } finally {
    rl.close();
  }
}

export async function confirm(question, defaultYes = false) {
  const answer = (await ask(`${question} ${dim(defaultYes ? '[Y/n]' : '[y/N]')}`)).toLowerCase();
  return answer ? answer.startsWith('y') : defaultYes;
}

// Reads a line without echoing it.
export function askHidden(question) {
  return new Promise((resolvePromise) => {
    const { stdin, stdout } = process;
    // Stop echoing before showing the prompt, so nothing typed straight away is displayed.
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdout.write(`   ${question}: `);
    let value = '';
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { finish(); resolvePromise(value); return; }
        if (ch === '\u0003') { finish(); process.exit(130); }        // Ctrl-C
        if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); continue; }
        if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

export async function askNewPassword(label = 'Password') {
  for (;;) {
    const password = await askHidden(`${label} (8+ characters)`);
    if (password.length < 8) { console.log(red('   Too short, try again.')); continue; }
    if (await askHidden('Confirm password') === password) return password;
    console.log(red('   Passwords did not match, try again.'));
  }
}

// ── wrangler ────────────────────────────────────────────────────────────────

// Runs wrangler with its output captured. stdin is closed, so wrangler treats the session as
// non-interactive and never stops to ask a question we'd have no way to answer.
export function wrangler(args) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: process.env,
  });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

export function wranglerOrFail(args, failure) {
  const r = wrangler(args);
  if (!r.ok) throw new CliError(failure, r.err.trim() || r.out.trim());
  return r;
}

// Runs a command attached to the terminal, for steps that may need to ask the user something.
export function runInteractive(cmd, args) {
  return spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env }).status === 0;
}

// ── D1 ──────────────────────────────────────────────────────────────────────

// A SQL string literal. Only used for values we generate or have validated, but quoted
// properly regardless.
export const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** Runs a read-only query and returns its rows. `where` is 'local' or 'remote'. */
export function d1Query(sql, where) {
  const r = wranglerOrFail(['d1', 'execute', 'DB', `--${where}`, '--json', '--command', sql], `Querying the ${where} database failed.`);
  return JSON.parse(r.out)[0]?.results ?? [];
}

/**
 * Runs statements in one request. They go through a file rather than --command so that
 * D1 applies them together.
 */
export function d1Execute(statements, where) {
  const dir = mkdtempSync(join(tmpdir(), 'etch-sql-'));
  try {
    const file = join(dir, 'statements.sql');
    writeFileSync(file, statements.join('\n'), { mode: 0o600 });
    wranglerOrFail(['d1', 'execute', 'DB', `--${where}`, '--yes', '--file', file], `Writing to the ${where} database failed.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Creates the admin or resets their password, and ends their sessions. An existing user with
 * that username becomes an admin. Shared by setup and admin:reset.
 */
export function upsertAdmin({ username, hash, where }) {
  const now = Date.now();
  d1Execute([
    `INSERT INTO users (id, username, name, password_hash, role, must_reset_password, created_at, updated_at)
       VALUES (${sqlString(crypto.randomUUID())}, ${sqlString(username)}, '', ${sqlString(hash)}, 'admin', 0, ${now}, ${now})
       ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin',
         must_reset_password = 0, updated_at = excluded.updated_at;`,
    `DELETE FROM refresh_tokens WHERE user_sub = ${sqlString(username)};`,
  ], where);
}
