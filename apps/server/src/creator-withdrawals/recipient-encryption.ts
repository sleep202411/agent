import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { WithdrawalRecipient } from './withdrawal-contract';
function key() {
  const raw = process.env.CREATOR_PAYOUT_DETAILS_KEY;
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw))
    throw new Error(
      'CREATOR_PAYOUT_DETAILS_KEY must contain a 32-byte hexadecimal key.',
    );
  return Buffer.from(raw, 'hex');
}
export function validateRecipientEncryptionKey(): void {
  key();
}

/** AAD prevents substituting another creator's or another request's bank data. */
export function encryptRecipient(
  recipient: z.infer<typeof WithdrawalRecipient>,
  context: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(WithdrawalRecipient.parse(recipient))),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}
export function decryptRecipient(
  encoded: string,
  context: string,
): z.infer<typeof WithdrawalRecipient> {
  const [version, iv, body, tag, ...rest] = encoded.split('.');
  if (version !== 'v1' || !iv || !body || !tag || rest.length)
    throw new Error('Invalid payout details.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return WithdrawalRecipient.parse(
    JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(body, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    ),
  );
}
