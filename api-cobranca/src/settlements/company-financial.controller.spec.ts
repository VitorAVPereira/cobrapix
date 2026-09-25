import { CompanyFinancialController } from './company-financial.controller';
import { SettlementsService } from './settlements.service';

describe('CompanyFinancialController', () => {
  it('reads receipts of the session company only, with bounded pages', async () => {
    const companyOverview = jest.fn().mockResolvedValue({});
    const controller = new CompanyFinancialController({
      companyOverview,
    } as unknown as SettlementsService);
    await controller.receipts({ companyId: 'company-1' } as never, '-3', '500');
    expect(companyOverview).toHaveBeenCalledWith('company-1', 1, 100);
  });
});
