import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EfiMtlsGuard } from './efi-mtls.guard';

describe('Efí mTLS proxy boundary', () => {
  const context = (ip: string, verify?: string): ExecutionContext =>
    ({
      switchToHttp: (): object => ({
        getRequest: (): object => ({
          socket: { remoteAddress: ip },
          headers: { 'x-efi-client-verify': verify },
        }),
      }),
    }) as unknown as ExecutionContext;
  const guard = new EfiMtlsGuard(
    new ConfigService({ EFI_MTLS_PROXY_IP: '172.30.0.2' }),
  );
  it('rejects traffic without an authenticated client certificate', () => {
    expect(() => guard.canActivate(context('172.30.0.2'))).toThrow();
    expect(() => guard.canActivate(context('172.30.0.2', 'NONE'))).toThrow();
  });
  it('rejects a spoofed success header outside the exact trusted proxy', () => {
    expect(() =>
      guard.canActivate(context('203.0.113.2', 'SUCCESS')),
    ).toThrow();
    expect(() =>
      new EfiMtlsGuard(new ConfigService()).canActivate(
        context('172.30.0.2', 'SUCCESS'),
      ),
    ).toThrow();
  });
  it('accepts the trusted proxy mTLS assertion including IPv4-mapped sockets', () => {
    expect(guard.canActivate(context('::ffff:172.30.0.2', 'SUCCESS'))).toBe(
      true,
    );
  });
});
