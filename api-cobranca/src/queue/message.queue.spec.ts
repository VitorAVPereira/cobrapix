import type { Queue } from 'bullmq';
import { MessageQueueService, WhatsAppQueueJob } from './message.queue';

describe('MessageQueueService', () => {
  it('gera jobIds compativeis com BullMQ para cobrancas selecionadas', async () => {
    const addBulk = jest.fn().mockResolvedValue([]);
    const service = new MessageQueueService({
      addBulk,
    } as unknown as Queue<WhatsAppQueueJob>);

    await service.addSelectedInitialChargeJobs([
      {
        companyId: 'daa59350-bb2a-4129-90c1-99cbc697aa17',
        invoiceId: '3fa1ba83-a530-4529-8154-4dcbfd06cd80',
        source: 'SELECTED',
      },
    ]);

    const jobs = addBulk.mock.calls[0]?.[0] as
      | Array<{ opts: { jobId: string } }>
      | undefined;

    expect(jobs?.[0]?.opts.jobId).toBeDefined();
    expect(jobs?.[0]?.opts.jobId).not.toContain(':');
  });
});
