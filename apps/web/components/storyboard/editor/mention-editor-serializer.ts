// ---------------------------------------------------------------------------
// Serialization: editor HTML -> backend format
// ---------------------------------------------------------------------------

/**
 * Convert tiptap editor HTML to our backend mention format.
 * The editor stores mentions as `<mention id="..." type="..." ...>label</mention>`.
 * The renderHTML of MentionNode already produces this format, so we just need to
 * strip the tiptap wrapper tags (p, etc.) and convert to plain text with mentions.
 */
export function serializeEditorHtml(html: string, showAvatar: boolean): string {
  // The editor wraps content in <p> tags. Convert to plain text format.
  let result = html;

  // Remove wrapping <p> tags, replace closing+opening with newline
  result = result
    .replace(/<p>\s*<\/p>/gi, "\n")
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<p>/gi, "")
    .replace(/<\/p>/gi, "");

  // Replace <br> with newline
  result = result.replace(/<br\s*\/?>/gi, "\n");

  // Clean up &nbsp;
  result = result.replace(/&nbsp;/gi, " ");

  // The mention tags rendered by renderHTML are already in the correct format:
  // <mention id="..." type="..." imgUrl="..." voiceId="..." model="...">label</mention>
  // However, if showAvatar is false, strip imgUrl from mentions
  if (!showAvatar) {
    result = result.replace(/(<mention\s[^>]*?)\s*imgUrl="[^"]*"([^>]*>)/gi, "$1$2");
  }

  return result;
}

/**
 * Convert backend mention format to tiptap-compatible HTML.
 * Backend: plain text with <mention id="..." type="..." ...>label</mention>
 * Tiptap: wrapped in <p> tags with mention nodes
 */
export function deserializeToEditorHtml(value: string): string {
  if (!value) return "<p></p>";

  // The value may contain \n for line breaks and <mention> tags.
  // We need to wrap in <p> tags for tiptap.
  // Split by newlines, wrap each line in <p>, keep <mention> tags as-is
  // since our parseHTML handles them.
  const lines = value.split("\n");
  return lines.map((line) => `<p>${line || "<br>"}</p>`).join("");
}
