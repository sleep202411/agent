import { QueryClient } from "@tanstack/react-query";

/** Workbench snapshots include permissions, so revisit them when returning to the app. */
export function createStudioQueryClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });
  for (const key of ["workbench", "chapter-workbench", "script-workbench", "workbench-shell"]) {
    client.setQueryDefaults(["story-studio", key], { refetchOnWindowFocus: true });
  }
  return client;
}
