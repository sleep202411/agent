import { fetchIpAccess, getIpById } from "@/data/browse-service";

/** A failed access check must not turn an episode trailer into playable content.
 * Keep the public detail available, and expose the failure for an explicit retry. */
export async function loadPlaybackDetail(id: string) {
  const [detail, result] = await Promise.all([
    getIpById(id),
    fetchIpAccess(id).then(
      (access) => ({ access, accessError: null }),
      (error: unknown) => ({
        access: undefined,
        accessError: error instanceof Error ? error.message : "",
      })
    ),
  ]);
  return { detail, ...result };
}
