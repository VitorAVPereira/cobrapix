import { EfiDisbursementClient, SendInput } from './efi-disbursement.client';

// Responses and errors as returned by the Efí sandbox (efi-disbursement-validation.md).
describe('EfiDisbursementClient', () => {
  const client = new EfiDisbursementClient({} as never, {} as never);
  const sdk = {
    pixSend: jest.fn(),
    pixSendDetailId: jest.fn(),
    getAccountBalance: jest.fn(),
  };
  const account = {
    identityId: 'identity',
    pixKey: 'chave-da-empresa',
    environment: 'PRODUCTION' as const,
    sdk: sdk as never,
  };
  const byKey: SendInput = {
    idEnvio: '0b0bc6de611e4415a2b63768d6d9f155',
    amountCents: 150000,
    reference: 'Folha 10/2026',
    documentType: 'CPF',
    document: '52998224725',
    recipientName: 'Ana Souza',
    pixKey: 'ana@example.com',
    bankIspb: null,
    bankAgency: null,
    bankAccount: null,
    bankAccountType: null,
  };
  const accepted = (status: string) => ({
    idEnvio: byKey.idEnvio,
    e2eId: 'E09089356202610170823APIDICT3fa5',
    valor: '1500.00',
    horario: { solicitacao: '2026-10-17T08:23:31.901Z' },
    status,
  });
  beforeEach(() => jest.clearAllMocks());

  it('sends by key with the collaborator document, from the company key', async () => {
    sdk.pixSend.mockResolvedValue(accepted('EM_PROCESSAMENTO'));
    await expect(client.send(account, byKey)).resolves.toEqual({
      kind: 'IN_PROCESSING',
      e2eId: 'E09089356202610170823APIDICT3fa5',
    });
    expect(sdk.pixSend).toHaveBeenCalledWith(
      { idEnvio: byKey.idEnvio },
      {
        valor: '1500.00',
        pagador: { chave: 'chave-da-empresa', infoPagador: 'Folha 10/2026' },
        favorecido: { chave: 'ana@example.com', cpf: '52998224725' },
      },
    );
  });

  it('sends by bank account with the CNPJ of a company collaborator', async () => {
    sdk.pixSend.mockResolvedValue(accepted('EM_PROCESSAMENTO'));
    await client.send(account, {
      ...byKey,
      documentType: 'CNPJ',
      document: '11222333000181',
      pixKey: null,
      bankIspb: '09089356',
      bankAgency: '1',
      bankAccount: '123453',
      bankAccountType: 'svgs',
    });
    expect((sdk.pixSend.mock.calls as unknown[][])[0]?.[1]).toMatchObject({
      valor: '1500.00',
      favorecido: {
        contaBanco: {
          nome: 'Ana Souza',
          cnpj: '11222333000181',
          codigoBanco: '09089356',
          agencia: '1',
          conta: '123453',
          tipoConta: 'svgs',
        },
      },
    });
  });

  it('201 with NAO_REALIZADO is a refusal right away; REALIZADO is paid', async () => {
    sdk.pixSend.mockResolvedValueOnce(accepted('NAO_REALIZADO'));
    await expect(client.send(account, byKey)).resolves.toMatchObject({
      kind: 'REFUSED',
      code: 'NAO_REALIZADO',
    });
    sdk.pixSend.mockResolvedValueOnce(accepted('REALIZADO'));
    await expect(client.send(account, byKey)).resolves.toMatchObject({
      kind: 'PAID',
    });
  });

  it.each([
    ['chave_nao_pertence_ao_documento', 'REFUSED'],
    ['chave_favorecido_nao_encontrada', 'REFUSED'],
    ['json_invalido', 'REFUSED'],
    ['conta_chave_sem_webhook', 'REFUSED'],
    ['id_envio_duplicado', 'DUPLICATE'],
    ['balde_fichas_vazio', 'RATE_LIMITED'],
    ['erro_aplicacao', 'UNCERTAIN'],
    ['algo_novo_da_efi', 'UNCERTAIN'],
  ])('error %s is %s', async (nome, kind) => {
    sdk.pixSend.mockRejectedValue({ nome, mensagem: 'mensagem da Efí' });
    await expect(client.send(account, byKey)).resolves.toMatchObject({ kind });
  });

  it('a network error or an answer for another send id is uncertain, never a failure', async () => {
    sdk.pixSend.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(client.send(account, byKey)).resolves.toEqual({
      kind: 'UNCERTAIN',
    });
    sdk.pixSend.mockResolvedValueOnce({
      ...accepted('EM_PROCESSAMENTO'),
      idEnvio: 'outro',
    });
    await expect(client.send(account, byKey)).resolves.toEqual({
      kind: 'UNCERTAIN',
    });
  });

  it('consults by send id; not found is distinct from other errors', async () => {
    sdk.pixSendDetailId.mockResolvedValueOnce({
      endToEndId: 'E1',
      idEnvio: byKey.idEnvio,
      valor: '0.01',
      chave: 'chave-da-empresa',
      status: 'REALIZADO',
      horario: {
        solicitacao: '2026-10-17T08:23:31.000Z',
        liquidacao: '2026-10-17T08:23:31.000Z',
      },
    });
    await expect(client.status(account, byKey.idEnvio)).resolves.toEqual({
      kind: 'FOUND',
      status: 'REALIZADO',
      e2eId: 'E1',
      settledAt: new Date('2026-10-17T08:23:31.000Z'),
    });
    sdk.pixSendDetailId.mockRejectedValueOnce({
      type: 'https://pix.bcb.gov.br/api/v2/error/PixEnviadoNaoEncontrado',
      status: 404,
    });
    await expect(client.status(account, byKey.idEnvio)).resolves.toEqual({
      kind: 'NOT_FOUND',
    });
    sdk.pixSendDetailId.mockRejectedValueOnce({ nome: 'erro_interno' });
    await expect(client.status(account, byKey.idEnvio)).rejects.toBeDefined();
  });

  it('reads the balance in cents', async () => {
    sdk.getAccountBalance.mockResolvedValue({ saldo: '2480.37' });
    await expect(client.balanceCents(account)).resolves.toBe(248037);
    sdk.getAccountBalance.mockResolvedValue({ saldo: '2.480,37' });
    await expect(client.balanceCents(account)).rejects.toThrow();
  });
});
