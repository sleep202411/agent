import { idempotencyKey } from './quota-keys';

describe('quota idempotency Redis keys', () => {
  it('namespaces and hashes the operation by authenticated user and dimension', () => {
    const operation = 'client-controlled-operation';
    const chat = idempotencyKey('user-a', 'chat', operation);
    expect(chat).toMatch(/^quota:idem:v2:[0-9a-f]{64}$/);
    expect(chat).not.toContain(operation);
    expect(idempotencyKey('user-a', 'chat', operation)).toBe(chat);
    expect(idempotencyKey('user-b', 'chat', operation)).not.toBe(chat);
    expect(idempotencyKey('user-a', 'image', operation)).not.toBe(chat);
  });

  it('keeps the Redis key fixed-size for long domain operation keys', () => {
    const short = idempotencyKey('user-a', 'chat', 'a');
    const long = idempotencyKey('user-a', 'chat', 'a'.repeat(100_000));
    expect(long).toHaveLength(short.length);
  });
});
