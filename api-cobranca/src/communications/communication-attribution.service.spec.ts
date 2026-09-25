import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { interactiveTokenHash } from './communication-token.service';
import { resolveInboundAttribution } from './reply-attribution';

const phone = '5511999999999';
const recipientHash = createHash('sha256').update(phone).digest('hex');
const token = `cfm1.${'a'.repeat(43)}`;
const base = {
  conversationId: 'conversation-p',
  recipientHash,
  recipientType: 'PHONE' as const,
  channelId: '222',
  replyToExternalMessageId: null as string | null,
  interactiveToken: null as string | null,
};
const outboundA = {
  conversationId: 'conversation-p',
  transportChannelId: '222',
  companyId: 'company-a',
  invoiceId: 'invoice-a',
  debtorId: 'debtor-a',
  anonymizedAt: null,
  retentionExpiresAt: new Date(Date.now() + 86_400_000),
  direction: 'OUTBOUND',
};

function tx(cited: Record<string, unknown> | null, reference?: unknown) {
  return {
    communicationMessage: { findUnique: jest.fn().mockResolvedValue(cited) },
    communicationInteractiveReference: {
      findUnique: jest.fn().mockResolvedValue(reference ?? null),
    },
    company: { findUnique: jest.fn().mockResolvedValue({ id: 'company-a' }) },
    invoice: {
      findFirst: jest.fn().mockResolvedValue({ debtorId: 'debtor-a' }),
    },
    debtor: {
      findFirst: jest.fn().mockResolvedValue({ phoneNumber: `+${phone}` }),
    },
  };
}
const run = (client: ReturnType<typeof tx>, reference = {}) =>
  resolveInboundAttribution(client as unknown as Prisma.TransactionClient, {
    ...base,
    ...reference,
  });

describe('Inbound attribution by persisted references', () => {
  it('inherits the revalidated context of the quoted message', async () => {
    await expect(
      run(tx(outboundA), { replyToExternalMessageId: 'wamid.a' }),
    ).resolves.toEqual({
      method: 'REPLY_CONTEXT',
      context: {
        companyId: 'company-a',
        invoiceId: 'invoice-a',
        debtorId: 'debtor-a',
      },
    });
  });

  it.each([
    ['absent reference', null, {}],
    ['unknown message', null, { replyToExternalMessageId: 'wamid.x' }],
    [
      'another contact',
      { ...outboundA, conversationId: 'conversation-q' },
      { replyToExternalMessageId: 'wamid.a' },
    ],
    [
      'another channel',
      { ...outboundA, transportChannelId: '999' },
      { replyToExternalMessageId: 'wamid.a' },
    ],
    [
      'legacy message without proven channel',
      { ...outboundA, transportChannelId: null },
      { replyToExternalMessageId: 'wamid.a' },
    ],
    [
      'unassigned message',
      { ...outboundA, companyId: null, invoiceId: null, debtorId: null },
      { replyToExternalMessageId: 'wamid.a' },
    ],
    [
      'anonymized message',
      { ...outboundA, anonymizedAt: new Date() },
      { replyToExternalMessageId: 'wamid.a' },
    ],
  ])('leaves %s unassigned', async (_case, cited, reference) => {
    await expect(run(tx(cited), reference)).resolves.toEqual({
      method: 'UNASSIGNED',
      context: { companyId: null, invoiceId: null, debtorId: null },
    });
  });

  it('does not attribute when the debtor phone no longer matches the contact', async () => {
    const client = tx(outboundA);
    client.debtor.findFirst.mockResolvedValue({
      phoneNumber: '+5511888888888',
    });
    await expect(
      run(client, { replyToExternalMessageId: 'wamid.a' }),
    ).resolves.toMatchObject({ method: 'UNASSIGNED' });
  });

  it('resolves a server-issued button reference before the quote', async () => {
    const client = tx(
      { ...outboundA, companyId: null },
      { message: { ...outboundA } },
    );
    await expect(
      run(client, {
        interactiveToken: token,
        replyToExternalMessageId: 'wamid.a',
      }),
    ).resolves.toMatchObject({
      method: 'INTERACTIVE_CONTEXT',
      context: { companyId: 'company-a' },
    });
    expect(
      client.communicationInteractiveReference.findUnique,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: interactiveTokenHash(token) },
      }),
    );
  });

  it('ignores malformed payloads and references issued for another contact', async () => {
    const malformed = tx(null);
    await expect(
      run(malformed, { interactiveToken: 'company-b' }),
    ).resolves.toMatchObject({ method: 'UNASSIGNED' });
    expect(
      malformed.communicationInteractiveReference.findUnique,
    ).not.toHaveBeenCalled();
    const foreign = tx(null, {
      message: { ...outboundA, conversationId: 'conversation-q' },
    });
    await expect(
      run(foreign, { interactiveToken: token }),
    ).resolves.toMatchObject({ method: 'UNASSIGNED' });
  });
});
