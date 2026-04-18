import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Necessário para que PrismaService.onModuleDestroy seja chamado em SIGINT/SIGTERM
  // e o pool WebSocket do Neon feche graciosamente.
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3001);

  await app.listen(port);
  Logger.log(`API escutando em http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
