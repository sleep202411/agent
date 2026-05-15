import "server-only";

import type { Thing, WithContext } from "schema-dts";

type JsonLdEntry = WithContext<Thing> | Thing;

interface JsonLdProps {
  /**
   * Either a single schema.org JSON-LD object or an array of them.
   * Arrays render as a single `<script>` tag holding a JSON array,
   * which crawlers / AI engines parse as multiple top-level entities.
   * (One tag is slightly cheaper than emitting N tags.)
   */
  data: JsonLdEntry | JsonLdEntry[];
}

/**
 * Inject a schema.org JSON-LD payload into the SSR HTML.
 *
 * Why a raw `<script>` instead of `next/script`:
 *   `next/script` defaults to `strategy="afterInteractive"` which
 *   means the tag is added by client-side JS *after* hydrate. But
 *   crawlers + AI engines (ChatGPT / Perplexity / Google AI Overview)
 *   read the *first-paint* HTML — they don't run our client JS. The
 *   structured data has to be in the SSR'd HTML for them to pick up,
 *   so we go through the React tree as a plain `<script>` element.
 *
 * Why dangerouslySetInnerHTML:
 *   React refuses to render text children inside `<script>`. We have
 *   to bypass via innerHTML.
 *
 * Why `.replace(/</g, '\\u003c')`:
 *   XSS hardening. If any field in `data` contains the literal string
 *   `</script>` (e.g. user-authored description), the closing tag
 *   would escape JSON context and break out of the script element.
 *   Encoding every `<` as `<` neutralises that — JSON.parse
 *   decodes the escape back to `<`, so the structured data is
 *   unchanged for consumers.
 *
 * Why `import "server-only"`:
 *   Forbids accidentally importing this from a client component,
 *   which would (a) bloat the JS bundle with stringified schema and
 *   (b) defeat the whole point — we need the JSON-LD in the SSR HTML,
 *   not injected after hydrate.
 */
export function JsonLd({ data }: JsonLdProps) {
  // Emit one <script> tag per schema entity, never a top-level JSON
  // array. Spec-wise an array of JSON-LD objects is legal, but in the
  // wild we hit `TypeError: undefined is not an object (evaluating
  // r["@context"].toLowerCase)` from third-party parsers (browser
  // extensions, lightweight crawler bots) that read the JSON value
  // and dereference `["@context"]` without checking for array shape.
  // Captured 2026-05-15 from real users via PostHog Error Tracking.
  //
  // Per-entity tags also let crawlers selectively skip a malformed
  // entry without losing the rest of the page's structured data.
  const entries = Array.isArray(data) ? data : [data];
  return (
    <>
      {entries.map((entry, idx) => (
        <script
          // Stable key from the @type field when present, falling back
          // to index. Multiple Organisations on one page shouldn't be
          // a real case but the suffix keeps React happy regardless.
          key={`${(entry as { "@type"?: string })["@type"] ?? "ld"}-${idx}`}
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(entry).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </>
  );
}
