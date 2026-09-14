import type { EfiService } from '../payment/efi.service';
import type { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { PaymentFeeService } from '../payment-fees/payment-fee.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WhatsappService } from '../whatsapp/whatsapp.service';
import { AdminService } from './admin.service';

describe('AdminService payment method policy', () => {
  function fixture(): {
    service: AdminService;
    resolveActiveVersion: jest.Mock;
    companyUpdate: jest.Mock;
  } {
    const companyUpdate = jest.fn();
    const resolveActiveVersion = jest.fn();
    return {
      service: new AdminService(
        { company: { update: companyUpdate } } as unknown as PrismaService,
        {} as WhatsappService,
        {} as EfiService,
        {} as PaymentCryptoService,
        { resolveActiveVersion } as unknown as PaymentFeeService,
      ),
      resolveActiveVersion,
      companyUpdate,
    };
  }

  it('rejects enabling a method without an active tenant/global fee', async () => {
    const { service, resolveActiveVersion, companyUpdate } = fixture();
    resolveActiveVersion.mockRejectedValue(
      new Error('FEE_CONFIGURATION_MISSING'),
    );
    await expect(
      service.updateClient('company-1', {
        billing: { enabledBillingMethods: ['PIX'] },
      }),
    ).rejects.toThrow('FEE_CONFIGURATION_MISSING');
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it('rejects enabling traditional boleto before looking up fees', async () => {
    const { service, resolveActiveVersion, companyUpdate } = fixture();
    resolveActiveVersion.mockRejectedValue(
      new Error('FEE_CONFIGURATION_MISSING'),
    );
    await expect(
      service.updateClient('company-1', {
        billing: { enabledBillingMethods: ['BOLETO' as 'BOLIX'] },
      }),
    ).rejects.toThrow('Novas cobranças devem usar Pix ou Bolix.');
    expect(resolveActiveVersion).not.toHaveBeenCalled();
    expect(companyUpdate).not.toHaveBeenCalled();
  });
});
