import {
  collectionMoment,
  isInitialChargeKey,
  purposeForScheduleDay,
  ruleStepSelection,
} from './template-selection';

const step = {
  whatsappSelectionMode: 'DEFAULT' as const,
  whatsappPurpose: 'EMISSION' as const,
  templateId: null,
  pixTemplateId: null,
  boletoTemplateId: null,
  bolixTemplateId: 'template-bolix',
};

describe('ruleStepSelection by billing method', () => {
  it('uses the explicit card template while preserving Pix/Bolix choices', () => {
    expect(
      ruleStepSelection(
        { ...step, cardTemplateId: 'card-template' },
        'CREDIT_CARD',
      ),
    ).toEqual({ mode: 'EXPLICIT', templateId: 'card-template' });
    expect(
      ruleStepSelection({ ...step, cardTemplateId: 'card-template' }, 'BOLIX'),
    ).toEqual({ mode: 'EXPLICIT', templateId: 'template-bolix' });
  });
  it('uses the template of the charge method, else the step choice', () => {
    expect(ruleStepSelection(step, 'BOLIX')).toEqual({
      mode: 'EXPLICIT',
      templateId: 'template-bolix',
    });
    expect(ruleStepSelection(step, 'PIX')).toEqual({
      mode: 'DEFAULT',
      purpose: 'EMISSION',
    });
    // Without a known method (older holds), the step choice applies.
    expect(ruleStepSelection(step)).toEqual({
      mode: 'DEFAULT',
      purpose: 'EMISSION',
    });
    // A method template does not make an unconfigured step usable for other methods.
    expect(
      ruleStepSelection(
        { ...step, whatsappSelectionMode: 'UNCONFIGURED' as const },
        'BOLETO',
      ),
    ).toEqual({ mode: 'UNCONFIGURED' });
  });
});

describe('first message keys', () => {
  it('recognizes automatic and selected first messages only', () => {
    expect(isInitialChargeKey('collection:c1:i1:initial:WHATSAPP')).toBe(true);
    expect(isInitialChargeKey('collection:c1:i1:selected-170:WHATSAPP')).toBe(
      true,
    );
    expect(isInitialChargeKey('collection:c1:i1:step-uuid:WHATSAPP')).toBe(
      false,
    );
    expect(isInitialChargeKey('admin-reply:1')).toBe(false);
    expect(isInitialChargeKey(null)).toBe(false);
  });

  it('the emission day is the purpose of the Inicial step', () => {
    expect(purposeForScheduleDay(-30)).toBe('EMISSION');
    expect(purposeForScheduleDay(-29)).toBe('BEFORE_DUE');
  });
});

describe('collectionMoment', () => {
  const moment = (
    daysFromDue: number,
    recurring = false,
    overdueReceived = false,
  ) => collectionMoment({ daysFromDue, recurring, overdueReceived });

  it('follows the day the message is sent and the kind of invoice', () => {
    expect(moment(-3)).toBe('BEFORE_DUE');
    expect(moment(0)).toBe('DUE_TODAY');
    expect(moment(0, true)).toBe('DUE_TODAY');
    expect(moment(1)).toBe('FIRST_OVERDUE');
    expect(moment(40)).toBe('FIRST_OVERDUE');
    expect(moment(2, false, true)).toBe('CRITICAL_OVERDUE');
    expect(moment(1, true)).toBe('RECURRING_OVERDUE');
    expect(moment(1, true, true)).toBe('RECURRING_OVERDUE');
  });
});
