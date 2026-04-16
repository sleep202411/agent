import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { parseSearchWith, stringifySearchWith } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { deLocalizeUrl, localizeUrl } from "./i18n/locale-url";

/**
 * Custom search param parser that keeps all values as strings.
 * Prevents TanStack Router's default JSON.parse from converting
 * large numeric IDs to numbers (which loses precision).
 */
const parseSearch = parseSearchWith((value) => value);
const stringifySearch = stringifySearchWith((value) =>
  typeof value === "string" ? value : JSON.stringify(value)
);

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    parseSearch,
    stringifySearch,
    rewrite: {
      input: ({ url }) => deLocalizeUrl(url),
      output: ({ url }) => localizeUrl(url),
    },
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
