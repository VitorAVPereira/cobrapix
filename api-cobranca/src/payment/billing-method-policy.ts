import { HttpException } from '@nestjs/common';

/** BOLETO remains in storage only for historical charges and callbacks. */
export function assertNewBillingMethod(method: string): void {
  if (method !== 'PIX' && method !== 'BOLIX') {
    throw new HttpException(
      {
        code: 'PAYMENT_METHOD_DISABLED',
        message: 'Novas cobranças devem usar Pix ou Bolix.',
      },
      403,
    );
  }
}
