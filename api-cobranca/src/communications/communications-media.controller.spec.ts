import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { CommunicationMediaService } from './communication-media.service';
import { CommunicationsMediaController } from './communications-media.controller';

const user = {
  userId: 'user-a',
  email: 'a@example.test',
  companyId: 'company-a',
  role: 'COMPANY_ADMIN',
  mustChangePassword: false,
  tokenVersion: 1,
} as AuthenticatedUser;

interface FakeResponse {
  status: jest.Mock<FakeResponse, [number]>;
  set: jest.Mock<FakeResponse, [Record<string, string>]>;
  end: jest.Mock<FakeResponse, [Buffer]>;
}

function response(): FakeResponse {
  const res = {} as FakeResponse;
  res.status = jest.fn<FakeResponse, [number]>(() => res);
  res.set = jest.fn<FakeResponse, [Record<string, string>]>(() => res);
  res.end = jest.fn<FakeResponse, [Buffer]>(() => res);
  return res;
}

describe('CommunicationsMediaController', () => {
  it('requires authentication', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CommunicationsMediaController),
    ).toContain(JwtAuthGuard);
  });

  it.each([
    ['image/png', 'inline'],
    ['application/pdf', 'attachment'],
  ] as const)(
    'serves %s with private, non-sniffable, sandboxed headers',
    async (contentType, disposition) => {
      const media = {
        openForViewer: jest.fn().mockResolvedValue({
          bytes: Buffer.from('bytes'),
          contentType,
          fileName: 'anexo-12345678.bin',
          disposition,
        }),
      };
      const res = response();
      await new CommunicationsMediaController(
        media as unknown as CommunicationMediaService,
      ).download(user, 'message-1', 'attachment-1', res as unknown as Response);
      expect(media.openForViewer).toHaveBeenCalledWith(
        { companyId: 'company-a', role: 'COMPANY_ADMIN' },
        'message-1',
        'attachment-1',
      );
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': contentType,
          'Content-Disposition': `${disposition}; filename="anexo-12345678.bin"`,
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        }),
      );
      expect(res.end).toHaveBeenCalledWith(Buffer.from('bytes'));
    },
  );

  it('writes nothing when access is denied', async () => {
    const media = {
      openForViewer: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('404'), { status: 404 })),
    };
    const res = response();
    await expect(
      new CommunicationsMediaController(
        media as unknown as CommunicationMediaService,
      ).download(user, 'message-1', 'attachment-1', res as unknown as Response),
    ).rejects.toThrow();
    expect(res.set).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });
});
