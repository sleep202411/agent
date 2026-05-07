import "server-only";

import { cache } from "react";
import { QueryClient } from "@tanstack/react-query";

/**
 * Per-request QueryClient for server components.
 *
 * Wrapped in React's `cache()` so multiple server components in the
 * same request reuse the same client (and its cache) — which means
 * if two server components both prefetch user info, only one fetch
 * happens. Each new request gets a fresh client.
 *
 * Mirror the client-side defaults from <Providers> so prefetched
 * data has the same staleness window when it lands on the client.
 */
export const getServerQueryClient = cache(
  () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60 * 1000,
          refetchOnWindowFocus: false,
        },
      },
    })
);
