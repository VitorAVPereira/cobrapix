import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import {
  CheckoutWebhookSender,
  isPrivateAddress,
  webhookSignature,
  webhookUrlProblem,
} from './checkout-webhook.sender';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

describe('webhookUrlProblem', () => {
  it.each([
    ['http://porquim.test/webhook', 'https://'],
    ['https://127.0.0.1/hook', 'endereço público'],
    ['https://[::1]/hook', 'endereço público'],
    ['https://localhost/hook', 'endereço público'],
    ['https://user:pass@porquim.test/hook', 'usuário e senha'],
    ['https://porquim.test:8443/hook', 'porta padrão'],
    ['não é url', 'URL válida'],
  ])('recusa %s', (url, message) => {
    expect(webhookUrlProblem(url)).toContain(message);
  });

  it('aceita https público', () => {
    expect(
      webhookUrlProblem('https://api.porquim.test/cifra/webhook'),
    ).toBeNull();
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.1',
    '172.20.1.1',
    '192.168.0.5',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])('%s é privado', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(['8.8.8.8', '177.71.200.1', '2001:4860:4860::8888'])(
    '%s é público',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('CheckoutWebhookSender', () => {
  const sender = new CheckoutWebhookSender();
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  const target = { url: 'https://api.porquim.test/hook', secret: 'whsec_test' };
  const event = { id: 'evt_1', type: 'order.paid' };
  const now = new Date('2026-11-06T12:00:00Z');

  beforeEach(() => {
    jest.clearAllMocks();
    (lookup as jest.Mock).mockResolvedValue([
      { address: '177.71.200.1', family: 4 },
    ]);
  });
  afterAll(() => fetchMock.mockRestore());

  it('assina o corpo bruto com o horário e o segredo', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const body = '{"id":"evt_1"}';

    await expect(sender.send(target, event, body, now)).resolves.toEqual({
      ok: true,
      statusCode: 200,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const t = Math.floor(now.getTime() / 1000);
    const expected = createHmac('sha256', 'whsec_test')
      .update(`${t}.${body}`)
      .digest('hex');
    expect(headers['X-Cifra-Signature']).toBe(`t=${t},v1=${expected}`);
    expect(webhookSignature('whsec_test', t, body)).toBe(expected);
    expect(headers['X-Cifra-Event-Id']).toBe('evt_1');
    expect(init.redirect).toBe('manual');
    expect(init.body).toBe(body);
  });

  it('nome que resolve para IP privado não recebe nada', async () => {
    (lookup as jest.Mock).mockResolvedValue([
      { address: '177.71.200.1', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]);
    await expect(sender.send(target, event, '{}', now)).resolves.toMatchObject({
      ok: false,
      error: 'URL_NOT_PUBLIC',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirecionamento e erro do servidor contam como falha', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: 'http://10.0.0.1' },
      }),
    );
    await expect(sender.send(target, event, '{}', now)).resolves.toEqual({
      ok: false,
      statusCode: 302,
      error: 'HTTP_STATUS',
    });
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    );
    await expect(sender.send(target, event, '{}', now)).resolves.toMatchObject({
      ok: false,
      error: 'TIMEOUT',
    });
  });
});
