import { expect, it } from "vitest";
import {
  parseScriptEditorMessage,
  scriptEditorHtml,
  scriptHostInjection,
} from "./story-script-editor-bridge";
const sessionId = "00000000-0000-4000-8000-000000000001";
it("accepts only typed messages from the active editor session", () => {
  expect(parseScriptEditorMessage(JSON.stringify({ type: "ready", sessionId }), sessionId)).toEqual(
    { type: "ready", sessionId }
  );
  expect(
    parseScriptEditorMessage(
      JSON.stringify({ type: "ready", sessionId }),
      "00000000-0000-4000-8000-000000000002"
    )
  ).toBeNull();
  expect(parseScriptEditorMessage('{"type":"checkpoint"}', sessionId)).toBeNull();
  expect(
    parseScriptEditorMessage(
      JSON.stringify({ type: "ready", sessionId, unexpected: true }),
      sessionId
    )
  ).toBeNull();
});
it("quotes injected host data as data rather than executable source", () => {
  const payload = '</script>";globalThis.pwned=true;//';
  const calls: string[] = [];
  new Function("window", scriptHostInjection({ type: "hostError", sessionId, message: payload }))({
    __fizzScriptReceive: (raw: string) => calls.push(raw),
  });
  expect(JSON.parse(calls[0]).message).toBe(payload);
  expect(scriptHostInjection({ type: "hostError", sessionId, message: payload })).not.toContain(
    "</script>"
  );
});
it("embeds only local code and escapes labels inside the initial JSON", () => {
  const html = scriptEditorHtml(sessionId, { editor: "</script><img src=x onerror=alert(1)>" });
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("default-src 'none'");
  expect(html).not.toMatch(/<script[^>]+src=/);
  const initial = html.match(/<script data-initial type="application\/json">(.*?)<\/script>/s)![1];
  expect(JSON.parse(initial).labels.editor).toBe("</script><img src=x onerror=alert(1)>");
});
