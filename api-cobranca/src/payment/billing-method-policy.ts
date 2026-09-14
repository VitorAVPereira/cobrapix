import { HttpException } from '@nestjs/common';

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
