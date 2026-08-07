/** LangChain tool names cannot contain `.` — map to registry ids. */
export function toLangChainToolName(toolId: string): string {
  return toolId.replace(/\./g, "_");
}

export function fromLangChainToolName(name: string): string {
  // Prefer longest known registry ids first when we reverse-map.
  const candidates = [
    "script.readSection",
    "script.store",
    "characters.upsert",
    "characters.list",
    "canvas.applyPatch",
    "canvas.read",
  ];
  for (const id of candidates) {
    if (toLangChainToolName(id) === name) return id;
  }
  return name.replace(/_/g, ".");
}
