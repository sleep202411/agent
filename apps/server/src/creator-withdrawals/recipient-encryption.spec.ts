import { decryptRecipient, encryptRecipient } from './recipient-encryption';
const recipient = {
  fullName: 'Creator',
  accountNumber: '123456789',
  address: 'Singapore',
  swift: 'DBSSSGSG',
  branchAddress: 'Singapore branch',
};
const old = process.env.CREATOR_PAYOUT_DETAILS_KEY;
beforeEach(() => {
  process.env.CREATOR_PAYOUT_DETAILS_KEY = 'ab'.repeat(32);
});
afterEach(() => {
  if (old === undefined) delete process.env.CREATOR_PAYOUT_DETAILS_KEY;
  else process.env.CREATOR_PAYOUT_DETAILS_KEY = old;
});
it('encrypts saved details with fresh nonces and decrypts only for the same owner/context', () => {
  const first = encryptRecipient(recipient, 'account:alice');
  const second = encryptRecipient(recipient, 'account:alice');
  expect(first).not.toBe(second);
  expect(first).not.toContain('123456789');
  expect(decryptRecipient(first, 'account:alice')).toEqual(recipient);
  expect(() => decryptRecipient(first, 'account:bob')).toThrow();
  expect(() => decryptRecipient(first, 'withdrawal:alice')).toThrow();
});
it('fails closed without the configured encryption key', () => {
  delete process.env.CREATOR_PAYOUT_DETAILS_KEY;
  expect(() => encryptRecipient(recipient, 'account:alice')).toThrow(
    'CREATOR_PAYOUT_DETAILS_KEY',
  );
});
it('detects changed ciphertext', () => {
  const parts = encryptRecipient(recipient, 'account:alice').split('.');
  parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
  expect(() => decryptRecipient(parts.join('.'), 'account:alice')).toThrow();
});
