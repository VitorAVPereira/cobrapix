import { assertRecipientNotSuppressed } from './recipient-suppression';
import { PrismaService } from '../prisma/prisma.service';

describe('Supressao do destinatario no numero compartilhado', () => {
  it('bloqueia todas as empresas sem consultar/inferir empresa pelo telefone', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'blocked' });
    const prisma = {
      communicationRecipientSuppression: { findUnique },
    } as unknown as PrismaService;
    await expect(
      assertRecipientNotSuppressed(prisma, '+55 (11) 99999-9999'),
    ).rejects.toThrow('Destinatario pausado');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channel_recipientHash: {
            channel: 'WHATSAPP',
            recipientHash: expect.any(String) as unknown,
          },
        },
      }),
    );
    expect(JSON.stringify(findUnique.mock.calls)).not.toContain(
      '5511999999999',
    );
  });
  it('permite contato nao bloqueado e recusa identificador opaco como telefone', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      communicationRecipientSuppression: { findUnique },
    } as unknown as PrismaService;
    await expect(
      assertRecipientNotSuppressed(prisma, '5511999999999'),
    ).resolves.toBeUndefined();
    await expect(
      assertRecipientNotSuppressed(prisma, 'BR.5511999999999'),
    ).rejects.toThrow();
  });
});
