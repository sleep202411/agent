import 'dotenv/config';
import { Agent, setGlobalDispatcher } from 'undici';
import { Logger } from '@nestjs/common';
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

/**
 * Worker-only mode: boot the Nest providers without binding an HTTP
 * listener. Used by the dedicated `foundry-worker` pod in production —
 * it consumes the Foundry queue and publishes Web PubSub events but
 * doesn't serve any REST traffic. Toggled via `WORKER_ONLY=true`.
 *
 * Modules are loaded as-is from AppModule for symmetry with the API
 * pod. Controllers exist as registered classes but are never invoked
 * (no HTTP server to route to them), so this is a deliberate trade-off
 * for one configuration surface over one bootstrap path.
 */
async function bootstrapWorker(): Promise<void> {
  const logger = new Logger('WorkerBootstrap');
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
  });
  // Required so FoundryWorkerService.beforeApplicationShutdown can
  // drain in-flight provider fetches on SIGTERM.
  ctx.enableShutdownHooks();
  logger.log('Foundry worker-only mode running; HTTP listener skipped.');

  const shutdown = (signal: NodeJS.Signals) => {
    logger.log(`Received ${signal}; closing Nest context.`);
    void ctx
      .close()
      .catch((err) => logger.error('Nest close failed', err))
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

async function bootstrap() {
  if (process.env.WORKER_ONLY === 'true') {
    await bootstrapWorker();
    return;
  }

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // SIGTERM → drain hooks (FoundryWorkerService awaits in-flight
  // Azure fetches up to ~250s before exiting). LB should already
  // have stopped routing via /ready=503 by the time we get here.
  app.enableShutdownHooks();

  // Increase body size limit for large AI conversations
  const { json, urlencoded } = await import('express');
  app.use(
    json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  app.enableCors({ origin: true, credentials: true });
  // Native `ws` adapter for @WebSocketGateway (platform-ws) — entity-
  // events / chat-events / notifications gateways use plain ws frames,
  // not socket.io.
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
  const httpServer = app.getHttpServer() as {
    requestTimeout: number;
    headersTimeout: number;
  };
  httpServer.requestTimeout = 32 * 60 * 1000;
  httpServer.headersTimeout = httpServer.requestTimeout + 5_000;

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
