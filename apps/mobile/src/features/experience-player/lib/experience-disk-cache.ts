import { Directory, File, Paths } from "expo-file-system";

/**
 * LRU-bounded file cache pool shared by the experience media caches (video
 * clips, audio cues). Each pool owns one directory under `Paths.cache`, tracks
 * access times in a sidecar index, and evicts least-recently-used managed files
 * once the directory exceeds its budget.
 */

const ACCESS_INDEX_NAME = "access-index.json";
/** Coalesce rapid peek/hit touches into one index write. */
const ACCESS_INDEX_FLUSH_MS = 250;

type AccessIndex = Record<string, number>;

type CacheEntry = { file: File; size: number; lastAccessedMs: number };

export type DiskCachePoolOptions = {
  /** Directory name under `Paths.cache`. */
  dirName: string;
  /** Soft ceiling for the managed files in this pool. */
  budgetBytes: number;
  /** Files counted toward the budget and eligible for eviction. */
  isManaged: (fileName: string) => boolean;
  /** Half-written staging files, deleted as orphans on maintenance. */
  isScratch?: (fileName: string) => boolean;
  /**
   * Files a pass must not touch, resolved when the pass runs rather than when it
   * was queued. Both halves of that matter: the pinned set moves as chapters
   * switch, and a staging file belonging to a download that is still running is
   * not an orphan — deleting it leaves the transfer writing to an unlinked inode
   * and reporting success over an empty file.
   */
  protectedFileNames?: () => ReadonlySet<string>;
};

export type DiskCachePool = {
  directory: () => Directory;
  ensureDirectory: () => void;
  file: (name: string) => File;
  /** Mark a file as just-used so eviction prefers older entries. */
  touch: (fileName: string) => void;
  /**
   * Serialised eviction pass. `protectFileNames` shields files written moments
   * ago whose access touch may not have reached disk yet; the pool's own
   * `protectedFileNames` are added on top when the pass runs.
   */
  enqueueEviction: (protectFileNames?: ReadonlySet<string>) => Promise<void>;
};

export function deleteQuietly(file: File): boolean {
  try {
    if (file.exists) file.delete();
    return !file.exists;
  } catch {
    // Do not report reclaimed bytes when deletion failed.
    return false;
  }
}

export function createDiskCachePool(options: DiskCachePoolOptions): DiskCachePool {
  const directory = () => new Directory(Paths.cache, options.dirName);
  const file = (name: string) => new File(directory(), name);

  const ensureDirectory = () => {
    const dir = directory();
    if (!dir.exists) {
      dir.create({ intermediates: true, idempotent: true });
    }
  };

  let accessIndexCache: AccessIndex | null = null;
  let accessIndexFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const readAccessIndex = (): AccessIndex => {
    if (accessIndexCache) return accessIndexCache;
    const index = file(ACCESS_INDEX_NAME);
    try {
      if (index.exists) {
        const parsed: unknown = JSON.parse(index.textSync());
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const next: AccessIndex = {};
          for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === "number" && Number.isFinite(value)) next[name] = value;
          }
          accessIndexCache = next;
          return next;
        }
      }
    } catch {
      // Corrupt index — start fresh; files still evict by mtime fallback.
    }
    accessIndexCache = {};
    return accessIndexCache;
  };

  const flushAccessIndex = (): void => {
    accessIndexFlushTimer = null;
    if (!accessIndexCache) return;
    try {
      ensureDirectory();
      const index = file(ACCESS_INDEX_NAME);
      if (!index.exists) index.create({ intermediates: true, overwrite: true });
      index.write(JSON.stringify(accessIndexCache));
    } catch (error: unknown) {
      console.warn(`[experience-disk-cache] ${options.dirName} index write failed`, error);
    }
  };

  const touch = (fileName: string): void => {
    const index = readAccessIndex();
    index[fileName] = Date.now();
    if (accessIndexFlushTimer !== null) return;
    accessIndexFlushTimer = setTimeout(flushAccessIndex, ACCESS_INDEX_FLUSH_MS);
  };

  const lastAccessedMs = (entry: File, index: AccessIndex): number => {
    const tracked = index[entry.name];
    if (typeof tracked === "number") return tracked;
    try {
      const info = entry.info();
      return info.modificationTime ?? info.creationTime ?? 0;
    } catch {
      return 0;
    }
  };

  const listManagedEntries = (index: AccessIndex): CacheEntry[] => {
    const dir = directory();
    if (!dir.exists) return [];
    const entries: CacheEntry[] = [];
    try {
      for (const entry of dir.list()) {
        if (!(entry instanceof File)) continue;
        if (!options.isManaged(entry.name)) continue;
        try {
          if (!entry.exists) continue;
          const size = entry.size;
          if (!size || size <= 0) continue;
          entries.push({ file: entry, size, lastAccessedMs: lastAccessedMs(entry, index) });
        } catch {
          // Skip unreadable entries.
        }
      }
    } catch {
      return [];
    }
    return entries;
  };

  const scrubScratchFiles = (protectedFileNames: ReadonlySet<string>): void => {
    const isScratch = options.isScratch;
    if (!isScratch) return;
    const dir = directory();
    if (!dir.exists) return;
    try {
      for (const entry of dir.list()) {
        if (!(entry instanceof File)) continue;
        if (!isScratch(entry.name)) continue;
        if (protectedFileNames.has(entry.name)) continue;
        deleteQuietly(entry);
      }
    } catch {
      // Directory vanished mid-scan.
    }
  };

  const pruneStaleAccessKeys = (index: AccessIndex, entries: readonly CacheEntry[]): void => {
    const live = new Set(entries.map((entry) => entry.file.name));
    for (const name of Object.keys(index)) {
      if (!live.has(name)) delete index[name];
    }
  };

  const enforceBudget = (extraProtectedNames: ReadonlySet<string>): void => {
    ensureDirectory();
    const protectFileNames = new Set([
      ...(options.protectedFileNames?.() ?? []),
      ...extraProtectedNames,
    ]);
    scrubScratchFiles(protectFileNames);

    const index = readAccessIndex();
    const entries = listManagedEntries(index);
    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes <= options.budgetBytes) {
      pruneStaleAccessKeys(index, entries);
      return;
    }

    entries.sort((left, right) => left.lastAccessedMs - right.lastAccessedMs);
    for (const entry of entries) {
      if (totalBytes <= options.budgetBytes) break;
      if (protectFileNames.has(entry.file.name)) continue;
      if (deleteQuietly(entry.file)) {
        delete index[entry.file.name];
        totalBytes -= entry.size;
      }
    }
    pruneStaleAccessKeys(index, listManagedEntries(index));
    flushAccessIndex();
  };

  // Serial eviction queue — downloads can finish close together; one pass at a
  // time keeps the access index coherent.
  let evictionChain: Promise<void> = Promise.resolve();

  const enqueueEviction = (protectFileNames: ReadonlySet<string> = new Set()): Promise<void> => {
    const run = evictionChain.then(() => enforceBudget(protectFileNames));
    evictionChain = run.catch(() => undefined);
    return run;
  };

  return { directory, ensureDirectory, file, touch, enqueueEviction };
}
