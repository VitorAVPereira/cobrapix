import { ConfigService } from '@nestjs/config';
import { TemplateCatalogSyncService } from './template-catalog-sync.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WhatsappTransport } from '../whatsapp/transport/whatsapp-transport';
import { WhatsappTransportError } from '../whatsapp/transport/whatsapp-transport.error';

function setup(leaseCount: number) {
  const prisma = {
    whatsappTemplateSyncState: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: leaseCount }),
      findUnique: jest.fn(),
    },
  };
  const transport = {
    kind: 'DATAFY',
    getChannelInfo: jest
      .fn()
      .mockResolvedValue({ phoneNumberId: '1', businessAccountId: '999' }),
    listTemplates: jest.fn(),
  };
  const service = new TemplateCatalogSyncService(
    prisma as unknown as PrismaService,
    new ConfigService({}),
    transport as unknown as WhatsappTransport,
  );
  return { service, prisma, transport };
}

describe('TemplateCatalogSyncService', () => {
  it('answers 409 without querying the provider when another scan holds the lease', async () => {
    const { service, transport } = setup(0);
    await expect(service.sync('MANUAL')).rejects.toMatchObject({
      status: 409,
    });
    expect(transport.listTemplates).not.toHaveBeenCalled();
  });

  it('validates the configured WABA through /me before importing anything', async () => {
    const { service, transport, prisma } = setup(1);
    transport.getChannelInfo.mockRejectedValue(
      new WhatsappTransportError('config', 'CONFIGURATION', 'NOT_SENT'),
    );
    await expect(service.sync('MANUAL')).rejects.toBeInstanceOf(
      WhatsappTransportError,
    );
    expect(transport.listTemplates).not.toHaveBeenCalled();
    expect(prisma.whatsappTemplateSyncState.updateMany).not.toHaveBeenCalled();
  });

  it('periodic timers stay idle without Datafy configuration', async () => {
    const { service, transport } = setup(1);
    await service.periodic();
    await service.requested();
    expect(transport.getChannelInfo).not.toHaveBeenCalled();
  });
});
