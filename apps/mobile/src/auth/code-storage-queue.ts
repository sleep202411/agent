// SecureStore writes cannot be cancelled; keep OTP writes/deletes in invocation order.
let tail: Promise<void> = Promise.resolve();
export function withCodeStorage<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.then(
    () => {},
    () => {}
  );
  return result;
}
