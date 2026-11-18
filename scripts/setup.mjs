#!/usr/bin/env node
// First-time setup: writes wrangler.toml, creates the D1 database and R2 bucket, runs
// migrations, creates the first admin, sets the JWT secret, builds the admin UI and deploys.
//
// Usage:  npm run setup              full setup, local and production
//         npm run setup -- --local   local development only; no Cloudflare account needed
//
// Safe to re-run: anything that already exists is reused, and production's JWT_SECRET is never
// replaced (replacing it would sign everyone out and break preview links and signed asset URLs).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './lib/password.mjs';
import {
  ROOT, WRANGLER, CliError, runMain, requireTerminal, bold, dim, green, red, cyan, step, ok, info,
  ask, confirm, askNewPassword, wrangler, wranglerOrFail, runInteractive, d1Query, upsertAdmin,
} from './lib/cli.mjs';

process.chdir(ROOT);

const LOCAL_ONLY = process.argv.includes('--local');
const CONFIG = 'wrangler.toml';
const DEV_VARS = '.dev.vars';
const PLACEHOLDER_JWT = 'your-jwt-secret-hex';

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

function npmBuildClient() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['--prefix', 'client', 'run', 'build'], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new CliError('Building the admin UI failed.', `${r.stdout}\n${r.stderr}`.trim());
}

// ── Steps ───────────────────────────────────────────────────────────────────

async function ensureLoggedIn() {
  step('Cloudflare account');
  let who = wrangler(['whoami', '--json']);
  if (!who.ok) {
    info('Not logged in to Cloudflare. Opening the browser so you can authorize Wrangler…');
    if (!runInteractive(process.execPath, [WRANGLER, 'login'])) throw new CliError('Cloudflare login failed.');
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
    throw new CliError('This Cloudflare login has no accounts.');
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
      throw new CliError(`${CONFIG} still has placeholder values from the example. Fill them in, or delete the file and run setup again.`);
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
      throw new CliError(hint, detail);
    }
    ok(`Created R2 bucket ${bold(cfg.bucket)}`);
  }
}

function migrate(where) {
  const r = wranglerOrFail(['d1', 'migrations', 'apply', 'DB', `--${where}`], `Applying ${where} database migrations failed.`);
  ok(/No migrations to apply/i.test(r.out) ? `${where[0].toUpperCase()}${where.slice(1)} database is up to date` : `Applied migrations to the ${where} database`);
}

// Creates the first admin wherever there isn't one yet, with one username and password for
// both databases. Admins live in the database, so this writes there directly.
async function ensureAdmin(targets) {
  step('Admin account');
  const admins = Object.fromEntries(targets.map(where => [
    where, d1Query("SELECT username FROM users WHERE role = 'admin' ORDER BY created_at", where).map(r => r.username),
  ]));
  const label = (where) => (where === 'remote' ? 'production' : 'local development');

  let missing = targets.filter(where => admins[where].length === 0);
  for (const where of targets.filter(w => admins[w].length > 0)) {
    ok(`${label(where)[0].toUpperCase()}${label(where).slice(1)} admins: ${admins[where].join(', ')}`);
  }
  if (missing.length === 0) {
    if (!await confirm('Add an admin or reset an admin\'s password?')) return;
    missing = targets;
  } else {
    info(`Create the admin you'll sign in with${missing.length > 1 ? ' (used for both local development and production)' : ''}.`);
  }

  const username = await ask('Admin username', admins.remote?.[0] ?? admins.local?.[0] ?? 'admin');
  const hash = await hashPassword(await askNewPassword('Admin password'));
  for (const where of missing) {
    upsertAdmin({ username, hash, where });
    ok(`${bold(username)} is an admin in ${label(where)}`);
  }
}

// Local development: .dev.vars only needs the JWT secret now that admins live in the database.
function ensureLocalSecrets() {
  let devVars = readDevVars();
  const jwt = getVar(devVars, 'JWT_SECRET');
  if (!jwt || jwt === PLACEHOLDER_JWT) devVars = setVar(devVars, 'JWT_SECRET', randomHex());
  writeFileSync(DEV_VARS, devVars, { mode: 0o600 });
  ok(`Local secrets are in ${DEV_VARS}`);
}

// Production: returns secrets to upload with the deploy. JWT_SECRET is only ever added, never
// replaced, and gets its own value so local tokens are never valid in production.
function productionSecrets() {
  const r = wrangler(['secret', 'list', '--format', 'json']);
  let names = new Set();
  if (r.ok) {
    try { names = new Set(JSON.parse(r.out).map(s => s.name)); } catch { /* treat as none */ }
  }
  return names.has('JWT_SECRET') ? null : { JWT_SECRET: randomHex() };
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
      throw new CliError('Deploy failed. Fix the error above, then run `npm run setup` again; it picks up where it left off.');
    }
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

runMain(async () => {
  requireTerminal('npm run setup');
  if (!existsSync(WRANGLER)) throw new CliError('Dependencies are not installed. Run `npm install` first.');

  console.log(bold(LOCAL_ONLY ? 'Etch CMS setup — local development only' : 'Etch CMS setup'));

  if (LOCAL_ONLY) {
    await ensureConfig(null);
    ensureLocalSecrets();
    step('Local database');
    migrate('local');
    await ensureAdmin(['local']);
    step('Admin UI');
    npmBuildClient();
    ok('Built the admin UI');
  } else {
    const account = await ensureLoggedIn();
    const cfg = await ensureConfig(account);
    ensureLocalSecrets();
    ensureResources(cfg);
    step('Database migrations');
    migrate('local');
    migrate('remote');
    await ensureAdmin(['local', 'remote']);
    deploy(productionSecrets());
  }

  console.log(`\n${green(bold('Setup complete.'))}`);
  if (!LOCAL_ONLY) console.log(`\n   Your CMS is live at the ${bold('workers.dev')} URL printed above. Sign in with your admin account.`);
  console.log(`
   Local development:
     ${cyan('npm run dev')}                  Worker on http://localhost:8787
     ${cyan('npm --prefix client run dev')}  Admin UI on ${bold('http://localhost:5173')}

   Ship changes later with ${cyan('npm run deploy')}.
   Locked out? ${cyan('npm run admin:reset')} creates an admin or resets a password.`);
  if (!LOCAL_ONLY) {
    console.log(`   Optional: require a key for the public API with ${cyan('npx wrangler secret put PUBLIC_API_KEY')}.`);
  }
  console.log();
});
