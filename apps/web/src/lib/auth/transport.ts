"use client";

/**
 * `apps/web`'s wire adapter for `@repo/auth-flow`.
 *
 * The package deliberately knows nothing about how this app reaches
 * Java. Web routes every `/user/*` call through the cell-specific
 * content prefix so nginx can send it straight at the content service —
 * the same rule `src/lib/api/api-client.ts#applyApiPrefix` applies to
 * its `CONTENT_RE` branch. That resolver isn't exported, and the auth
 * surface is entirely `/user/*`, so the prefix is applied directly here
 * rather than widening the api-client's public surface.
 *
 * Keep the two in step: if `NEXT_PUBLIC_API_CONTENT_PREFIX` ever stops
 * being the right prefix for `/user/*`, both places change together.
 */

import { createFetchTransport, type AuthTransport } from "@repo/auth-flow";

const SIGN_IN_CODE_PATH = "/user/new/getCode";

export function createWebAuthTransport(locale: string): AuthTransport {
  const transport = createFetchTransport({
    resolvePath: (path) => `${process.env.NEXT_PUBLIC_API_CONTENT_PREFIX ?? ""}${path}`,
    // Java localizes its `msg` strings off this header, and unmapped
    // failures are shown verbatim — so the header is what decides
    // whether the user reads an error in their own language.
    headers: () => ({ "accept-language": locale }),
  });

  return {
    request(input) {
      // The verification-email service selects its localized template from
      // this query parameter. `locale` is the active website path locale
      // (`en-US`, `zh-CN` or `zh-HK`) supplied by AuthDialogProvider.
      if (input.path === SIGN_IN_CODE_PATH) {
        return transport.request({
          ...input,
          query: { ...input.query, locale },
        });
      }
      return transport.request(input);
    },
  };
}
