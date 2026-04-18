import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Módulo global do Prisma. Qualquer outro módulo que declare
 * `PrismaService` como dependência vai resolvê-lo automaticamente.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
