import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHECKOUT_ASSET_MAX_BYTES,
  CheckoutAssetsService,
  detectImageType,
} from './checkout-assets.service';
import { CheckoutSettingsService } from './checkout-settings.service';
import { UpdateCheckoutSettingsDto } from './dto/checkout-settings.dto';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('detectImageType', () => {
  it('reconhece PNG, JPEG e WebP pelos primeiros bytes', () => {
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(WEBP)).toBe('image/webp');
  });

  it('recusa SVG e texto renomeado', () => {
    expect(detectImageType(SVG)).toBeNull();
    expect(detectImageType(Buffer.from('não sou imagem'))).toBeNull();
  });
});

describe('CheckoutAssetsService', () => {
  const prisma = {
    checkoutAsset: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const service = new CheckoutAssetsService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('grava a imagem com o tipo detectado e devolve o endereço público', async () => {
    prisma.checkoutAsset.create.mockResolvedValue({
      id: 'asset-1',
      kind: 'LOGO',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });

    await expect(
      service.upload('company-a', 'LOGO', { buffer: PNG, size: PNG.length }),
    ).resolves.toMatchObject({ url: '/checkout/public/assets/asset-1' });
    expect(prisma.checkoutAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-a',
          contentType: 'image/png',
        }) as unknown,
      }),
    );
  });

  it('recusa SVG, arquivo vazio e arquivo acima de 1 MB', async () => {
    await expect(
      service.upload('company-a', 'LOGO', { buffer: SVG, size: SVG.length }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upload('company-a', 'LOGO', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upload('company-a', 'LOGO', {
        buffer: PNG,
        size: CHECKOUT_ASSET_MAX_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.checkoutAsset.create).not.toHaveBeenCalled();
  });

  it('imagem de outra empresa ou de outro tipo responde 404', async () => {
    prisma.checkoutAsset.findFirst.mockResolvedValue(null);

    await expect(
      service.assertOwned(
        prisma as unknown as PrismaService,
        'company-a',
        'asset-b',
        'LOGO',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.checkoutAsset.findFirst).toHaveBeenCalledWith({
      where: { id: 'asset-b', companyId: 'company-a', kind: 'LOGO' },
      select: { id: true },
    });
  });

  it('leitura pública de imagem inexistente responde 404', async () => {
    prisma.checkoutAsset.findUnique.mockResolvedValue(null);
    await expect(service.read('asset-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('CheckoutSettingsService', () => {
  const prisma = {
    checkoutSettings: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
  const assets = { assertOwned: jest.fn() };
  const service = new CheckoutSettingsService(
    prisma as unknown as PrismaService,
    assets as unknown as CheckoutAssetsService,
  );
  const dto: UpdateCheckoutSettingsDto = {
    expectedVersion: 2,
    displayName: ' Porquim ',
    logoAssetId: 'logo-1',
    bannerAssetId: null,
    primaryColor: '#0f766e',
    supportEmail: 'Suporte@Porquim.test',
    supportWhatsapp: '11999999999',
    whatsappButtonPhone: null,
    pixEnabled: true,
    cardEnabled: false,
    maxInstallments: 12,
    pixFeePayer: 'SELLER',
    cardFeePayer: 'BUYER',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutSettings.findUnique.mockResolvedValue({ version: 3 });
    prisma.checkoutSettings.updateMany.mockResolvedValue({ count: 1 });
  });

  it('salva na versão esperada e confere as imagens da empresa', async () => {
    await service.update('company-a', dto);

    expect(assets.assertOwned).toHaveBeenCalledWith(
      prisma,
      'company-a',
      'logo-1',
      'LOGO',
    );
    expect(prisma.checkoutSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-a', version: 2 },
        data: expect.objectContaining({
          displayName: 'Porquim',
          primaryColor: '#0F766E',
          supportEmail: 'suporte@porquim.test',
          version: { increment: 1 },
        }) as unknown,
      }),
    );
  });

  it('versão antiga responde VERSION_CHANGED', async () => {
    prisma.checkoutSettings.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('company-a', dto)).rejects.toMatchObject({
      response: { code: 'VERSION_CHANGED' },
    });
  });

  it('recusa ligar o cartão e desligar todas as formas de pagamento', async () => {
    await expect(
      service.update('company-a', { ...dto, cardEnabled: true }),
    ).rejects.toMatchObject({ response: { code: 'CARD_NOT_AVAILABLE' } });
    await expect(
      service.update('company-a', { ...dto, pixEnabled: false }),
    ).rejects.toMatchObject({
      response: { code: 'CHECKOUT_NO_PAYMENT_METHOD' },
    });
    expect(prisma.checkoutSettings.updateMany).not.toHaveBeenCalled();
  });
});
