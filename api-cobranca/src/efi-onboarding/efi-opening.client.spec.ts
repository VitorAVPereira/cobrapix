import { ConfigService } from '@nestjs/config';
import {
  EfiOpeningClient,
  EfiOpeningError,
  EfiOpeningTransport,
  EfiTransportInput,
} from './efi-opening.client';

describe('Efí opening provider contract', () => {
  function fixture(
    responses: Array<{ status: number; body: unknown } | Error>,
  ): { client: EfiOpeningClient; calls: EfiTransportInput[] } {
    const calls: EfiTransportInput[] = [];
    const transport = {
      request: (
        input: EfiTransportInput,
      ): Promise<{ status: number; body: unknown }> => {
        calls.push(input);
        const response = responses.shift();
        return response instanceof Error
          ? Promise.reject(response)
          : Promise.resolve(response ?? { status: 500, body: {} });
      },
    } as EfiOpeningTransport;
    const config = new ConfigService({
      EFI_ENV: 'homologation',
      EFI_OPENING_CLIENT_ID: 'client',
      EFI_OPENING_CLIENT_SECRET: 'secret',
      EFI_OPENING_CERT_PATH: '/cert.p12',
    });
    return { client: new EfiOpeningClient(config, transport), calls };
  }

  const applicant = {
    cpf: '12345678909',
    nomeCompleto: 'Representante',
    dataNascimento: '01/01/1980',
    nomeMae: 'Nome Mãe',
    celular: '11999999999',
    email: 'legal@example.test',
    cnpj: '12345678000190',
    razaoSocial: 'Empresa LTDA',
    endereco: {
      cep: '01001000',
      estado: 'SP',
      cidade: 'São Paulo',
      bairro: 'Centro',
      logradouro: 'Rua',
      numero: '1',
    },
  };
  const token = { status: 200, body: { access_token: 'access-token' } };

  it('submits PJ once with only approved scopes and WhatsApp notification', async () => {
    const { client, calls } = fixture([
      token,
      {
        status: 200,
        body: { contaSimplificada: { identificador: 'request-1' } },
      },
    ]);
    expect(await client.createAccount(applicant)).toBe('request-1');
    expect(calls[1]?.body).toEqual({
      clienteFinal: applicant,
      meioDeNotificacao: ['whatsapp'],
      escoposIntegrados: [
        'cobv.write',
        'cobv.read',
        'pix.read',
        'webhook.write',
        'webhook.read',
        'payloadlocation.read',
        'gn.pix.evp.write',
        'gn.pix.evp.read',
        'gn.split.write',
        'gn.split.read',
      ],
    });
    expect(calls[1]?.url).toBe(
      'https://abrircontas-h.api.efipay.com.br/v1/conta-simplificada',
    );
  });

  it('marks a transport timeout after submission as uncertain without retry', async () => {
    const { client, calls } = fixture([
      token,
      new Error('timeout clientSecret=do-not-leak'),
    ]);
    await expect(client.createAccount(applicant)).rejects.toMatchObject({
      uncertain: true,
      code: 'EFI_SUBMISSION_UNCERTAIN',
    });
    expect(calls).toHaveLength(2);
  });

  it('distinguishes OAuth failure before submission from ambiguous submission', async () => {
    const { client, calls } = fixture([
      { status: 401, body: { message: 'secret-private-detail' } },
    ]);
    await expect(client.createAccount(applicant)).rejects.toMatchObject({
      uncertain: false,
      code: 'EFI_AUTHENTICATION_FAILED',
    });
    expect(calls).toHaveLength(1);
  });

  it('parses certificate as a JSON base64 string and validates credentials response', async () => {
    const { client } = fixture([
      token,
      { status: 201, body: 'cDEy' },
      token,
      {
        status: 200,
        body: {
          clientId: 'id',
          clientSecret: 'secret',
          conta: { numero: '123', digito: '4', payeeCode: 'payee' },
          escopos: ['pix.read'],
          ativo: true,
        },
      },
    ]);
    expect(await client.createCertificate('request-1')).toBe('cDEy');
    expect(await client.getCredentials('request-1')).toMatchObject({
      active: true,
      accountNumber: '123',
      payeeCode: 'payee',
    });
  });

  it('sanitizes functional errors and rejects malformed success as uncertain', async () => {
    const { client } = fixture([
      token,
      {
        status: 400,
        body: { nome: 'cnpj_invalido', mensagem: 'private document' },
      },
      token,
      { status: 200, body: {} },
    ]);
    await expect(client.createAccount(applicant)).rejects.toMatchObject({
      code: 'cnpj_invalido',
      uncertain: false,
    });
    try {
      await client.createAccount(applicant);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EfiOpeningError);
      expect(error).toMatchObject({ uncertain: true });
      expect(String(error)).not.toContain('private document');
    }
  });
});
