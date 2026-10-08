import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  AppearanceWebActionSchema as ClientActionSchema,
  AppearanceWebScopeSchema,
} from "@repo/game-agent-protocol";
import {
  openAppearanceWeb,
  pollAppearanceWeb,
  closeAppearanceWeb,
  AppearanceWebSessionNotFound,
} from "./web.js";

// Presentation and ownership are attached by the authenticated Nest admission,
// never accepted from the browser's action contract.
export const AppearanceWebActionSchema = z.discriminatedUnion("action", [
  ClientActionSchema.options[0]
    .extend({
      scope: AppearanceWebScopeSchema,
      parentOrigin: z.string().url(),
      copy: z
        .object({ working: z.string().min(1).max(500), workingFor: z.string().min(1).max(500) })
        .strict(),
    })
    .strict(),
  ClientActionSchema.options[1].extend({ scope: AppearanceWebScopeSchema }).strict(),
  ClientActionSchema.options[2].extend({ scope: AppearanceWebScopeSchema }).strict(),
]);
export async function serveAppearanceWeb(req: IncomingMessage, res: ServerResponse) {
  const controller = new AbortController();
  const disconnect = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once("aborted", disconnect);
  res.once("close", disconnect);
  try {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const b = Buffer.from(chunk);
      size += b.length;
      if (size > 2 * 1024 * 1024) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(b);
    }
    const input = AppearanceWebActionSchema.parse(JSON.parse(Buffer.concat(chunks).toString()));
    controller.signal.throwIfAborted();
    const result =
      input.action === "open"
        ? await openAppearanceWeb(input, controller.signal)
        : input.action === "close"
          ? await closeAppearanceWeb(input.id, input.leaseId, input.scope)
          : await pollAppearanceWeb(input.id, input.scope);
    if (!res.destroyed && !controller.signal.aborted)
      res
        .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify(result));
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    const status =
      error instanceof AppearanceWebSessionNotFound
        ? 404
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 502;
    if (!res.destroyed)
      res
        .writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
        .end(
          JSON.stringify({
            error: {
              message:
                status === 400
                  ? "Invalid appearance session request."
                  : error instanceof Error
                    ? error.message
                    : "Appearance session unavailable.",
            },
          })
        );
  } finally {
    req.off("aborted", disconnect);
    res.off("close", disconnect);
  }
}
