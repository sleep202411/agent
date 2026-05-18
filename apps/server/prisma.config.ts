// Prisma v7 config. Uses process.env directly (NOT env() helper) so that
// `prisma generate` works in CI/Docker builds where DATABASE_URL isn't
// injected until runtime (K8s envFrom from KV). The env() helper from
// prisma/config throws at load time if the var is missing, which breaks
// codegen-only commands. Documented workaround:
// https://www.prisma.io/docs/orm/reference/prisma-config-reference
//
// Runtime fail-loud is unchanged: when Nest boots and PrismaClient
// connects, an empty URL still produces a clear error.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
