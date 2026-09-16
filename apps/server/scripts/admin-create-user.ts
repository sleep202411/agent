import 'dotenv/config';
import { AdminSiteScope, AdminUserStatus, type Prisma } from '@prisma/client';
import {
  assignAdminRole,
  assignAdminSuperRole,
  ensureAdminAuthCatalog,
} from '../src/admin-auth/admin-auth.bootstrap';
import {
  ADMIN_ROLE_KEYS,
  type AdminRoleKey,
} from '../src/admin-auth/admin-auth.constants';
import {
  hashAdminPassword,
  validateAdminPasswordPolicy,
} from '../src/admin-auth/admin-password';
import { buildPrisma } from '../src/infra/db/db.module';

type CliOptions = {
  email: string;
  password?: string;
  name: string;
  siteScope: AdminSiteScope;
  status: AdminUserStatus;
  roleKey: AdminRoleKey;
  requireMfa: boolean;
};

const prisma = buildPrisma();

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await ensureAdminAuthCatalog(prisma);

  const existing = await prisma.adminUser.findUnique({
    where: { email: options.email },
  });
  if (!existing && !options.password) {
    throw new Error(
      '新建管理员必须提供 --password，或设置 ADMIN_CREATE_PASSWORD。',
    );
  }
  if (options.password) {
    const issues = validateAdminPasswordPolicy({
      password: options.password,
      email: options.email,
      displayName: options.name,
    });
    if (issues.length) throw new Error(issues.join(' '));
  }

  const passwordFields: Pick<
    Prisma.AdminUserCreateInput,
    'passwordHash' | 'passwordChangedAt'
  > = options.password
    ? {
        passwordHash: hashAdminPassword(options.password),
        passwordChangedAt: new Date(),
      }
    : {};

  const user = await prisma.adminUser.upsert({
    where: { email: options.email },
    create: {
      email: options.email,
      displayName: options.name,
      status: options.status,
      siteScope: options.siteScope,
      requireMfa: options.requireMfa,
      ...passwordFields,
    },
    update: {
      displayName: options.name,
      status: options.status,
      siteScope: options.siteScope,
      requireMfa: options.requireMfa,
      disabledAt:
        options.status === AdminUserStatus.disabled ? new Date() : null,
      ...passwordFields,
    },
  });

  if (options.roleKey === ADMIN_ROLE_KEYS.SuperAdmin) {
    await assignAdminSuperRole(prisma, user.id);
  } else {
    await assignAdminRole(prisma, user.id, options.roleKey);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        action: existing ? 'updated' : 'created',
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        siteScope: user.siteScope,
        status: user.status,
        role: options.roleKey,
        requireMfa: user.requireMfa,
        passwordUpdated: Boolean(options.password),
      },
      null,
      2,
    ),
  );
}

function parseOptions(argv: string[]): CliOptions {
  const email = readString(argv, 'email', process.env.ADMIN_CREATE_EMAIL)
    ?.trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('请提供有效邮箱：--email admin@example.com');
  }

  const password = readString(
    argv,
    'password',
    process.env.ADMIN_CREATE_PASSWORD,
  );
  if (password && (password.length < 8 || password.length > 200)) {
    throw new Error('管理员密码长度必须为 8-200 位。');
  }

  const siteScope = parseEnum(
    readString(argv, 'site-scope', process.env.ADMIN_CREATE_SITE_SCOPE) ??
      'all',
    AdminSiteScope,
    'site-scope',
  );
  const status = parseEnum(
    readString(argv, 'status', process.env.ADMIN_CREATE_STATUS) ?? 'active',
    AdminUserStatus,
    'status',
  );
  const roleKey = parseEnum(
    readString(argv, 'role', process.env.ADMIN_CREATE_ROLE) ??
      ADMIN_ROLE_KEYS.SuperAdmin,
    ADMIN_ROLE_KEYS,
    'role',
  );

  return {
    email,
    password,
    name:
      readString(argv, 'name', process.env.ADMIN_CREATE_NAME)?.trim() ||
      '管理员',
    siteScope,
    status,
    roleKey,
    requireMfa:
      readString(argv, 'require-mfa', process.env.ADMIN_CREATE_REQUIRE_MFA) !==
      'false',
  };
}

function readString(
  argv: string[],
  key: string,
  fallback?: string,
): string | undefined {
  const prefix = `--${key}=`;
  const inline = argv.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${key}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) {
    return argv[index + 1];
  }
  return fallback;
}

function parseEnum<T extends Record<string, string>>(
  value: string,
  enumType: T,
  key: string,
): T[keyof T] {
  const values = Object.values(enumType);
  if (values.includes(value)) return value as T[keyof T];
  throw new Error(`${key} 只能是：${values.join(', ')}`);
}
