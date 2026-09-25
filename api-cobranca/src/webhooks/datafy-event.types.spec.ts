import { normalizeDatafyEvents } from './datafy-event.types';

describe('Normalizacao Datafy', () => {
  const identity = { wabaId: '111', phoneNumberId: '222' };
  const now = 1_800_000_000_000;
  const metadata = { phone_number_id: '222' };
  const inbound = {
    from: '5511999999999',
    id: 'wamid.in',
    timestamp: String(now / 1000),
    type: 'text',
    text: { body: 'Olá' },
    context: { id: 'wamid.parent' },
  };
  const envelope = (changes: unknown[]): unknown => ({
    object: 'whatsapp_business_account',
    entry: [{ id: '111', changes }],
  });
  it('percorre entries, changes, mensagens e statuses de lote misto', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '111',
          changes: [
            {
              field: 'messages',
              value: {
                metadata,
                messages: [inbound, { ...inbound, id: 'wamid.second' }],
                statuses: [
                  {
                    id: 'wamid.out',
                    status: 'read',
                    timestamp: String(now / 1000),
                    recipient_id: inbound.from,
                  },
                ],
              },
            },
          ],
        },
        {
          id: '111',
          changes: [
            {
              field: 'message_template_status_update',
              value: { event: 'APPROVED', message_template_name: 'aviso' },
            },
            { field: 'unknown_future_event', value: {} },
          ],
        },
      ],
    };
    const result = normalizeDatafyEvents(payload, identity, now);
    expect(result.map((event) => event.kind)).toEqual([
      'MESSAGE',
      'MESSAGE',
      'STATUS',
      'TEMPLATE',
      'UNKNOWN',
    ]);
    expect(result[0]).toMatchObject({
      replyToExternalMessageId: 'wamid.parent',
      source: 'LIVE',
    });
  });
  it('recusa WABA/número estranhos mesmo depois de um evento valido', () => {
    expect(() =>
      normalizeDatafyEvents(
        {
          object: 'whatsapp_business_account',
          entry: [{ id: 'other', changes: [] }],
        },
        identity,
        now,
      ),
    ).toThrow();
    expect(() =>
      normalizeDatafyEvents(
        envelope([
          { field: 'messages', value: { metadata, messages: [inbound] } },
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: '333' },
              messages: [inbound],
            },
          },
        ]),
        identity,
        now,
      ),
    ).toThrow();
    expect(() =>
      normalizeDatafyEvents(
        envelope([{ field: 'messages', value: { messages: [inbound] } }]),
        identity,
        now,
      ),
    ).toThrow();
  });
  it('preserva BSUID sem remover letras e separa historico/identidade', () => {
    const events = normalizeDatafyEvents(
      envelope([
        {
          field: 'messages',
          value: {
            metadata,
            messages: [
              { ...inbound, from: undefined, from_user_id: 'BR.123456789' },
            ],
          },
        },
        {
          field: 'history',
          value: {
            metadata,
            history: [{ threads: [{ messages: [inbound] }] }],
          },
        },
        { field: 'smb_app_state_sync', value: { metadata, state_sync: [] } },
      ]),
      identity,
      now,
    );
    expect(events[0]).toMatchObject({
      kind: 'MESSAGE',
      recipient: { type: 'BSUID', value: 'BR.123456789' },
    });
    expect(events.slice(1).map((event) => event.kind)).toEqual([
      'HISTORY',
      'IDENTITY',
    ]);
  });
  it('guarda tipos desconhecidos para triagem sem inventar mensagem vazia', () => {
    expect(
      normalizeDatafyEvents(
        envelope([
          {
            field: 'messages',
            value: {
              metadata,
              messages: [
                { ...inbound, type: 'future_type' },
                { ...inbound, id: undefined },
              ],
            },
          },
        ]),
        identity,
        now,
      ).map((event) => event.kind),
    ).toEqual(['UNKNOWN', 'UNKNOWN']);
  });
  it('preserva referencia de midia sem URL externa', () => {
    const events = normalizeDatafyEvents(
      envelope([
        {
          field: 'messages',
          value: {
            metadata,
            messages: [
              {
                ...inbound,
                type: 'document',
                document: {
                  id: '123',
                  mime_type: 'application/pdf',
                  caption: 'Comprovante',
                  url: 'https://private.invalid/token',
                },
              },
            ],
          },
        },
      ]),
      identity,
      now,
    );
    expect(events[0]).toMatchObject({
      kind: 'MESSAGE',
      attachment: { externalMediaId: '123', contentType: 'application/pdf' },
    });
    expect(JSON.stringify(events)).not.toContain('private.invalid');
  });

  it('keeps only server-issued button references and discards other payloads', () => {
    const token = `cfm1.${'b'.repeat(43)}`;
    const events = normalizeDatafyEvents(
      envelope([
        {
          field: 'messages',
          value: {
            metadata,
            messages: [
              {
                ...inbound,
                id: 'wamid.button',
                type: 'button',
                button: { text: 'Ja paguei', payload: token },
              },
              {
                ...inbound,
                id: 'wamid.interactive',
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: { id: token, title: 'Ja paguei' },
                },
              },
              {
                ...inbound,
                id: 'wamid.forged',
                type: 'button',
                button: {
                  text: 'Ja paguei',
                  payload: '{"companyId":"company-b"}',
                },
              },
            ],
          },
        },
      ]),
      identity,
      now,
    );
    expect(events).toEqual([
      expect.objectContaining({
        externalMessageId: 'wamid.button',
        interactiveToken: token,
      }),
      expect.objectContaining({
        externalMessageId: 'wamid.interactive',
        interactiveToken: token,
      }),
      expect.objectContaining({
        externalMessageId: 'wamid.forged',
        interactiveToken: null,
      }),
    ]);
  });
});
