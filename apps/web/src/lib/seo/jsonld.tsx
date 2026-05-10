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
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
