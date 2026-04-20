import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

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
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
