import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * Versioned real-person consent copy (design §5.3). The SERVER owns the
 * canonical text: the `consent_granted` ledger record stores this version +
 * the sha256 of this exact text, which is what carries the PIPL 单独同意
 * burden (Art.69 reversed proof) — the studio renders its own copy of the
 * same clauses, but the hash below is the legal anchor. Any wording change
 * REQUIRES a new version string; never edit a published version in place.
 */
// ⟦v2⟧ Re-versioned: the v1 copy promised "never shared with teams or other
// users," which the per-project grant model (v2) contradicts — and that exact
// text was sha256-anchored in the ledger as the PIPL 单独同意 proof. This
// account-level ENROLLMENT consent now covers self-use only and discloses that
// the owner MAY later grant specific projects, each under its OWN separate,
// purpose-scoped consent (see GRANT_CONSENT_* / §6). Never edit a published
// version in place; a wording change is a new version.
export const REAL_PERSON_CONSENT_VERSION = 'realperson-consent-v2-2026-07-02';

export const REAL_PERSON_CONSENT_TEXT = `FizzDragon Real-Person Likeness Enrollment Consent (${REAL_PERSON_CONSENT_VERSION})

1. Purpose. You authorize FizzDragon to verify your facial likeness and to let
you generate videos containing your own likeness. This enrollment is tied to
your account only — it does not, by itself, allow anyone else to use your face.

2. Data categories. We process: the face images and short videos you upload as
reference material, and the liveness-verification session performed by our
provider. We never store provider-signed face URLs.

3. Provider transfer. Your reference media and liveness check are processed by
BytePlus ModelArk in Singapore (ap-southeast-1), outside your country of
residence. Assets live in a private, access-controlled library bound to your
verified face group.

4. Scope & future authorizations. By default only you — the verified account
owner — can generate with this likeness, and you must be enrolling YOUR OWN
face. You confirm you are 18 or older. You MAY later choose to authorize
specific projects to use your likeness; each such authorization is a separate,
purpose-limited consent you give at that time, and you can withdraw it per
project at any time.

5. Retention & withdrawal. You can revoke this enrollment at any time by
deleting the character: provider-side assets are deleted immediately, queued
generations are stopped, and your uploaded face media is permanently purged
after a 30-day dispute window. The consent ledger (versions, timestamps,
hashes — never face data) is retained as legal evidence.

6. Outputs. Videos already generated before revocation are not automatically
deleted; they carry an AI-generated content mark and can be reported for
takedown at any time.`;

export function consentTextSha256(): string {
  return createHash('sha256').update(REAL_PERSON_CONSENT_TEXT).digest('hex');
}

// ── ⟦v2⟧ Per-project GRANT consent (design §6) ──
// A SEPARATE, purpose-scoped consent the subject gives when authorizing ONE
// project to use their likeness. Names the project + the offshore processor,
// carries the Art.38-39 cross-border separate consent for the third-party
// purpose, and — critically — the purpose-limitation / prohibited-use clauses
// that bound the authorization (the "contract terms" that make a project-level
// grant defensible instead of headcount approval).
export const GRANT_CONSENT_VERSION = 'realperson-grant-v1-2026-07-02';

/** The canonical grant consent text for a named project (hashed into the ledger). */
export function grantConsentText(projectName: string): string {
  return `FizzDragon Likeness Authorization for Project "${projectName}" (${GRANT_CONSENT_VERSION})

1. What you authorize. You authorize the editors of the project "${projectName}"
— its current and future members — to generate videos containing your verified
likeness, solely for that project's creative purpose.

2. Purpose limitation & prohibited uses. Your likeness may be used ONLY within
"${projectName}" for its stated creative work. It must NOT be used for sexual,
sexually suggestive, defamatory, harassing, unlawful, or political-impersonation
content, nor for any purpose outside this project. These limits bind every
person who works on the project.

3. Cross-border processing. Generating with your likeness sends it to BytePlus
ModelArk in Singapore (ap-southeast-1), outside your country of residence, for
this third-party project purpose. You give separate consent to this transfer.

4. Your controls. You can withdraw this authorization for "${projectName}" at
any time (independently of any other project). On withdrawal we stop new
generations immediately and give you a takedown path over videos already made
from your likeness in this project. You can see every output generated from
your likeness in this project.

5. This authorization is limited to "${projectName}". It does not authorize any
other project, and it does not transfer ownership of your likeness. You confirm
you are 18 or older.`;
}

export function grantConsentTextSha256(projectName: string): string {
  return createHash('sha256')
    .update(grantConsentText(projectName))
    .digest('hex');
}

// ── Enrollment vendor-token envelope crypto (design §1: bytedTokenEnc) ──
// AES-256-GCM with a versioned `$`-joined base64url format — the same idiom
// as admin-mfa's TOTP secret storage. The token is single-use and hard-
// deleted (nulled) on completion/expiry; encryption bounds the blast radius
// of a DB read between those two moments.

const TOKEN_ENC_VERSION = 'v1';

export function encryptEnrollmentToken(
  token: string,
  keyBase64: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', decodeKey(keyBase64), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);
  return [
    TOKEN_ENC_VERSION,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('$');
}

export function decryptEnrollmentToken(
  encoded: string,
  keyBase64: string,
): string {
  const [version, ivRaw, encryptedRaw, tagRaw] = encoded.split('$');
  if (version !== TOKEN_ENC_VERSION || !ivRaw || !encryptedRaw || !tagRaw) {
    throw new Error('Malformed enrollment token envelope');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    decodeKey(keyBase64),
    Buffer.from(ivRaw, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function decodeKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'CHARACTER_ENROLLMENT_TOKEN_KEY must be 32 bytes (base64) — generate with `openssl rand -base64 32`',
    );
  }
  return key;
}
