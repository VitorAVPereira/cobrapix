import {
  ACCOUNT_MODES,
  ACTIVATION_ORIGINS,
  FinancialIssuanceMethod,
  PAYOUT_MODES,
  resolveChargeDistribution,
  validateFinancialModeSelection,
} from './financial-activation.types';

describe('validateFinancialModeSelection', () => {
  it.each([
    {
      origin: 'MANUAL_ADMIN',
      accountMode: 'CUSTOMER_ACCOUNT',
      payoutMode: 'DIRECT_TO_CUSTOMER',
    },
    {
      origin: 'MANUAL_ADMIN',
      accountMode: 'PLATFORM_ACCOUNT',
      payoutMode: 'EFI_SPLIT',
    },
    {
      origin: 'MANUAL_ADMIN',
      accountMode: 'PLATFORM_ACCOUNT',
      payoutMode: 'MANUAL',
    },
    {
      origin: 'AUTOMATIC_OPENING',
      accountMode: 'CUSTOMER_ACCOUNT',
      payoutMode: 'DIRECT_TO_CUSTOMER',
    },
  ])(
    'accepts $origin + $accountMode + $payoutMode',
    (selection: Record<string, string>) => {
      expect(validateFinancialModeSelection(selection)).toEqual({
        valid: true,
        selection,
      });
    },
  );

  it('accepts exactly four of the eighteen combinations', () => {
    const accepted = ACTIVATION_ORIGINS.flatMap((origin) =>
      ACCOUNT_MODES.flatMap((accountMode) =>
        PAYOUT_MODES.map((payoutMode) => ({ origin, accountMode, payoutMode })),
      ),
    ).filter((selection) => validateFinancialModeSelection(selection).valid);

    expect(accepted).toHaveLength(4);
  });

  it.each([
    ['CUSTOMER_ACCOUNT', 'EFI_SPLIT'],
    ['CUSTOMER_ACCOUNT', 'MANUAL'],
    ['PLATFORM_ACCOUNT', 'DIRECT_TO_CUSTOMER'],
  ])('rejects %s with payout %s', (accountMode: string, payoutMode: string) => {
    expect(
      validateFinancialModeSelection({
        origin: 'MANUAL_ADMIN',
        accountMode,
        payoutMode,
      }),
    ).toEqual({ valid: false, reason: 'PAYOUT_MODE_INCOMPATIBLE' });
  });

  it.each(['EFI_SPLIT', 'MANUAL'])(
    'rejects automatic opening with the platform account (%s)',
    (payoutMode: string) => {
      expect(
        validateFinancialModeSelection({
          origin: 'AUTOMATIC_OPENING',
          accountMode: 'PLATFORM_ACCOUNT',
          payoutMode,
        }),
      ).toEqual({
        valid: false,
        reason: 'OPENING_REQUIRES_CUSTOMER_ACCOUNT',
      });
    },
  );

  it.each([
    null,
    'MANUAL_ADMIN',
    [],
    {},
    { origin: 'MANUAL_ADMIN', accountMode: 'CUSTOMER_ACCOUNT' },
    {
      origin: 'manual_admin',
      accountMode: 'CUSTOMER_ACCOUNT',
      payoutMode: 'DIRECT_TO_CUSTOMER',
    },
    {
      origin: 'MANUAL_ADMIN',
      accountMode: 'CUSTOMER_ACCOUNT',
      payoutMode: 'DIRECT_TO_CUSTOMER',
      companyId: 'other-company',
    },
  ])('rejects a malformed selection: %#', (selection: unknown) => {
    expect(validateFinancialModeSelection(selection)).toEqual({
      valid: false,
      reason: 'MALFORMED',
    });
  });
});

describe('resolveChargeDistribution', () => {
  const methods: FinancialIssuanceMethod[] = ['PIX', 'BOLIX'];
  const mechanism = (method: FinancialIssuanceMethod) =>
    method === 'PIX' ? 'PIX_SPLIT_CONFIG' : 'CHARGES_MARKETPLACE';

  it.each(methods)(
    'customer account splits the CifraMais fee to the platform (%s)',
    (method: FinancialIssuanceMethod) => {
      expect(
        resolveChargeDistribution({
          accountMode: 'CUSTOMER_ACCOUNT',
          payoutMode: 'DIRECT_TO_CUSTOMER',
          method,
          platformFeeCharged: true,
        }),
      ).toEqual({
        issuer: 'COMPANY',
        distribution: 'PLATFORM_FEE_SPLIT',
        splitMechanism: mechanism(method),
        payoutConfirmation: 'NOT_APPLICABLE',
      });
    },
  );

  it.each(methods)(
    'customer account without a CifraMais fee needs no split (%s)',
    (method: FinancialIssuanceMethod) => {
      expect(
        resolveChargeDistribution({
          accountMode: 'CUSTOMER_ACCOUNT',
          payoutMode: 'DIRECT_TO_CUSTOMER',
          method,
          platformFeeCharged: false,
        }),
      ).toMatchObject({ issuer: 'COMPANY', distribution: 'NONE' });
    },
  );

  it.each(
    methods.flatMap((method) => [
      [method, true],
      [method, false],
    ]) as Array<[FinancialIssuanceMethod, boolean]>,
  )(
    'platform split always sends the customer share (%s, fee charged: %s)',
    (method: FinancialIssuanceMethod, platformFeeCharged: boolean) => {
      expect(
        resolveChargeDistribution({
          accountMode: 'PLATFORM_ACCOUNT',
          payoutMode: 'EFI_SPLIT',
          method,
          platformFeeCharged,
        }),
      ).toEqual({
        issuer: 'PLATFORM',
        distribution: 'CUSTOMER_SHARE_SPLIT',
        splitMechanism: mechanism(method),
        payoutConfirmation: 'SPLIT_EVIDENCE',
      });
    },
  );

  it.each(methods)(
    'platform manual payout attaches no split (%s)',
    (method: FinancialIssuanceMethod) => {
      expect(
        resolveChargeDistribution({
          accountMode: 'PLATFORM_ACCOUNT',
          payoutMode: 'MANUAL',
          method,
          platformFeeCharged: true,
        }),
      ).toEqual({
        issuer: 'PLATFORM',
        distribution: 'NONE',
        splitMechanism: null,
        payoutConfirmation: 'MANUAL_BATCH',
      });
    },
  );

  it.each([
    ['CUSTOMER_ACCOUNT', 'EFI_SPLIT'],
    ['CUSTOMER_ACCOUNT', 'MANUAL'],
    ['PLATFORM_ACCOUNT', 'DIRECT_TO_CUSTOMER'],
  ] as const)(
    'refuses the invalid combination %s + %s',
    (accountMode, payoutMode) => {
      expect(() =>
        resolveChargeDistribution({
          accountMode,
          payoutMode,
          method: 'PIX',
          platformFeeCharged: true,
        }),
      ).toThrow('FINANCIAL_MODE_INVALID');
    },
  );
});
