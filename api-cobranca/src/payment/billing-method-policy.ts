import { HttpException } from '@nestjs/common';

export function assertNewBillingMethod(method: string): void {
  if (method !== 'PIX' && method !== 'BOLIX' && method !== 'CREDIT_CARD') {
    throw new HttpException(
      {
        code: 'PAYMENT_METHOD_DISABLED',
        message: 'Novas cobranças devem usar Pix, Bolix ou cartão de crédito.',
      },
      403,
    );
  }
}
