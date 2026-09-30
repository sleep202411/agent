/** A reviewed, versioned command; submission remains atomic in the backend. */
export type WorkbenchTaskBatch = {
  key: string;
  title: string;
  path: string;
  body: Record<string, string | number>;
  items: Array<{ title: string; role?: string }>;
};
