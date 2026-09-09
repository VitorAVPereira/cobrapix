import { ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

describe('GlobalExceptionFilter financial error contract', () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  function fixture(): {
    host: ArgumentsHost;
    json: jest.Mock;
    log: jest.SpyInstance;
  } {
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnValue({ json }) };
    const request = {
      method: 'POST',
      url: '/onboarding/efi/submit?token=sensitive',
      path: '/onboarding/efi/submit',
      route: { path: '/onboarding/efi/submit' },
    };
    const host = {
      switchToHttp: (): object => ({
        getResponse: (): object => response,
        getRequest: (): object => request,
      }),
    } as unknown as ArgumentsHost;
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((): void => undefined);
    return { host, json, log };
  }

  it('preserves typed error code alongside the friendly message', () => {
    const { host, json } = fixture();
    new GlobalExceptionFilter().catch(
      new HttpException(
        {
          code: 'EFI_ONBOARDING_REQUIRED',
          message: 'Conclua a ativação da conta.',
        },
        409,
      ),
      host,
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'EFI_ONBOARDING_REQUIRED',
        message: 'Conclua a ativação da conta.',
        statusCode: 409,
      }),
    );
  });

  it('keeps provider stacks and request query secrets out of logs', () => {
    const { host, log, json } = fixture();
    new GlobalExceptionFilter().catch(
      new Error('provider clientSecret=sensitive-secret'),
      host,
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive');
    expect(JSON.stringify(json.mock.calls)).not.toContain('sensitive-secret');
  });
});
