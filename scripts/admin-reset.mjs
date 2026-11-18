#!/usr/bin/env node
// Creates an admin, or resets an admin's password, directly in the database. This is the way
// back in if every admin is locked out; it works because you're signed in to the Cloudflare
// account that owns the database, which already controls the whole CMS.
//
// Usage:  npm run admin:reset              production
//         npm run admin:reset -- --local   local development database

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword } from './lib/password.mjs';
import {
  ROOT, WRANGLER, CliError, runMain, requireTerminal, bold, dim, green, yellow, ok, info,
  ask, confirm, askNewPassword, wrangler, d1Query, sqlString, upsertAdmin,
} from './lib/cli.mjs';

const where = process.argv.includes('--local') ? 'local' : 'remote';
const label = where === 'remote' ? 'production' : 'local development';

runMain(async () => {
  requireTerminal('npm run admin:reset');
  if (!existsSync(WRANGLER)) throw new CliError('Dependencies are not installed. Run `npm install` first.');
  if (!existsSync(join(ROOT, 'wrangler.toml'))) throw new CliError('No wrangler.toml found. Run `npm run setup` first.');
  if (where === 'remote' && !wrangler(['whoami', '--json']).ok) {
    throw new CliError('Not logged in to Cloudflare. Run `npx wrangler login`, then try again.');
  }

  console.log(bold(`Reset an Etch admin — ${label} database`));

  const applied = d1Query("SELECT name FROM d1_migrations WHERE name = '0012_admin_users.sql'", where);
  if (applied.length === 0) {
    throw new CliError(
      `The ${label} database hasn't been migrated to database admins yet.`,
      where === 'remote' ? 'Deploy this version first with `npm run deploy`.' : 'Run `npm run db:migrate` first.',
    );
  }

  const admins = d1Query("SELECT username FROM users WHERE role = 'admin' ORDER BY created_at", where).map(r => r.username);
  info(admins.length ? `Current admins: ${admins.join(', ')}` : 'There are no admins yet.');

  let username;
  for (;;) {
    username = await ask('Username to create or reset', admins[0] || 'admin');
    if (username.length > 0 && username.length <= 100 && !/[\s\x00-\x1f]/.test(username)) break;
    console.log('   Use up to 100 characters with no spaces.');
  }

  const [existing] = d1Query(`SELECT role FROM users WHERE username = ${sqlString(username)}`, where);
  if (!existing) {
    info(`${username} doesn't exist yet; it will be created as an admin.`);
  } else if (existing.role !== 'admin') {
    console.log(yellow(`   ${username} is currently a ${existing.role}. Continuing makes them an admin,`));
    console.log(yellow('   including any API tokens they own.'));
  }

  const password = await askNewPassword('New password');
  if (!await confirm(`Set this password for ${bold(username)} in ${label}? They'll be signed out everywhere.`, true)) {
    console.log(dim('   Nothing changed.'));
    return;
  }

  upsertAdmin({ username, hash: await hashPassword(password), where });
  ok(`${username} is an admin with the new password.`);
  console.log(`\n${green(bold('Done.'))} Sign in as ${bold(username)}.\n`);
});
