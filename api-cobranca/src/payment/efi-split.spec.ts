import { ConfigService } from '@nestjs/config';
import { GatewayAccount } from '@prisma/client';
import EfiPay from 'sdk-node-apis-efi';
import { EfiIssuanceContext, EfiService } from './efi.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { PaymentNotificationsService } from './payment-notifications.service';
import { PaymentChargeService } from './payment-charge.service';
import { PrismaService } from '../prisma/prisma.service';

interface SplitBuilder {
  buildBoletoMarketplaceRepasses(
    account: GatewayAccount,
    issuance: EfiIssuanceContext,
  ): unknown;
  createPixSplitConfig(
    client: EfiPay,
    account: GatewayAccount,
    txid: string,
    issuance: EfiIssuanceContext,
  ): Promise<string>;
}

describe('Split fee routing', () => {
  const fixed: EfiIssuanceContext = {
    chargeId: 'charge',
    platformFeeKind: 'FIXED',
    platformFeeAmountCents: 250,
    platformFeeBasisPoints: 0,
    grossAmountCents: 10000,
  };
  const percent: EfiIssuanceContext = {
    ...fixed,
    platformFeeKind: 'PERCENTAGE',
    platformFeeAmountCents: 0,
    platformFeeBasisPoints: 250,
  };
  const account = {
    payeeCode: 'tenant',
    efiAccountNumber: 'tenant-account',
  } as GatewayAccount;
  function service(values: Record<string, string>): SplitBuilder {
    return new EfiService(
      {
        get: (key: string): string | undefined => values[key],
      } as unknown as ConfigService,
      {} as PrismaService,
      {} as PaymentCryptoService,
      {} as PaymentNotificationsService,
      null,
      {} as PaymentChargeService,
    ) as unknown as SplitBuilder;
  }
  it.each([fixed, percent])(
    'blocks boleto split without a distinct platform payee',
    (context) => {
      expect(() =>
        service({}).buildBoletoMarketplaceRepasses(account, context),
      ).toThrow();
      expect(() =>
        service({
          EFI_PLATFORM_PAYEE_CODE: 'tenant',
        }).buildBoletoMarketplaceRepasses(account, context),
      ).toThrow();
    },
  );
  it.each([fixed, percent])(
    'blocks Pix split to the emitter account',
    async (context) => {
      const client = {
        pixSplitConfigId: jest.fn().mockResolvedValue({ id: 'split' }),
      };
      await expect(
        service({
          EFI_PLATFORM_ACCOUNT_NUMBER: 'tenant-account',
          EFI_PLATFORM_CNPJ: '12345678000195',
        }).createPixSplitConfig(
          client as unknown as EfiPay,
          account,
          'txid',
          context,
        ),
      ).rejects.toThrow();
      expect(client.pixSplitConfigId).not.toHaveBeenCalled();
    },
  );
  it.each([
    [fixed, 'fixo', '97.50', '2.50'],
    [percent, 'porcentagem', '97.50', '2.50'],
  ] as const)(
    'allocates the integral platform fee and all Efí fees to emitter',
    async (context, kind, emitter, platform) => {
      const client = {
        pixSplitConfigId: jest.fn().mockResolvedValue({ id: 'split' }),
      };
      await service({
        EFI_PLATFORM_ACCOUNT_NUMBER: 'platform',
        EFI_PLATFORM_CNPJ: '12345678000195',
      }).createPixSplitConfig(
        client as unknown as EfiPay,
        account,
        'txid',
        context,
      );
      expect(client.pixSplitConfigId).toHaveBeenCalledWith(
        { id: 'charge' },
        expect.objectContaining({
          split: {
            divisaoTarifa: 'assumir_total',
            minhaParte: { tipo: kind, valor: emitter },
            repasses: [
              {
                tipo: kind,
                valor: platform,
                favorecido: { conta: 'platform', cnpj: '12345678000195' },
              },
            ],
          },
        }),
      );
    },
  );
});
