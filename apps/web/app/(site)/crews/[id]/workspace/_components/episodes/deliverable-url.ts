/**
 * The one rule the submit form and the assignment row must agree on.
 *
 * The row renders a member-supplied deliverable link as a real `<a href>`,
 * so anything that is not an http(s) URL — `javascript:`, `data:` — must
 * never reach it. The form rejects those on the way in; the row still
 * checks on the way out, because the form is not the only writer of this
 * field (the API is reachable directly).
 */
export function isWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
