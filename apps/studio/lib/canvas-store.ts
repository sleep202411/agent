"use client";

/**
 * Local persistence for canvas projects (IndexedDB).
 * Frontend-only by design for now — swap the internals for API calls when
 * the backend lands; the function signatures are the contract.
 * Images are stored as Blobs (object URLs die on reload; data URLs blow
 * the localStorage quota).
 */

export type CanvasProjectMeta = {
  id: string;
  name: string;
  updatedAt: number;
};

type StoredNodeBase = {
  id: string;
  position: { x: number; y: number };
};

export type StoredCanvasNode =
  | (StoredNodeBase & { kind: "image"; imageId: string; label?: string })
  | (StoredNodeBase & { kind: "note"; text: string })
  | (StoredNodeBase & { kind: "prompt"; prompt: string; name?: string })
  | (StoredNodeBase & { kind: "video"; prompt: string; name?: string });

export type StoredCanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type CanvasProjectRecord = CanvasProjectMeta & {
  nodes: StoredCanvasNode[];
  edges?: StoredCanvasEdge[];
};

const DB_NAME = "fizzstudio-canvas";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = op(db.transaction(store, mode).objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function listProjects(): Promise<CanvasProjectMeta[]> {
  const all = await run<CanvasProjectRecord[]>("projects", "readonly", (s) => s.getAll());
  return all.map(({ nodes: _nodes, ...meta }) => meta).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProject(): Promise<CanvasProjectMeta> {
  const record: CanvasProjectRecord = {
    id: crypto.randomUUID(),
    name: "Untitled canvas",
    updatedAt: Date.now(),
    nodes: [],
  };
  await run("projects", "readwrite", (s) => s.put(record));
  return record;
}

export async function getProject(id: string): Promise<CanvasProjectRecord | undefined> {
  return run("projects", "readonly", (s) => s.get(id));
}

export async function saveProjectContent(
  id: string,
  nodes: StoredCanvasNode[],
  edges: StoredCanvasEdge[]
): Promise<void> {
  const existing = await getProject(id);
  if (!existing) return;
  await run("projects", "readwrite", (s) =>
    s.put({ ...existing, nodes, edges, updatedAt: Date.now() })
  );
}

export async function deleteProject(id: string): Promise<void> {
  const existing = await getProject(id);
  await run("projects", "readwrite", (s) => s.delete(id));
  if (!existing) return;
  const imageIds = [
    ...new Set(existing.nodes.flatMap((node) => (node.kind === "image" ? [node.imageId] : []))),
  ];
  await Promise.all(
    imageIds.map((imageId) => run("images", "readwrite", (s) => s.delete(imageId)))
  );
}

export async function putImage(blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  await run("images", "readwrite", (s) => s.put(blob, id));
  return id;
}

export async function getImage(id: string): Promise<Blob | undefined> {
  return run("images", "readonly", (s) => s.get(id));
}
