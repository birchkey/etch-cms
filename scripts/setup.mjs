#!/usr/bin/env node
// First-time setup: writes wrangler.toml, creates the D1 database and R2 bucket, sets the admin
// login and secrets, runs migrations, builds the admin UI and deploys.
//
// Usage:  npm run setup              full setup, local and production
//         npm run setup -- --local   local development only; no Cloudflare account needed
//
// Safe to re-run: anything that already exists is reused, and production's JWT_SECRET is never
// replaced (replacing it would sign everyone out and break preview links and signed asset URLs).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { hashPassword } from './lib/password.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const LOCAL_ONLY = process.argv.includes('--local');
const CONFIG = 'wrangler.toml';
const DEV_VARS = '.dev.vars';
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const PLACEHOLDER_HASH = 'pbkdf2:your-salt-hex:your-hash-hex';
const PLACEHOLDER_JWT = 'your-jwt-secret-hex';

// ── Output ──────────────────────────────────────────────────────────────────

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1'), dim = paint('2'), green = paint('32'), red = paint('31'), cyan = paint('36');

let stepNo = 0;
const step = (title) => console.log(`\n${bold(`${++stepNo}. ${title}`)}`);
const ok = (msg) => console.log(`   ${green('✓')} ${msg}`);
const info = (msg) => console.log(`   ${dim(msg)}`);

class SetupError extends Error {
  constructor(message, detail) { super(message); this.detail = detail; }
}

// ── Prompts ─────────────────────────────────────────────────────────────────

async function ask(question, fallback) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`   ${question}${fallback ? dim(` (${fallback})`) : ''}: `)).trim();
    return answer || fallback || '';
  } finally {
    rl.close();
  }
}

async function confirm(question, defaultYes = false) {
  const answer = (await ask(`${question} ${dim(defaultYes ? '[Y/n]' : '[y/N]')}`)).toLowerCase();
  return answer ? answer.startsWith('y') : defaultYes;
}

// Reads a line without echoing it.
function askHidden(question) {
  return new Promise((resolvePromise) => {
    const { stdin, stdout } = process;
    stdout.write(`   ${question}: `);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
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

async function askNewPassword() {
  for (;;) {
    const password = await askHidden('Admin password (8+ characters)');
    if (password.length < 8) { console.log(red('   Too short, try again.')); continue; }
    if (await askHidden('Confirm password') === password) return password;
    console.log(red('   Passwords did not match, try again.'));
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

// Runs wrangler with its output captured. stdin is closed, so wrangler treats the session as
// non-interactive and never stops to ask a question we'd have no way to answer.
function wrangler(args) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: process.env,
  });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function wranglerOrFail(args, failure) {
  const r = wrangler(args);
  if (!r.ok) throw new SetupError(failure, r.err.trim() || r.out.trim());
  return r;
}

// Runs a command attached to the terminal, for steps that may need to ask the user something.
function runInteractive(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'inherit', env: process.env }).status === 0;
}

function npmBuildClient() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['--prefix', 'client', 'run', 'build'], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new SetupError('Building the admin UI failed.', `${r.stdout}\n${r.stderr}`.trim());
}

// ── Files ───────────────────────────────────────────────────────────────────

function readDevVars() {
  const source = existsSync(DEV_VARS) ? DEV_VARS : '.dev.vars.example';
  return readFileSync(source, 'utf8');
}

function getVar(contents, key) {
  return contents.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1].trim();
}

function setVar(contents, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(contents) ? contents.replace(re, line) : `${contents.trimEnd()}\n${line}\n`;
}

function readConfig() {
  const toml = readFileSync(CONFIG, 'utf8');
  const field = (key) => toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
  return {
    worker: field('name'),
    database: field('database_name'),
    databaseId: field('database_id'),
    bucket: field('bucket_name'),
    accountId: field('account_id'),
  };
}

function writeConfig({ worker, database, bucket, accountId }) {
  let toml = readFileSync('wrangler.example.toml', 'utf8')
    .replace('"your-worker-name"', `"${worker}"`)
    .replace('"your-d1-database-name"', `"${database}"`)
    .replace(/"your-r2-bucket-name"[^\n]*/, `"${bucket}"`);
  if (accountId) toml = toml.replace(/^(main = .*)$/m, `$1\naccount_id = "${accountId}"`);
  writeFileSync(CONFIG, toml);
}

const randomHex = () => randomBytes(32).toString('hex');

// ── Steps ───────────────────────────────────────────────────────────────────

async function ensureLoggedIn() {
  step('Cloudflare account');
  let who = wrangler(['whoami', '--json']);
  if (!who.ok) {
    info('Not logged in to Cloudflare. Opening the browser so you can authorize Wrangler…');
    if (!runInteractive(process.execPath, [WRANGLER, 'login'])) throw new SetupError('Cloudflare login failed.');
    who = wranglerOrFail(['whoami', '--json'], 'Still not logged in to Cloudflare.');
  }
  const { email, accounts = [] } = JSON.parse(who.out);

  let account;
  const configured = existsSync(CONFIG) ? readConfig().accountId : undefined;
  const wanted = configured || process.env.CLOUDFLARE_ACCOUNT_ID;
  if (wanted) {
    account = accounts.find(a => a.id === wanted) ?? { id: wanted, name: wanted };
  } else if (accounts.length === 1) {
    account = accounts[0];
  } else if (accounts.length > 1) {
    console.log('   Your login has access to more than one account:');
    accounts.forEach((a, i) => console.log(`     ${i + 1}) ${a.name} ${dim(a.id)}`));
    for (;;) {
      const n = Number(await ask('Which one should Etch use?', '1'));
      if (accounts[n - 1]) { account = { ...accounts[n - 1], chosen: true }; break; }
    }
  } else {
    throw new SetupError('This Cloudflare login has no accounts.');
  }

  // Every wrangler call below inherits this, so none of them stops to ask which account to use.
  process.env.CLOUDFLARE_ACCOUNT_ID = account.id;
  ok(`${email ?? 'Logged in'} — account ${bold(account.name)}`);
  return account;
}

async function ensureConfig(account) {
  step('Configuration');
  if (existsSync(CONFIG)) {
    const cfg = readConfig();
    if (Object.values(cfg).some(v => v?.startsWith('your-'))) {
      throw new SetupError(`${CONFIG} still has placeholder values from the example. Fill them in, or delete the file and run setup again.`);
    }
    ok(`Using existing ${CONFIG} — Worker ${bold(cfg.worker)}, database ${bold(cfg.database)}, bucket ${bold(cfg.bucket)}`);
    return cfg;
  }

  info('Pick a short name for this CMS. It names the Worker and its database and bucket, and');
  info('appears in your URL: https://<name>.<your-subdomain>.workers.dev');
  let worker;
  for (;;) {
    worker = (await ask('Name', 'etch-cms')).toLowerCase();
    // R2 bucket names are the strictest of the three: 3–63 characters, lowercase, digits, hyphens.
    if (/^[a-z0-9][a-z0-9-]{1,55}[a-z0-9]$/.test(worker)) break;
    console.log(red('   Use 3–57 lowercase letters, digits and hyphens, starting and ending with a letter or digit.'));
  }
  const cfg = { worker, database: `${worker}-db`, bucket: `${worker}-files`, accountId: account?.chosen ? account.id : undefined };
  writeConfig(cfg);
  ok(`Wrote ${CONFIG} — Worker ${bold(cfg.worker)}, database ${bold(cfg.database)}, bucket ${bold(cfg.bucket)}`);
  return cfg;
}

function ensureResources(cfg) {
  step('Database and file storage');

  if (cfg.databaseId) {
    ok(`D1 database ${bold(cfg.database)} (id set in ${CONFIG})`);
  } else {
    const list = wranglerOrFail(['d1', 'list', '--json'], 'Could not list your D1 databases.');
    if (JSON.parse(list.out).some(db => db.name === cfg.database)) {
      ok(`Using existing D1 database ${bold(cfg.database)}`);
    } else {
      wranglerOrFail(['d1', 'create', cfg.database], `Could not create D1 database "${cfg.database}".`);
      ok(`Created D1 database ${bold(cfg.database)}`);
    }
  }

  if (wrangler(['r2', 'bucket', 'info', cfg.bucket]).ok) {
    ok(`Using existing R2 bucket ${bold(cfg.bucket)}`);
  } else {
    const r = wrangler(['r2', 'bucket', 'create', cfg.bucket]);
    if (!r.ok) {
      const detail = (r.err || r.out).trim();
      const hint = /enable R2|10042/i.test(detail)
        ? 'R2 is not enabled on this account yet. Enable it in the Cloudflare dashboard (R2 Object Storage), then run setup again.'
        : `Could not create R2 bucket "${cfg.bucket}".`;
      throw new SetupError(hint, detail);
    }
    ok(`Created R2 bucket ${bold(cfg.bucket)}`);
  }
}

function remoteSecretNames() {
  const r = wrangler(['secret', 'list', '--format', 'json']);
  if (!r.ok) return new Set(); // the Worker hasn't been deployed yet
  try { return new Set(JSON.parse(r.out).map(s => s.name)); } catch { return new Set(); }
}

async function ensureCredentials() {
  step('Admin login');
  let devVars = readDevVars();
  const localHash = getVar(devVars, 'ADMIN_PASSWORD_HASH');
  const localReady = existsSync(DEV_VARS) && localHash && localHash !== PLACEHOLDER_HASH;
  const remote = LOCAL_ONLY ? null : remoteSecretNames();
  const remoteReady = !remote || (remote.has('ADMIN_USERNAME') && remote.has('ADMIN_PASSWORD_HASH'));

  let username, hash;
  if (localReady && remoteReady) {
    ok(`Already set (username ${bold(getVar(devVars, 'ADMIN_USERNAME') ?? 'admin')})`);
    if (await confirm('Change the admin username or password?')) {
      ({ username, hash } = await promptCredentials(getVar(devVars, 'ADMIN_USERNAME')));
    }
  } else {
    ({ username, hash } = await promptCredentials(getVar(devVars, 'ADMIN_USERNAME')));
  }

  // Local development: .dev.vars
  if (username) {
    devVars = setVar(devVars, 'ADMIN_USERNAME', username);
    devVars = setVar(devVars, 'ADMIN_PASSWORD_HASH', hash);
  }
  const jwt = getVar(devVars, 'JWT_SECRET');
  if (!jwt || jwt === PLACEHOLDER_JWT) devVars = setVar(devVars, 'JWT_SECRET', randomHex());
  writeFileSync(DEV_VARS, devVars, { mode: 0o600 });
  ok(`Saved local development login to ${DEV_VARS}`);

  // Production: returned for upload with the deploy. The JWT secret is only ever added, never
  // replaced, and gets its own value so local tokens are never valid in production.
  if (!remote) return null;
  const secrets = {};
  if (username) Object.assign(secrets, { ADMIN_USERNAME: username, ADMIN_PASSWORD_HASH: hash });
  if (!remote.has('JWT_SECRET')) secrets.JWT_SECRET = randomHex();
  return Object.keys(secrets).length ? secrets : null;
}

async function promptCredentials(currentUsername) {
  const username = await ask('Admin username', currentUsername || 'admin');
  const password = await askNewPassword();
  return { username, hash: await hashPassword(password) };
}

function migrate(where) {
  const r = wranglerOrFail(['d1', 'migrations', 'apply', 'DB', `--${where}`], `Applying ${where} database migrations failed.`);
  ok(/No migrations to apply/i.test(r.out) ? `${where[0].toUpperCase()}${where.slice(1)} database is up to date` : `Applied migrations to the ${where} database`);
}

function deploy(secrets) {
  step('Deploy');
  info('Building the admin UI…');
  npmBuildClient();
  ok('Built the admin UI');

  const args = [WRANGLER, 'deploy'];
  let dir;
  try {
    if (secrets) {
      dir = mkdtempSync(join(tmpdir(), 'etch-setup-'));
      const file = join(dir, 'secrets.json');
      writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
      args.push('--secrets-file', file);
      info(`Uploading secrets with this deploy: ${Object.keys(secrets).join(', ')}`);
    }
    console.log();
    // Attached to the terminal: wrangler may need to ask something (e.g. registering a
    // workers.dev subdomain on a brand-new account), and it prints the live URL at the end.
    if (!runInteractive(process.execPath, args)) {
      throw new SetupError('Deploy failed. Fix the error above, then run `npm run setup` again; it picks up where it left off.');
    }
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.stdin.isTTY) {
    throw new SetupError('Setup is interactive. Run `npm run setup` in a terminal.');
  }
  if (!existsSync(WRANGLER)) {
    throw new SetupError('Dependencies are not installed. Run `npm install` first.');
  }

  console.log(bold(LOCAL_ONLY ? 'Etch CMS setup — local development only' : 'Etch CMS setup'));

  let cfg;
  let secrets = null;
  if (LOCAL_ONLY) {
    cfg = await ensureConfig(null);
    await ensureCredentials();
    step('Local database');
    migrate('local');
    step('Admin UI');
    npmBuildClient();
    ok('Built the admin UI');
  } else {
    const account = await ensureLoggedIn();
    cfg = await ensureConfig(account);
    ensureResources(cfg);
    secrets = await ensureCredentials();
    step('Database migrations');
    migrate('local');
    migrate('remote');
    deploy(secrets);
  }

  console.log(`\n${green(bold('Setup complete.'))}`);
  if (!LOCAL_ONLY) console.log(`\n   Your CMS is live at the ${bold('workers.dev')} URL printed above. Sign in with the admin login you just set.`);
  console.log(`
   Local development:
     ${cyan('npm run dev')}               Worker on http://localhost:8787
     ${cyan('npm --prefix client run dev')}  Admin UI on ${bold('http://localhost:5173')}

   Ship changes later with ${cyan('npm run deploy')}.`);
  if (!LOCAL_ONLY && cfg) {
    console.log(`   Optional: require a key for the public API with ${cyan('npx wrangler secret put PUBLIC_API_KEY')}.`);
  }
  console.log();
}

main().catch((err) => {
  if (err instanceof SetupError) {
    console.error(`\n${red(bold('✗'))} ${err.message}`);
    if (err.detail) console.error(dim(err.detail.split('\n').map(l => `  ${l}`).join('\n')));
  } else {
    console.error(err);
  }
  process.exit(1);
});
