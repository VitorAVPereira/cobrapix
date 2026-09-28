'use strict';
// Shared fixtures for template hold/resume runners; always against a disposable database.
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { root } = require('./disposable-postgres.cjs');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const { PaymentCryptoService } = require('../../src/payment/payment-crypto.service.ts');
const { OutboundIntentService } = require('../../src/communications/outbound-intent.service.ts');
const { CommunicationAttributionService } = require('../../src/communications/communication-attribution.service.ts');
const { messageRecipient } = require('../../src/communications/message-context.ts');
const { templateFingerprint } = require('../../src/templates/template-components.ts');
const { TemplateMappingService } = require('../../src/templates/template-mapping.service.ts');
const { TemplatePolicyService } = require('../../src/templates/template-policy.service.ts');
const { CompanyTemplateAccessService } = require('../../src/templates/company-template-access.service.ts');
const { TemplateContextService } = require('../../src/templates/template-context.service.ts');
const { PublicPaymentLinkService } = require('../../src/payment/payment-link.service.ts');
const { TemplatePendingService } = require('../../src/communications/template-pending.service.ts');
const { CommunicationTokenService } = require('../../src/communications/communication-token.service.ts');
const { OutboundDispatcherService } = require('../../src/whatsapp/outbound-dispatcher.service.ts');

const FRONTEND = 'https://app.ciframais.test';
const WABA = '333333333333333';
const settings = {
  FRONTEND_URL: FRONTEND, META_BUSINESS_ACCOUNT_ID: WABA, META_PHONE_NUMBER_ID: '222',
  PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ test: randomBytes(32).toString('hex') }), PAYMENT_ACTIVE_KEY_VERSION: 'test',
  JWT_SECRET: 'synthetic-harness-jwt-secret-with-32-plus-chars',
};
const config = new ConfigService(settings);
const crypto = new PaymentCryptoService(config);
const MAPPING = {
  body: { '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' }, '2': { kind: 'SOURCE', source: 'AMOUNT' } },
  paymentButton: { index: 0, source: 'PAYMENT_URL_SUFFIX' },
};
let phoneSeq = 0;

function services(prisma) {
  const policy = new TemplatePolicyService(config);
  const paymentLinks = new PublicPaymentLinkService(config, prisma);
  return {
    policy,
    paymentLinks,
    context: new TemplateContextService(prisma, crypto, paymentLinks),
    pending: new TemplatePendingService(prisma, policy),
    mappings: new TemplateMappingService(prisma, config),
    access: new CompanyTemplateAccessService(prisma, policy),
    intents: new OutboundIntentService(prisma, crypto, new CommunicationAttributionService(prisma)),
  };
}

async function tenant(prisma, label) {
  const company = await prisma.company.create({ data: { corporateName: label, tradeName: label, email: `${label}-${randomUUID()}@example.test`, phoneNumber: '5511999999999', document: randomUUID().replace(/-/g, '').slice(0, 14) } });
  const phone = `55119${String(60_000_000 + ++phoneSeq).padStart(8, '0')}`;
  const debtor = await prisma.debtor.create({ data: { companyId: company.id, name: `Devedor ${label}`, phoneNumber: phone, whatsappOptIn: true } });
  const invoice = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 150, dueDate: new Date('2026-10-05T12:00:00.000Z'), status: 'PENDING' } });
  return { company, debtor, invoice, phone };
}

async function readyTemplate(prisma, { providerId = String(800000 + Math.floor(Math.random() * 99999)) } = {}) {
  const components = [
    { type: 'BODY', text: 'Olá {{1}}, sua cobrança de {{2}} está disponível.' },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Pagar', url: `${FRONTEND}/pagar/{{1}}` }] },
  ];
  const input = { components, parameterFormat: 'POSITIONAL', language: 'pt_BR', category: 'UTILITY' };
  const template = await prisma.globalMessageTemplate.create({ data: {
    name: `cobranca_${providerId}`, slug: `meta-${WABA}-${providerId}`, content: components[0].text, origin: 'META_IMPORTED',
    providerAccountId: WABA, metaTemplateId: providerId, metaTemplateName: `cobranca_${providerId}`, metaLanguage: 'pt_BR',
    metaStatus: 'APPROVED', metaProviderCategory: 'UTILITY', metaComponents: components, parameterFormat: 'POSITIONAL',
    providerFingerprint: templateFingerprint(input), providerRevision: 1, policyVersion: 1,
  } });
  await services(prisma).mappings.save(template.id, 1, 0, MAPPING, randomUUID());
  return prisma.globalMessageTemplate.findUnique({ where: { id: template.id } });
}

async function grant(prisma, companyId, templateId, enabled = true) {
  const { access } = services(prisma);
  const current = await prisma.companyWhatsappTemplateGrant.findUnique({ where: { companyId_templateId: { companyId, templateId } } });
  return access.setGrant(companyId, templateId, enabled, current?.version ?? 0, randomUUID());
}

async function conversationFor(prisma, phone) {
  const recipient = messageRecipient({ type: 'PHONE', value: phone });
  return prisma.communicationConversation.upsert({
    where: { channel_recipientHash: { channel: 'WHATSAPP', recipientHash: recipient.hash } },
    create: { channel: 'WHATSAPP', recipientType: 'PHONE', recipientHash: recipient.hash, recipientEncrypted: crypto.encrypt(recipient.value), retentionExpiresAt: new Date(Date.now() + 365 * 86_400_000) },
    update: {},
  });
}

/** Reserves a prepared template intent pinned to the current policy decision. */
async function templateIntent(prisma, { fixture, template, logicalKey = `collection:${randomUUID()}`, generation = 0, state }) {
  const { policy, intents } = services(prisma);
  const request = {
    logicalKey, origin: 'COLLECTION', ruleStepId: undefined,
    context: { companyId: fixture.company.id, debtorId: fixture.debtor.id, invoiceId: fixture.invoice.id },
    selection: { mode: 'EXPLICIT', templateId: template.id },
  };
  const { context } = services(prisma);
  const decision = await prisma.$transaction(tx => policy.resolve(tx, fixture.company.id, request.selection));
  if (!decision.allowed) throw new Error(`fixture template not allowed: ${decision.code}`);
  const loaded = await context.load(request.context, request.origin, decision.template.mapping);
  const conversation = await conversationFor(prisma, fixture.phone);
  const reservation = await intents.reserve({
    idempotencyKey: generation ? `${logicalKey}#g${generation}` : logicalKey,
    conversationId: conversation.id, transport: 'DATAFY', transportChannelId: '222',
    recipient: { type: 'PHONE', value: fixture.phone },
    context: request.context, content: 'Olá Devedor, sua cobrança de R$ 150,00 está disponível.', messageType: 'template',
    payload: { companyId: fixture.company.id, invoiceId: fixture.invoice.id, debtorId: fixture.debtor.id, phoneNumber: fixture.phone, messageType: 'template', templateName: template.metaTemplateName, languageCode: 'pt_BR', bodyParameters: ['Devedor', 'R$ 150,00'], paymentButtonFromInvoice: true },
    retentionExpiresAt: new Date(Date.now() + 365 * 86_400_000),
    template: { logicalKey, generation, snapshot: decision.template.snapshot, contextFingerprint: loaded.contextFingerprint, context: { logicalKey, request } },
  });
  if (state) await prisma.communicationOutboundIntent.update({ where: { id: reservation.id }, data: { state, transmission: state === 'ACCEPTED' ? 'ACCEPTED' : state === 'UNCERTAIN' ? 'UNCERTAIN' : 'NOT_SENT', ...(state === 'ACCEPTED' ? { externalMessageId: `wamid.${randomUUID()}` } : {}) } });
  return { id: reservation.id, request, snapshot: decision.template.snapshot };
}

/** Real dispatcher over the disposable database; transport, queue and quotas are fakes. */
function dispatcher(prisma, behavior) {
  const { policy, pending, context, paymentLinks, intents } = services(prisma);
  const transport = { kind: 'DATAFY', calls: [],
    async sendText(input) { transport.calls.push(input); return { accepted: true, messageId: `wamid.${randomUUID()}`, status: 'accepted' }; },
    async sendTemplate(input) { transport.calls.push(input); return behavior ? behavior(input) : { accepted: true, messageId: `wamid.${randomUUID()}`, status: 'accepted' }; } };
  const rates = { checkRateLimit: async () => ({ allowed: true }) };
  const messaging = { reserveDispatchQuota: async () => undefined };
  const service = new OutboundDispatcherService(prisma, config, crypto, intents, transport, { addOutboundIntentJob: async () => undefined }, rates, messaging, new CommunicationTokenService(config), paymentLinks, policy, pending, context);
  return { service, transport, intents, pending, policy };
}

module.exports = {
  dispatcher, config, crypto, settings, services, tenant, readyTemplate, grant, templateIntent, conversationFor, MAPPING, FRONTEND, WABA };
