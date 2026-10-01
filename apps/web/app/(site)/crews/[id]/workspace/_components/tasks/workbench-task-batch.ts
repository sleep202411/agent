export type TemplateTaskFields = Array<{
  templateKey: string;
  values: Array<{ fieldId: string; value: string | number | boolean | string[] | null }>;
}>;

/** A reviewed, versioned command; submission remains atomic in the backend. */
export type WorkbenchTaskBatch = {
  key: string;
  title: string;
  path: string;
  body: Record<string, string | number | TemplateTaskFields>;
  items: Array<{ title: string; role?: string; assetCategory?: string }>;
};
