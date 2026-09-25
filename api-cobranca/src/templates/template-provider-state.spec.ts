import {
  templateBody,
  templateCompatibility,
  templateEventUpdate,
} from './template-provider-state';
import { GlobalMessageTemplate } from '@prisma/client';

const local = {
  content: 'Ola {{nome_devedor}}, valor {{valor}}.',
  category: 'UTILITY',
  footerText: null,
  paymentButtonEnabled: false,
  copyCodeButtonEnabled: false,
  metaReviewRequired: false,
} as GlobalMessageTemplate;
describe('Global template provider state', () => {
  it('preserves positional parameters and rejects changed meaning or parameter order', () => {
    expect(templateBody(local.content)).toBe('Ola {{1}}, valor {{2}}.');
    expect(
      templateCompatibility(local, [
        { type: 'BODY', text: 'Ola {{1}}, valor {{2}}.' },
      ]),
    ).toBe(true);
    expect(
      templateCompatibility(local, [
        { type: 'BODY', text: 'Ola {{2}}, valor {{1}}.' },
      ]),
    ).toBe(false);
    expect(
      templateCompatibility(local, [
        { type: 'BODY', text: 'Oferta {{1}}, valor {{2}}.' },
      ]),
    ).toBe(false);
  });
  it('does not enable reclassified or changed templates on APPROVED event', () => {
    expect(
      templateEventUpdate(local, 'template_category_update', {
        new_category: 'MARKETING',
      }),
    ).toMatchObject({
      metaProviderCategory: 'MARKETING',
      metaReviewRequired: true,
    });
    expect(
      templateEventUpdate(local, 'message_template_components_update', {
        message_template_element: 'Novo {{1}}',
      }),
    ).toMatchObject({ metaReviewRequired: true });
    expect(
      templateEventUpdate(
        { ...local, metaReviewRequired: true },
        'message_template_status_update',
        { event: 'APPROVED' },
      ),
    ).not.toHaveProperty('metaReviewRequired', false);
  });
  it('records quality and blocks paused, rejected and disabled templates', () => {
    expect(
      templateEventUpdate(local, 'message_template_quality_update', {
        new_quality_score: 'RED',
      }),
    ).toMatchObject({ metaQuality: 'RED' });
    for (const status of ['PAUSED', 'REJECTED', 'DISABLED'])
      expect(
        templateEventUpdate(local, 'message_template_status_update', {
          event: status,
        }),
      ).toMatchObject({ metaStatus: status });
  });
});
