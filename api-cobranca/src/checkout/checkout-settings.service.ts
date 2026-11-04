import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutAssetsService } from './checkout-assets.service';
import { conflict, versionChanged } from './checkout-rules';
import { UpdateCheckoutSettingsDto } from './dto/checkout-settings.dto';

@Injectable()
export class CheckoutSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: CheckoutAssetsService,
  ) {}

  async get(companyId: string) {
    const settings = await this.prisma.checkoutSettings.findUnique({
      where: { companyId },
    });
    if (!settings)
      throw new NotFoundException('Configurações do checkout não encontradas.');
    return settings;
  }

  async update(companyId: string, dto: UpdateCheckoutSettingsDto) {
    if (!dto.pixEnabled && !dto.cardEnabled)
      conflict(
        'CHECKOUT_NO_PAYMENT_METHOD',
        'Deixe ao menos uma forma de pagamento ligada.',
      );
    // Card waits for the Efí card approval on the CifraMais account (part 6).
    if (dto.cardEnabled)
      conflict(
        'CARD_NOT_AVAILABLE',
        'O cartão ainda não está disponível no checkout.',
      );
    await this.assets.assertOwned(
      this.prisma,
      companyId,
      dto.logoAssetId,
      'LOGO',
    );
    await this.assets.assertOwned(
      this.prisma,
      companyId,
      dto.bannerAssetId,
      'BANNER',
    );
    const { expectedVersion, ...fields } = dto;
    const updated = await this.prisma.checkoutSettings.updateMany({
      where: { companyId, version: expectedVersion },
      data: {
        displayName: fields.displayName.trim(),
        logoAssetId: fields.logoAssetId ?? null,
        bannerAssetId: fields.bannerAssetId ?? null,
        primaryColor: fields.primaryColor.toUpperCase(),
        supportEmail: fields.supportEmail?.trim().toLowerCase() || null,
        supportWhatsapp: fields.supportWhatsapp ?? null,
        whatsappButtonPhone: fields.whatsappButtonPhone ?? null,
        pixEnabled: fields.pixEnabled,
        cardEnabled: fields.cardEnabled,
        maxInstallments: fields.maxInstallments,
        pixFeePayer: fields.pixFeePayer,
        cardFeePayer: fields.cardFeePayer,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      await this.get(companyId);
      versionChanged();
    }
    return this.get(companyId);
  }
}
