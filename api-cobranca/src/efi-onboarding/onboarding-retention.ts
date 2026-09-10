import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OnboardingRetention {
  constructor(private readonly prisma: PrismaService) {}
  @Cron('0 15 2 * * *')
  async purge(): Promise<void> {
    const now = new Date();
    // Internal retention sweep intentionally covers all tenants and never emits decrypted data.
    await this.prisma.efiOnboarding.updateMany({
      where: {
        sensitiveDataDeletedAt: null,
        OR: [
          { status: { in: ['ACTIVE', 'DISCONNECTED'] } },
          { lastProgressAt: { lte: new Date(now.getTime() - 30 * 86400_000) } },
        ],
      },
      data: {
        representativeNameEncrypted: null,
        representativeCpfEncrypted: null,
        representativeBirthDateEncrypted: null,
        representativeMotherNameEncrypted: null,
        representativeEmailEncrypted: null,
        representativePhoneEncrypted: null,
        sensitiveDataKeyVersion: null,
        sensitiveDataDeletedAt: now,
      },
    });
    await this.prisma.communicationMessage.updateMany({
      where: { retentionExpiresAt: { lte: now }, anonymizedAt: null },
      data: {
        content: 'Conteúdo removido após o prazo de retenção.',
        anonymizedAt: now,
        externalMessageId: null,
      },
    });
    // A conversation's expiry must cover its most recent message; deleting identity earlier would break the central inbox.
    await this.prisma.communicationConversation.updateMany({
      where: {
        retentionExpiresAt: { lte: now },
        recipientAnonymizedAt: null,
        messages: { none: { retentionExpiresAt: { gt: now } } },
      },
      data: {
        recipientEncrypted: null,
        lastMessagePreview: null,
        recipientAnonymizedAt: now,
      },
    });
    await this.prisma.auditLog.deleteMany({
      where: { retentionExpiresAt: { lte: now } },
    });
  }
}
