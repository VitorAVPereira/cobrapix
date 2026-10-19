import { CompanyFinancialController } from './company-financial.controller';
import { SettlementsService } from './settlements.service';

describe('CompanyFinancialController', () => {
  it('reads receipts of the session company only, with the validated filters', async () => {
    const companyOverview = jest.fn().mockResolvedValue({});
    const controller = new CompanyFinancialController({
      companyOverview,
    } as unknown as SettlementsService);
    const query = { page: 2, pageSize: 50, period: 'month' as const };

    await controller.receipts({ companyId: 'company-1' } as never, query);

    expect(companyOverview).toHaveBeenCalledWith('company-1', query);
  });
});
