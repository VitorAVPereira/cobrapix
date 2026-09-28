import { Prisma } from '@prisma/client';
import {
  applyTemplateEvent,
  templateBody,
  templateEventUpdate,
} from './template-provider-state';

const local = { metaStatus: 'APPROVED', metaProviderCategory: 'UTILITY' };

function tx(templates: Array<{ id: string }>) {
  const client = {
    globalMessageTemplate: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          templates.map((template) => ({ ...local, ...template })),
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    whatsappTemplateAudit: { create: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  return client;
}

describe('Imported template provider state', () => {
  it('keeps the legacy positional body conversion', () => {
    expect(templateBody('Ola {{nome_devedor}}, valor {{valor}}.')).toBe(
      'Ola {{1}}, valor {{2}}.',
    );
  });

  it('does not enable reclassified or changed templates on APPROVED event', () => {
    expect(
      templateEventUpdate(local, 'template_category_update', {
        new_category: 'MARKETING',
      }),
    ).toMatchObject({
      data: {
        metaProviderCategory: 'MARKETING',
        metaReviewRequired: true,
        policyVersion: { increment: 1 },
      },
      reread: true,
    });
    expect(
      templateEventUpdate(local, 'message_template_components_update', {
        message_template_element: 'Novo {{1}}',
      }),
    ).toMatchObject({ data: { metaReviewRequired: true }, reread: true });
    const approved = templateEventUpdate(
      { ...local, metaStatus: 'PAUSED' },
      'message_template_status_update',
      { event: 'APPROVED' },
    );
    expect(approved.data).not.toHaveProperty('metaReviewRequired');
    expect(approved.data).toMatchObject({
      metaStatus: 'APPROVED',
      policyVersion: { increment: 1 },
    });
  });

  it('records quality without touching eligibility and blocks paused templates', () => {
    const quality = templateEventUpdate(
      local,
      'message_template_quality_update',
      { new_quality_score: 'RED' },
    );
    expect(quality).toEqual({ data: { metaQuality: 'RED' }, reread: false });
    for (const status of ['PAUSED', 'REJECTED', 'DISABLED'])
      expect(
        templateEventUpdate(local, 'message_template_status_update', {
          event: status,
        }).data,
      ).toMatchObject({ metaStatus: status, policyVersion: { increment: 1 } });
  });

  it('resolves only inside the verified WABA, by provider ID first', async () => {
    const client = tx([{ id: 'local-1' }]);
    await applyTemplateEvent(
      client as unknown as Prisma.TransactionClient,
      'message_template_status_update',
      {
        event: 'REJECTED',
        message_template_id: 12345,
        message_template_name: 'cobranca',
        message_template_language: 'pt_BR',
      },
      new Date(),
      '999',
    );
    expect(client.globalMessageTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          origin: 'META_IMPORTED',
          providerAccountId: '999',
          metaTemplateId: '12345',
        },
      }),
    );
    expect(client.$executeRaw).not.toHaveBeenCalled();
  });

  it('unknown_event_requests_sync without creating a sendable template', async () => {
    const client = tx([]);
    const review = await applyTemplateEvent(
      client as unknown as Prisma.TransactionClient,
      'message_template_status_update',
      {
        event: 'APPROVED',
        message_template_name: 'novo',
        message_template_language: 'pt_BR',
      },
      new Date(),
      '999',
    );
    expect(review).toBe(false);
    expect(client.$executeRaw).toHaveBeenCalledTimes(1);
    expect(client.globalMessageTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('never matches by name alone or without a verified account', async () => {
    const client = tx([{ id: 'local-1' }]);
    await applyTemplateEvent(
      client as unknown as Prisma.TransactionClient,
      'message_template_status_update',
      { event: 'APPROVED', message_template_name: 'novo' },
      new Date(),
      '999',
    );
    expect(client.globalMessageTemplate.findMany).not.toHaveBeenCalled();
    expect(client.$executeRaw).toHaveBeenCalled();
    expect(
      await applyTemplateEvent(
        client as unknown as Prisma.TransactionClient,
        'message_template_status_update',
        { event: 'APPROVED', message_template_id: '1' },
        new Date(),
      ),
    ).toBe(true);
  });
});
