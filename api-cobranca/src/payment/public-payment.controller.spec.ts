import { BadRequestException } from '@nestjs/common';
import { PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { PublicPaymentController } from './public-payment.controller';
import { PublicPaymentLinkService } from './payment-link.service';

describe('PublicPaymentController', () => {
  function fixture(result: Promise<unknown>) {
    const getPublicPayment = jest.fn().mockReturnValue(result);
    const response = { setHeader: jest.fn() };
    const controller = new PublicPaymentController({
      getPublicPayment,
    } as unknown as PublicPaymentLinkService);
    return { controller, getPublicPayment, response };
  }

  it('serves the public payment without caching and from the token alone', async () => {
    const { controller, getPublicPayment, response } = fixture(
      Promise.resolve({ state: 'PAID', canPay: false }),
    );
    await expect(
      controller.getPayment('signed.token', response as unknown as Response),
    ).resolves.toEqual({ state: 'PAID', canPay: false });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(getPublicPayment).toHaveBeenCalledWith('signed.token');
  });

  it('marks refused links as not cacheable too', async () => {
    const { controller, response } = fixture(
      Promise.reject(
        new BadRequestException('Link de pagamento invalido ou expirado.'),
      ),
    );
    await expect(
      controller.getPayment('bad', response as unknown as Response),
    ).rejects.toThrow('Link de pagamento invalido ou expirado.');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
  });

  it('reads nothing but the token path parameter', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PublicPaymentController)).toBe(
      'payments/public',
    );
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      PublicPaymentController,
      'getPayment',
    ) as Record<string, { data?: unknown }>;
    const bindings = Object.entries(args).map(([key, arg]) => ({
      kind: key.split(':')[0],
      data: arg.data,
    }));
    // Param("token") and the response for headers; no query, body or user.
    expect(bindings).toHaveLength(2);
    expect(bindings).toContainEqual({ kind: '5', data: 'token' });
  });
});
