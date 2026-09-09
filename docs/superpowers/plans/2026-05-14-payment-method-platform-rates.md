# Payment Method Platform Rates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each client's on-time and recovered platform percentage rates when payment methods are selected in the frontend.

**Architecture:** Keep the backend and Prisma `Bps` fields unchanged. Add a focused frontend formatter and replace UI reads of fixed combined tariff labels with labels derived from the current `BillingSettings` response.

**Tech Stack:** Next.js App Router, React, TypeScript, Jest.

---

### Task 1: Frontend Rate Formatting

**Files:**
- Create: `front-cobranca/src/lib/billing-fees.ts`
- Create: `front-cobranca/src/lib/__tests__/billing-fees.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import {
  formatBillingMethodRateLabel,
  formatPlatformRateSummary,
  formatPercentageBps,
} from '../billing-fees';
import type { BillingSettings } from '../api-client';

const settings = {
  onTimeSplitPercentageBps: 150,
  overdueSplitPercentageBps: 1200,
  tariffs: {
    PIX: { combinedLabel: '1,19% + R$ 0,50' },
  },
} as BillingSettings;

describe('billing fee formatting', () => {
  it('formats basis points as a pt-BR percentage', () => {
    expect(formatPercentageBps(150)).toBe('1,50%');
  });

  it('builds the platform rate summary from client percentages', () => {
    expect(formatPlatformRateSummary(settings)).toBe(
      'No prazo: 1,50% | Recuperada: 12,00%',
    );
  });

  it('does not use the fixed combined tariff label for payment method options', () => {
    expect(formatBillingMethodRateLabel('PIX', settings)).toBe(
      'Pix - No prazo: 1,50% | Recuperada: 12,00%',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front-cobranca && npx jest src/lib/__tests__/billing-fees.test.ts`

Expected: FAIL because `../billing-fees` does not exist.

- [ ] **Step 3: Implement formatter**

```typescript
import type { BillingMethod, BillingSettings } from './api-client';

export function getBillingMethodLabel(method: BillingMethod): string {
  if (method === 'BOLETO') return 'Boleto';
  if (method === 'BOLIX') return 'Bolix';
  return 'Pix';
}

export function formatPercentageBps(value: number): string {
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100)}%`;
}

export function formatPlatformRateSummary(
  settings: Pick<
    BillingSettings,
    'onTimeSplitPercentageBps' | 'overdueSplitPercentageBps'
  >,
): string {
  return `No prazo: ${formatPercentageBps(settings.onTimeSplitPercentageBps)} | Recuperada: ${formatPercentageBps(settings.overdueSplitPercentageBps)}`;
}

export function formatBillingMethodRateLabel(
  method: BillingMethod,
  settings: BillingSettings | null,
): string {
  const label = getBillingMethodLabel(method);
  return settings ? `${label} - ${formatPlatformRateSummary(settings)}` : label;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front-cobranca && npx jest src/lib/__tests__/billing-fees.test.ts`

Expected: PASS.

### Task 2: Payment Method UI

**Files:**
- Modify: `front-cobranca/src/app/(dashboard)/configuracoes/cobranca/page.tsx`
- Modify: `front-cobranca/src/app/(dashboard)/cobrancas/page.tsx`
- Modify: `front-cobranca/src/app/(dashboard)/devedores-recorrentes/page.tsx`

- [ ] **Step 1: Replace local/fixed labels**

Import formatter helpers from `@/lib/billing-fees`. In method cards and selects, replace `tariff.combinedLabel`, `tariff.platformLabel`, and `estimateFee` display usage with `formatPlatformRateSummary(settings)` or `formatBillingMethodRateLabel(method, settings)`.

- [ ] **Step 2: Run focused tests**

Run: `cd front-cobranca && npx jest src/lib/__tests__/billing-fees.test.ts`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `cd front-cobranca && npm run lint`

Expected: PASS or only pre-existing unrelated lint output.
