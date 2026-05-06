import 'dotenv/config';
import { Agent, setGlobalDispatcher } from 'undici';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

// Outbound fetch — Node 18+ uses undici under the hood. Its default
// `headersTimeout` is 5 min (the time between request sent and the
// FIRST response header byte received). The produce-script-sync path
// has Mastra hold the connection for up to 30 min before sending any
// headers (it waits for the workflow to complete, then writes the
// JSON body in one go). Without this override, undici aborts the
// request as `fetch failed` exactly at 5 min — `AbortSignal.timeout`
// on the fetch call doesn't override the dispatcher's own clock.
//
// Also bumps `bodyTimeout` for symmetry; Mastra's body is small (a
// few KB of JSON) but the same long-poll quirk applies if we ever
// stream chunked.
setGlobalDispatcher(
  new Agent({
    headersTimeout: 31 * 60 * 1000,
    bodyTimeout: 31 * 60 * 1000,
  }),
);

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Increase body size limit for large AI conversations
  const { json, urlencoded } = await import('express');
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  app.enableCors({ origin: true, credentials: true });
  // Enable native `ws` adapter for @WebSocketGateway (platform-ws). The
  // gateway at apps/server/src/assistant/workflow-events.gateway.ts uses
  // plain ws frames, not socket.io.
  app.useWebSocketAdapter(new WsAdapter(app));

  // Long-lived endpoints — produce-mode `/produce/script-draft/sync`
  // proxies an in-process Mastra workflow that can run up to 30 min.
  // Node's http.Server ships with `requestTimeout=300_000` (5 min)
  // which would RST our socket halfway through and surface to the
  // browser as `socket hang up / ECONNRESET`. Bump to 32 min —
  // slightly longer than the forward-fetch ceiling (31 min) and the
  // Mastra server.timeout (30 min) so the upstream's clean 504 wins
  // the race when the workflow truly overruns. `headersTimeout` must
  // exceed `requestTimeout` per Node's invariant.
  const httpServer = app.getHttpServer();
  httpServer.requestTimeout = 32 * 60 * 1000;
  httpServer.headersTimeout = httpServer.requestTimeout + 5_000;

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
