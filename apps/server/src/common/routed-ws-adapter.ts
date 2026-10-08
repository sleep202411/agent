import type { INestApplicationContext } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

export interface ScopedUpgradeHandler {
  matchesPath(url: string | undefined): boolean;
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void>;
}

/** Dispatch scoped streaming connections before Nest rejects unknown WS paths. */
export class RoutedWsAdapter extends WsAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly scoped: ScopedUpgradeHandler,
  ) {
    super(app);
    // Hosted Harness must work even when no ordinary gateway is enabled.
    this.ensureHttpServerExists(0, this.httpServer as Server);
  }

  protected override ensureHttpServerExists(port: number, server?: Server) {
    if (this.httpServersRegistry.has(port)) return;
    const existing = new Set(server?.listeners('upgrade') ?? []);
    const created = super.ensureHttpServerExists(port, server);
    if (!created) return created;
    const delegate = created
      .listeners('upgrade')
      .find((listener) => !existing.has(listener)) as
      | ((request: IncomingMessage, socket: Duplex, head: Buffer) => void)
      | undefined;
    if (!delegate)
      throw new Error('WebSocket upgrade dispatch could not be initialized.');
    created.removeListener('upgrade', delegate);
    created.on('upgrade', (request, socket, head) => {
      if (this.scoped.matchesPath(request.url)) {
        void this.scoped
          .handleUpgrade(request, socket, head)
          .catch(() => socket.destroy());
      } else {
        delegate.call(created, request, socket, head);
      }
    });
    return created;
  }
}
