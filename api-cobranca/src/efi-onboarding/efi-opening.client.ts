import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { request } from 'https';
import { z } from 'zod';

export const EFI_REQUIRED_SCOPES: readonly string[] = [
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
];
const credentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  conta: z.object({
    numero: z.string().min(1),
    digito: z.string().min(1),
    payeeCode: z.string().min(1),
  }),
  escopos: z.array(z.string()),
  ativo: z.boolean(),
});

export interface EfiApplicant {
  cpf: string;
  nomeCompleto: string;
  dataNascimento: string;
  nomeMae: string;
  celular: string;
  email: string;
  cnpj: string;
  razaoSocial: string;
  endereco: {
    cep: string;
    estado: string;
    cidade: string;
    bairro: string;
    logradouro: string;
    numero: string;
    complemento?: string;
  };
}
export interface EfiTransportInput {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  certificatePath: string;
  certificatePassword: string;
}
export interface EfiAccountCredentials {
  clientId: string;
  clientSecret: string;
  accountNumber: string;
  accountDigit: string;
  payeeCode: string;
  scopes: string[];
  active: boolean;
}
export class EfiOpeningError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain: boolean,
    readonly httpStatus?: number,
  ) {
    super(code);
  }
}

@Injectable()
export class EfiOpeningTransport {
  async request(
    input: EfiTransportInput,
  ): Promise<{ status: number; body: unknown }> {
    const pfx = await readFile(input.certificatePath);
    return new Promise((resolve, reject): void => {
      const req = request(
        input.url,
        {
          method: input.method,
          headers: input.headers,
          pfx,
          passphrase: input.certificatePassword,
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
        },
        (response): void => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer): void => {
            size += chunk.length;
            if (size > 2_000_000) {
              req.destroy(new Error('EFI_RESPONSE_TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', (): void =>
            reject(new Error('EFI_TRANSPORT_FAILED')),
          );
          response.on('end', (): void => {
            try {
              const content = Buffer.concat(chunks).toString('utf8');
              const body: unknown = content ? JSON.parse(content) : null;
              resolve({ status: response.statusCode ?? 502, body });
            } catch {
              reject(new Error('EFI_INVALID_RESPONSE'));
            }
          });
        },
      );
      const deadline = setTimeout((): void => {
        req.destroy(new Error('EFI_TIMEOUT'));
      }, 20_000);
      req.on('close', (): void => clearTimeout(deadline));
      req.on('error', (): void => reject(new Error('EFI_TRANSPORT_FAILED')));
      if (input.body !== undefined) req.write(JSON.stringify(input.body));
      req.end();
    });
  }
}

@Injectable()
export class EfiOpeningClient {
  constructor(
    private readonly config: ConfigService,
    private readonly transport: EfiOpeningTransport,
  ) {}
  async createAccount(applicant: EfiApplicant): Promise<string> {
    const body = await this.call('POST', '/conta-simplificada', {
      clienteFinal: applicant,
      meioDeNotificacao: ['whatsapp'],
      escoposIntegrados: [...EFI_REQUIRED_SCOPES],
    });
    const parsed = z
      .object({
        contaSimplificada: z.object({ identificador: z.string().min(1) }),
      })
      .safeParse(body);
    if (!parsed.success)
      throw new EfiOpeningError('EFI_SUBMISSION_UNCERTAIN', true);
    return parsed.data.contaSimplificada.identificador;
  }

  async createCertificate(requestId: string): Promise<string> {
    const body = await this.call(
      'POST',
      `/conta-simplificada/${encodeURIComponent(requestId)}/certificado`,
    );
    const parsed = z
      .union([z.string().min(1), z.object({ certificado: z.string().min(1) })])
      .safeParse(body);
    if (!parsed.success)
      throw new EfiOpeningError('EFI_CERTIFICATE_UNCERTAIN', true);
    const base64 =
      typeof parsed.data === 'string' ? parsed.data : parsed.data.certificado;
    if (Buffer.from(base64, 'base64').toString('base64') !== base64)
      throw new EfiOpeningError('EFI_CERTIFICATE_UNCERTAIN', true);
    return base64;
  }

  async getCredentials(requestId: string): Promise<EfiAccountCredentials> {
    const body = await this.call(
      'GET',
      `/conta-simplificada/${encodeURIComponent(requestId)}/credenciais`,
    );
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success)
      throw new EfiOpeningError('EFI_INVALID_CREDENTIAL_RESPONSE', false);
    const data = parsed.data;
    return {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      accountNumber: data.conta.numero,
      accountDigit: data.conta.digito,
      payeeCode: data.conta.payeeCode,
      scopes: data.escopos,
      active: data.ativo,
    };
  }

  async registerWebhook(webhookUrl: string): Promise<void> {
    await this.call('POST', '/webhook', { webhookUrl });
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const token = await this.authenticate();
    try {
      const response = await this.transport.request(
        this.input(method, path, { Authorization: `Bearer ${token}` }, body),
      );
      if (response.status < 200 || response.status >= 300) {
        const uncertain =
          method === 'POST' &&
          (response.status >= 500 || response.status === 409);
        const parsed = z
          .object({ nome: z.string().regex(/^[a-zA-Z_+.-]{1,64}$/) })
          .safeParse(response.body);
        throw new EfiOpeningError(
          uncertain
            ? 'EFI_SUBMISSION_UNCERTAIN'
            : parsed.success
              ? parsed.data.nome
              : 'EFI_REQUEST_FAILED',
          uncertain,
          response.status,
        );
      }
      return response.body;
    } catch (error: unknown) {
      if (error instanceof EfiOpeningError) throw error;
      throw new EfiOpeningError(
        method === 'POST' ? 'EFI_SUBMISSION_UNCERTAIN' : 'EFI_REQUEST_FAILED',
        method === 'POST',
      );
    }
  }

  private async authenticate(): Promise<string> {
    try {
      const credentials = `${this.config.getOrThrow<string>('EFI_OPENING_CLIENT_ID')}:${this.config.getOrThrow<string>('EFI_OPENING_CLIENT_SECRET')}`;
      const response = await this.transport.request(
        this.input(
          'POST',
          '/oauth/token',
          {
            Authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
          },
          { grant_type: 'client_credentials' },
        ),
      );
      const parsed = z
        .object({ access_token: z.string().min(1) })
        .safeParse(response.body);
      if (response.status !== 200 || !parsed.success) throw new Error();
      return parsed.data.access_token;
    } catch {
      throw new EfiOpeningError('EFI_AUTHENTICATION_FAILED', false);
    }
  }

  private input(
    method: 'GET' | 'POST',
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): EfiTransportInput {
    const hostname =
      this.config.get<string>('EFI_ENV') === 'production'
        ? 'abrircontas.api.efipay.com.br'
        : 'abrircontas-h.api.efipay.com.br';
    return {
      url: `https://${hostname}/v1${path}`,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      certificatePath: this.config.getOrThrow<string>('EFI_OPENING_CERT_PATH'),
      certificatePassword:
        this.config.get<string>('EFI_OPENING_CERT_PASSWORD') ?? '',
    };
  }
}
