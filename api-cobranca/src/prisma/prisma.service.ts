import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import ws from 'ws';

// Neon serverless driver precisa de um WebSocket constructor em Node.
// Deve rodar no top-level do módulo, ANTES do primeiro `new PrismaClient`.
neonConfig.webSocketConstructor = ws;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>('DATABASE_URL');
    super({ adapter: new PrismaNeon({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma conectado (Neon adapter)');
  }

  async onModuleDestroy(): Promise<void> {
    // Fecha o pool WebSocket do Neon — necessário para shutdown gracioso.
    await this.$disconnect();
    this.logger.log('Prisma desconectado');
  }
}
