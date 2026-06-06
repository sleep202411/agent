#!/usr/bin/env node

import 'dotenv/config';
import { spawn } from 'node:child_process';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error(
    'Usage: node scripts/ensure-local-database.mjs <command> [args...]',
  );
  process.exit(2);
}

const rawDatabaseUrl = process.env.DATABASE_URL;
if (!rawDatabaseUrl) {
  console.error(
    'Refusing to run database command: DATABASE_URL is not configured.',
  );
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(rawDatabaseUrl);
} catch {
  console.error('Refusing to run database command: DATABASE_URL is invalid.');
  process.exit(1);
}

if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  console.error(
    `Refusing to run database command: expected a Postgres URL, got ${parsed.protocol}.`,
  );
  process.exit(1);
}

if (!LOCAL_HOSTS.has(parsed.hostname)) {
  console.error(
    [
      'Refusing to run database command against a non-local Postgres host.',
      `Host: ${parsed.hostname}`,
      'Allowed hosts: localhost, 127.0.0.1, ::1',
      'Use the production deployment path explicitly for shared or production databases.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(
  `Local database guard passed: ${parsed.protocol}//${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`,
);

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
