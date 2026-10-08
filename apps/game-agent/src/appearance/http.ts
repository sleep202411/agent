import type { IncomingMessage, ServerResponse } from "node:http";
import { AppearanceDesignRequestSchema } from "@repo/game-agent-protocol";
import { runAppearanceDesign, appearanceHarnessConfig } from "./harness.js";

let running = 0;

export async function serveAppearanceDesign(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) => {
    if (!res.destroyed) {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    }
  };
  const controller = new AbortController();
  const disconnect = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once("close", disconnect);
  let admitted = false;
  try {
    try {
      appearanceHarnessConfig();
    } catch (error) {
      send(503, { error: { message: (error as Error).message } });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 64 * 1024) {
        send(413, { error: { message: "Appearance request is too large." } });
        return;
      }
      chunks.push(buffer);
    }
    const parsed = AppearanceDesignRequestSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString())
    );
    if (!parsed.success) {
      send(400, { error: { message: parsed.error.message } });
      return;
    }
    if (running >= 2) {
      send(503, { error: { message: "Appearance design is busy. Try again shortly." } });
      return;
    }
    running++;
    admitted = true;
    const result = await runAppearanceDesign(parsed.data, { signal: controller.signal });
    send(200, result);
  } catch (error) {
    send(error instanceof SyntaxError ? 400 : 502, {
      error: { message: error instanceof Error ? error.message : String(error) },
    });
  } finally {
    if (admitted) running--;
    res.off("close", disconnect);
  }
}
