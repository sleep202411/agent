import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

const PASSWORD_ALGORITHM = 'pbkdf2_sha256';
const PASSWORD_ITERATIONS = 310_000;

export function hashAdminPassword(password: string): string {
  const salt = randomBytes(16).toString('base64url');
  const digest = pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    32,
    'sha256',
  ).toString('base64url');
  return `${PASSWORD_ALGORITHM}$${PASSWORD_ITERATIONS}$${salt}$${digest}`;
}

export function verifyAdminPassword(
  password: string,
  encoded: string,
): boolean {
  const [algorithm, iterationsRaw, salt, expectedDigest] = encoded.split('$');
  if (
    algorithm !== PASSWORD_ALGORITHM ||
    !iterationsRaw ||
    !salt ||
    !expectedDigest
  ) {
    return false;
  }
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;
  const actual = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const expected = Buffer.from(expectedDigest, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateAdminPasswordPolicy(input: {
  password: string;
  email?: string;
  displayName?: string;
  previousHashes?: string[];
}): string[] {
  const issues: string[] = [];
  const password = input.password;
  if (password.length < 12) issues.push('密码至少需要 12 位。');
  if (password.length > 128) issues.push('密码不能超过 128 位。');
  if (!/[a-z]/.test(password)) issues.push('密码需要包含小写字母。');
  if (!/[A-Z]/.test(password)) issues.push('密码需要包含大写字母。');
  if (!/\d/.test(password)) issues.push('密码需要包含数字。');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('密码需要包含符号。');

  const normalized = password.toLowerCase();
  const emailLocal = input.email?.split('@')[0]?.toLowerCase();
  if (emailLocal && emailLocal.length >= 4 && normalized.includes(emailLocal)) {
    issues.push('密码不能包含邮箱前缀。');
  }
  const nameParts =
    input.displayName
      ?.toLowerCase()
      .split(/[\s._-]+/)
      .filter((part) => part.length >= 4) ?? [];
  if (nameParts.some((part) => normalized.includes(part))) {
    issues.push('密码不能包含显示名称。');
  }
  if (COMMON_ADMIN_PASSWORDS.has(normalized)) {
    issues.push('密码过于常见，请使用更强的密码。');
  }
  if (
    input.previousHashes?.some((hash) => verifyAdminPassword(password, hash))
  ) {
    issues.push('不能复用最近 5 次使用过的管理员密码。');
  }
  return issues;
}

const COMMON_ADMIN_PASSWORDS = new Set([
  'password123!',
  'password1234!',
  'admin123456!',
  'fizzdragon123!',
  'qwerty12345!',
  'welcome12345!',
  'changeme123!',
]);
