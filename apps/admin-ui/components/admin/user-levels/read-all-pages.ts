import { requestEnvelope } from "../billing/shared";

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

/** Bound each walk by its first reported total; this is not a database snapshot. */
export async function readAllPages<T>(
  url: string,
  signal: AbortSignal,
  identity: (item: T) => string | number
): Promise<T[]> {
  const rows = new Map<string | number, T>();
  let lastPage = 1;
  let size = 100;
  for (let page = 1; page <= lastPage; page++) {
    signal.throwIfAborted();
    const params = new URLSearchParams(url.split("?")[1] ?? "");
    params.set("page", String(page));
    params.set("pageSize", String(size));
    const data = await requestEnvelope<Page<T>>(`${url.split("?")[0]}?${params}`, signal);
    if (
      !Array.isArray(data.items) ||
      !Number.isSafeInteger(data.total) ||
      data.total < 0 ||
      data.page !== page ||
      !Number.isSafeInteger(data.pageSize) ||
      data.pageSize < 1 ||
      (page > 1 && data.pageSize !== size)
    )
      throw new Error("The paginated response is inconsistent. Retry the search.");
    if (page === 1) {
      size = data.pageSize;
      lastPage = Math.max(1, Math.ceil(data.total / size));
    } else lastPage = Math.min(lastPage, Math.max(1, Math.ceil(data.total / size)));
    const before = rows.size;
    for (const item of data.items) rows.set(identity(item), item);
    if (page <= lastPage && data.total > 0 && rows.size === before)
      throw new Error("The paginated response made no progress. Retry the search.");
  }
  return [...rows.values()];
}
