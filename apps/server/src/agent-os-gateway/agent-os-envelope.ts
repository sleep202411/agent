/** Studio `api` client requires `{ code, data }` success envelopes. */
export function ok<T>(data: T, code = 200): { code: number; data: T } {
  return { code, data };
}

export function accepted<T>(data: T): { code: number; data: T } {
  return ok(data, 202);
}
