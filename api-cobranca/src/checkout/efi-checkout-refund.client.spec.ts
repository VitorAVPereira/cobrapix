import EfiPay from 'sdk-node-apis-efi';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { CheckoutIssuerAccount } from './checkout-platform.service';
import { EfiCheckoutRefundClient } from './efi-checkout-refund.client';

jest.mock('sdk-node-apis-efi');

describe('EfiCheckoutRefundClient', () => {
  const sdk = {
    pixDevolution: jest.fn(),
    pixDetailDevolution: jest.fn(),
    refundCard: jest.fn(),
  };
  const client = new EfiCheckoutRefundClient({
    decrypt: (value: string) => value,
  } as unknown as PaymentCryptoService);
  const account = {
    identity: { id: 'conta-1', environment: 'PRODUCTION' },
    credential: {
      encryptedClientId: 'id',
      encryptedClientSecret: 'secret',
      encryptedCertificate: 'cert',
    },
  } as unknown as CheckoutIssuerAccount;
  // What the Efí SDK rejects with: a body with "nome", or a network error.
  const refused = (nome: string, status = 400) => ({ nome, status });

  beforeEach(() => {
    jest.clearAllMocks();
    (EfiPay as unknown as jest.Mock).mockImplementation(() => sdk);
  });

  it('Pix: devolve pelo e2eId com o id escolhido aqui e o valor em reais', async () => {
    sdk.pixDevolution.mockResolvedValue({
      id: 'ckr1',
      status: 'EM_PROCESSAMENTO',
    });
    await expect(client.pix(account, 'E2E1', 'ckr1', 7520)).resolves.toEqual({
      outcome: 'PROCESSING',
    });
    expect(sdk.pixDevolution).toHaveBeenCalledWith(
      { e2eId: 'E2E1', id: 'ckr1' },
      { valor: '75.20' },
    );

    sdk.pixDevolution.mockResolvedValue({ id: 'ckr1', status: 'DEVOLVIDO' });
    await expect(client.pix(account, 'E2E1', 'ckr1', 7520)).resolves.toEqual({
      outcome: 'DONE',
    });
  });

  it('Pix: recusa certa (sem saldo, prazo) volta com o código; resposta perdida fica incerta', async () => {
    sdk.pixDevolution.mockRejectedValue(refused('saldo_insuficiente'));
    await expect(client.pix(account, 'E2E1', 'ckr1', 7520)).resolves.toEqual({
      outcome: 'REJECTED',
      code: 'EFI_REJECTED_SALDO_INSUFICIENTE',
    });
    sdk.pixDevolution.mockResolvedValue({
      id: 'ckr1',
      status: 'NAO_REALIZADO',
    });
    await expect(client.pix(account, 'E2E1', 'ckr1', 7520)).resolves.toEqual({
      outcome: 'REJECTED',
      code: 'EFI_REFUND_NOT_DONE',
    });
    sdk.pixDevolution.mockRejectedValue(new Error('socket hang up'));
    await expect(client.pix(account, 'E2E1', 'ckr1', 7520)).resolves.toEqual({
      outcome: 'UNCERTAIN',
    });
    sdk.pixDevolution.mockRejectedValue(refused('erro_interno', 503));
    await expect(client.pix(account, 'E2E1', 'ckr1', 7520)).resolves.toEqual({
      outcome: 'UNCERTAIN',
    });
  });

  it('Pix: a consulta pelo id diz o que houve; sem devolução com esse id, nunca existiu', async () => {
    sdk.pixDetailDevolution.mockResolvedValue({
      id: 'ckr1',
      status: 'DEVOLVIDO',
    });
    await expect(client.pixStatus(account, 'E2E1', 'ckr1')).resolves.toEqual({
      outcome: 'DONE',
    });
    expect(sdk.pixDetailDevolution).toHaveBeenCalledWith({
      e2eId: 'E2E1',
      id: 'ckr1',
    });
    sdk.pixDetailDevolution.mockRejectedValue(
      refused('devolucao_nao_encontrada', 404),
    );
    await expect(client.pixStatus(account, 'E2E1', 'ckr1')).resolves.toBeNull();
    sdk.pixDetailDevolution.mockRejectedValue(new Error('timeout'));
    await expect(client.pixStatus(account, 'E2E1', 'ckr1')).rejects.toThrow(
      'timeout',
    );
  });

  it('cartão: estorno pelo id da cobrança, em centavos; aceito fica em processamento', async () => {
    sdk.refundCard.mockResolvedValue({
      code: 200,
      data: 'Reembolso em processamento',
    });
    await expect(client.card(account, '991', 3000)).resolves.toEqual({
      outcome: 'PROCESSING',
    });
    expect(sdk.refundCard).toHaveBeenCalledWith({ id: 991 }, { amount: 3000 });

    sdk.refundCard.mockRejectedValue({
      code: 3500034,
      error: 'validation_error',
      status: 400,
    });
    await expect(client.card(account, '991', 3000)).resolves.toMatchObject({
      outcome: 'REJECTED',
    });
    sdk.refundCard.mockRejectedValue(new Error('socket hang up'));
    await expect(client.card(account, '991', 3000)).resolves.toEqual({
      outcome: 'UNCERTAIN',
    });
  });
});
