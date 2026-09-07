/** Referral links must stay on the explicitly configured web origin. */
export function resolveReferralInviteBaseUrl(env: NodeJS.ProcessEnv): string {
  const raw = env.REFERRAL_INVITE_BASE_URL?.trim();
  if (!raw) {
    throw new Error('Missing required env var: REFERRAL_INVITE_BASE_URL');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidInviteBaseUrl();
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw invalidInviteBaseUrl();
  }

  return url.origin;
}

function invalidInviteBaseUrl(): Error {
  return new Error(
    'REFERRAL_INVITE_BASE_URL must be an absolute HTTP(S) origin without credentials, path, query parameters, or fragment.',
  );
}
