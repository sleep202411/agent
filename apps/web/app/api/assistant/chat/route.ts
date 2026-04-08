/**
 * Streaming proxy for NestJS assistant chat endpoint.
 *
 * Uses node:http instead of fetch() to avoid:
 * - Next.js rewrite buffering SSE responses
 * - undici's 300s body timeout (UND_ERR_BODY_TIMEOUT)
 *
 * Pipeline tool execution can block for 10+ minutes on long texts.
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3001";

export const maxDuration = 900;

export async function POST(request: Request) {
  const body = await request.text();
  const url = new URL(`${SERVER_URL}/assistant/chat`);
  const isHttps = url.protocol === "https:";

  return new Promise<Response>((resolve) => {
    const req = (isHttps ? httpsRequest : httpRequest)(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
          "accept-language": request.headers.get("accept-language") ?? "zh-CN",
        },
        timeout: 15 * 60 * 1000,
      },
      (res) => {
        const status = res.statusCode ?? 500;

        if (status >= 400) {
          let errorBody = "";
          res.on("data", (chunk: Buffer) => {
            errorBody += chunk.toString();
          });
          res.on("end", () => {
            resolve(
              new Response(errorBody, {
                status,
                headers: { "Content-Type": res.headers["content-type"] ?? "application/json" },
              })
            );
          });
          return;
        }

        const stream = new ReadableStream({
          start(controller) {
            res.on("data", (chunk: Buffer) => {
              controller.enqueue(new Uint8Array(chunk));
            });
            res.on("end", () => {
              controller.close();
            });
            res.on("error", (err) => {
              controller.error(err);
            });
          },
          cancel() {
            res.destroy();
          },
        });

        resolve(
          new Response(stream, {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
            },
          })
        );
      }
    );

    req.on("error", (err) => {
      resolve(
        new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    req.on("timeout", () => {
      req.destroy(new Error("Proxy request timed out after 15 minutes"));
    });

    req.write(body);
    req.end();
  });
}
