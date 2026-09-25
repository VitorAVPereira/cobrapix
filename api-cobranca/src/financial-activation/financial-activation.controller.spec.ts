import { Test } from '@nestjs/testing';
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GlobalExceptionFilter } from '../common/filters/http-exception.filter';
import { FinancialActivationController } from './financial-activation.controller';
import { FinancialActivationService } from './financial-activation.service';
import { FinancialValidationService } from './financial-validation.service';

describe('Ativação financeira HTTP', () => {
  let app: INestApplication<Server>;
  const service = {
    getOverview: jest.fn(),
    createCandidate: jest.fn(),
    getActivation: jest.fn(),
    updateConfiguration: jest.fn(),
    uploadCredentials: jest.fn(),
    cancel: jest.fn(),
    activate: jest.fn(),
    setManualActivationReleased: jest.fn(),
  };
  const validation = { requestValidation: jest.fn() };
  const id = randomUUID();
  const companyId = randomUUID();
  const credentialFields = {
    expectedRevision: '1',
    clientId: 'Client_Id_fixture',
    clientSecret: 'Client_Secret_fixture',
    holderDocument: '12345678000195',
    efiAccountNumber: '123456',
    payeeCode: 'abc123',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FinancialActivationController],
      providers: [
        { provide: FinancialActivationService, useValue: service },
        { provide: FinancialValidationService, useValue: validation },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext): boolean {
          const req = context
            .switchToHttp()
            .getRequest<
              Request & { user?: { role: string; userId: string } }
            >();
          const role = req.header('x-test-role');
          if (!role) throw new UnauthorizedException();
          req.user = { role, userId: 'admin-test' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    for (const fn of [...Object.values(service), ...Object.values(validation)])
      fn.mockResolvedValue({ id });
  });
  afterAll(async () => {
    await app.close();
  });

  const routes: Array<[string, string]> = [
    ['get', `/admin/companies/${companyId}/financial-profile`],
    ['post', `/admin/companies/${companyId}/financial-activations`],
    ['get', `/admin/financial-activations/${id}`],
    ['put', `/admin/financial-activations/${id}/configuration`],
    ['put', `/admin/financial-activations/${id}/credentials`],
    ['post', `/admin/financial-activations/${id}/cancel`],
    ['post', `/admin/financial-activations/${id}/validate`],
    ['post', `/admin/financial-activations/${id}/activate`],
    ['put', '/admin/integrations/financial-manual-activation'],
  ];

  it.each(routes)(
    'exige autenticação e papel PLATFORM_ADMIN (%s %s)',
    async (method, path) => {
      const http = request(app.getHttpServer());
      await (http[method as 'get'](path) as request.Test).expect(401);
      await (
        request(app.getHttpServer())[method as 'get'](path) as request.Test
      )
        .set('x-test-role', 'COMPANY_ADMIN')
        .expect(403);
      for (const fn of [
        ...Object.values(service),
        ...Object.values(validation),
      ])
        expect(fn).not.toHaveBeenCalled();
    },
  );

  it('recusa identificadores que não são UUID', async () => {
    await request(app.getHttpServer())
      .get('/admin/financial-activations/../../users')
      .set('x-test-role', 'PLATFORM_ADMIN')
      .expect(404);
    await request(app.getHttpServer())
      .get('/admin/financial-activations/not-a-uuid')
      .set('x-test-role', 'PLATFORM_ADMIN')
      .expect(400);
    expect(service.getActivation).not.toHaveBeenCalled();
  });

  it('valida o corpo da criação e recusa campos desconhecidos', async () => {
    const body = {
      idempotencyKey: randomUUID(),
      accountMode: 'CUSTOMER_ACCOUNT',
      payoutMode: 'DIRECT_TO_CUSTOMER',
      environment: 'HOMOLOGATION',
      enabledMethods: ['PIX', 'BOLIX'],
    };
    const post = (payload: object) =>
      request(app.getHttpServer())
        .post(`/admin/companies/${companyId}/financial-activations`)
        .set('x-test-role', 'PLATFORM_ADMIN')
        .send(payload);
    await post(body).expect(201);
    expect(service.createCandidate).toHaveBeenCalledWith(
      companyId,
      'admin-test',
      expect.objectContaining(body),
    );
    await post({ ...body, companyId: randomUUID() }).expect(400);
    await post({ ...body, enabledMethods: ['BOLETO'] }).expect(400);
    await post({ ...body, enabledMethods: ['PIX', 'PIX'] }).expect(400);
    await post({ ...body, enabledMethods: [] }).expect(400);
    await post({ ...body, idempotencyKey: 'x' }).expect(400);
    expect(service.createCandidate).toHaveBeenCalledTimes(1);
  });

  it('recebe o certificado por multipart e converte a revisão', async () => {
    const req = request(app.getHttpServer())
      .put(`/admin/financial-activations/${id}/credentials`)
      .set('x-test-role', 'PLATFORM_ADMIN')
      .attach('certificate', Buffer.from('p12-bytes'), 'cert.p12');
    for (const [key, value] of Object.entries(credentialFields))
      void req.field(key, value);
    await req.expect(200);
    const [, userId, dto, file] = service.uploadCredentials.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
      { buffer: Buffer },
    ];
    expect(userId).toBe('admin-test');
    expect(dto.expectedRevision).toBe(1);
    expect(file.buffer.toString()).toBe('p12-bytes');
  });

  it('recusa certificado acima de 1 MiB antes do serviço', async () => {
    const req = request(app.getHttpServer())
      .put(`/admin/financial-activations/${id}/credentials`)
      .set('x-test-role', 'PLATFORM_ADMIN')
      .attach('certificate', Buffer.alloc(1024 * 1024 + 1), 'cert.p12');
    for (const [key, value] of Object.entries(credentialFields))
      void req.field(key, value);
    await req.expect(413);
    expect(service.uploadCredentials).not.toHaveBeenCalled();
  });

  it('recusa mais de um arquivo e campos multipart extras', async () => {
    const twoFiles = request(app.getHttpServer())
      .put(`/admin/financial-activations/${id}/credentials`)
      .set('x-test-role', 'PLATFORM_ADMIN')
      .attach('certificate', Buffer.from('a'), 'a.p12')
      .attach('certificate', Buffer.from('b'), 'b.p12');
    for (const [key, value] of Object.entries(credentialFields))
      void twoFiles.field(key, value);
    await twoFiles.expect(400);
    const extra = request(app.getHttpServer())
      .put(`/admin/financial-activations/${id}/credentials`)
      .set('x-test-role', 'PLATFORM_ADMIN')
      .attach('certificate', Buffer.from('a'), 'a.p12')
      .field('certificatePath', '/etc/passwd');
    for (const [key, value] of Object.entries(credentialFields))
      void extra.field(key, value);
    await extra.expect(400);
    expect(service.uploadCredentials).not.toHaveBeenCalled();
  });

  it('validação é assíncrona (202) e exige chave de idempotência', async () => {
    const post = (body: object) =>
      request(app.getHttpServer())
        .post(`/admin/financial-activations/${id}/validate`)
        .set('x-test-role', 'PLATFORM_ADMIN')
        .send(body);
    await post({ expectedRevision: 3, idempotencyKey: randomUUID() }).expect(
      202,
    );
    await post({ expectedRevision: 3 }).expect(400);
    expect(validation.requestValidation).toHaveBeenCalledTimes(1);
  });

  it('ativação exige confirmação explícita dos efeitos', async () => {
    const body = {
      expectedRevision: 4,
      validationAttemptId: randomUUID(),
      idempotencyKey: randomUUID(),
      confirmEffects: true,
      acknowledgeUnverifiedSteps: true,
    };
    const post = (payload: object) =>
      request(app.getHttpServer())
        .post(`/admin/financial-activations/${id}/activate`)
        .set('x-test-role', 'PLATFORM_ADMIN')
        .send(payload);
    await post({ ...body, confirmEffects: false }).expect(400);
    await post({ ...body, confirmEffects: 'yes' }).expect(400);
    await post({ ...body, confirmEffects: 'false' }).expect(400);
    await post({ ...body, acknowledgeUnverifiedSteps: 'yes' }).expect(400);
    const { confirmEffects: _omitted, ...withoutConfirmation } = body;
    void _omitted;
    await post(withoutConfirmation).expect(400);
    expect(service.activate).not.toHaveBeenCalled();
    await post(body).expect(200);
    expect(service.activate).toHaveBeenCalledWith(
      id,
      'admin-test',
      expect.objectContaining({ confirmEffects: true }),
    );
  });

  it('a liberação manual não trata texto como verdadeiro', async () => {
    const put = (body: object) =>
      request(app.getHttpServer())
        .put('/admin/integrations/financial-manual-activation')
        .set('x-test-role', 'PLATFORM_ADMIN')
        .send(body);
    await put({ enabled: 'no' }).expect(400);
    await put({ enabled: 1 }).expect(400);
    await put({ enabled: 'false' }).expect(200);
    expect(service.setManualActivationReleased).toHaveBeenCalledWith(false);
    await put({ enabled: false }).expect(200);
    expect(service.setManualActivationReleased).toHaveBeenCalledTimes(2);
  });
});
