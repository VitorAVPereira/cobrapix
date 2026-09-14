import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { AdminBillingDto } from '../admin/dto/admin-client.dto';
import { UpdateBillingSettingsDto } from '../billing/dto/update-billing-settings.dto';
import {
  CreateDebtorInvoiceDto,
  CreateInvoiceDto,
  UpdateDebtorSettingsDto,
  UpdateRecurringInvoiceDto,
} from '../invoices/dto/invoice.dto';

describe('Traditional boleto is historical only', () => {
  it.each([
    [AdminBillingDto, 'preferredBillingMethod'],
    [UpdateBillingSettingsDto, 'preferredBillingMethod'],
    [CreateInvoiceDto, 'billing_type'],
    [CreateDebtorInvoiceDto, 'billing_type'],
    [UpdateRecurringInvoiceDto, 'billingType'],
    [UpdateDebtorSettingsDto, 'preferredBillingMethod'],
  ])('%s rejects BOLETO on %s', (Dto, property) => {
    const input = Object.assign(new Dto(), { [property]: 'BOLETO' });
    expect(
      validateSync(input).filter((error) => error.property === property),
    ).not.toEqual([]);
  });

  it('rejects enabling traditional BOLETO', () => {
    const input = Object.assign(new AdminBillingDto(), {
      preferredBillingMethod: 'BOLETO',
      enabledBillingMethods: ['PIX', 'BOLETO', 'BOLIX'],
    });
    expect(validateSync(input)).not.toEqual([]);
  });
});
