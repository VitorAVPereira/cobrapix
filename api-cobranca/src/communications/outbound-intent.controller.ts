import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { PrismaService } from '../prisma/prisma.service';

class IntentQuery {
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

@Controller('communications/admin/outbound-intents')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class OutboundIntentController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async list(@Query() query: IntentQuery): Promise<unknown> {
    const rows = await this.prisma.communicationOutboundIntent.findMany({
      where: { state: { in: ['UNCERTAIN', 'FAILED', 'PENDING', 'SENDING'] } },
      select: {
        id: true,
        messageId: true,
        companyId: true,
        invoiceId: true,
        state: true,
        lastErrorCode: true,
        attempts: true,
        nextAttemptAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, query.limit);
    return {
      items,
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }
}
