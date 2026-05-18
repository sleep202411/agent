import { redirect } from "next/navigation";

function encodeSearchParams(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default async function LegacyProduceVideoEditorRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; episodeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id, episodeId }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  redirect(
    `/projects/${id}/episodes/${episodeId}/video${encodeSearchParams(resolvedSearchParams)}`
  );
}
