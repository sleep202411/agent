/** Media supplied by a work's published introduction. */
export type StoreMediaItem =
  | { kind: "video"; url: string; posterUrl: string | null }
  | { kind: "image"; url: string; alt: string };
