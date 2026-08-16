import { config } from 'dotenv';

/**
 * Load checked-in/default local configuration first, with developer secrets in
 * `.env.local` taking precedence. Values supplied by the process environment
 * remain authoritative in CI and deployed workloads.
 *
 * Keeping local credentials in `.env.local` prevents routine regeneration of
 * `.env` from silently deleting them. Production never reads the local secret
 * file; Kubernetes injects its configuration through the process environment.
 */
config({
  path: process.env.NODE_ENV === 'production' ? '.env' : ['.env.local', '.env'],
  quiet: true,
});
