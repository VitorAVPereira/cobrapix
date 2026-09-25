'use strict';
// Invoked only by communications-postgres.cjs with its freshly owned database. Downloads are simulated.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { copyFile, mkdtemp, readFile, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ConfigService } = require('@nestjs/config');
const { CommunicationMediaService } = require('../src/communications/communication-media.service.ts');
const { WhatsappTransportError } = require('../src/whatsapp/transport/whatsapp-transport.error.ts');
const { messageRecipient } = require('../src/communications/message-context.ts');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('synthetic receipt image')]);
const PDF = Buffer.from('%PDF-1.7\nsynthetic receipt');

module.exports = async ({ prisma, crypto, companyA, companyB, adminId }) => {
  const root = await mkdtemp(join(tmpdir(), 'ciframais-media-harness-'));
  try {
    const phone = '5511976500001';
    const recipient = messageRecipient({ type: 'PHONE', value: phone });
    const retention = new Date(Date.now() + 365 * 86_400_000);
    const conversation = await prisma.communicationConversation.create({ data: { channel: 'WHATSAPP', recipientType: 'PHONE', recipientHash: recipient.hash, recipientEncrypted: crypto.encrypt(phone), retentionExpiresAt: retention } });
    const message = companyId => prisma.communicationMessage.create({ data: { conversationId: conversation.id, companyId, direction: 'INBOUND', content: '[image]', retentionExpiresAt: retention, source: 'LIVE' } });
    const [messageA, messageB] = [await message(companyA), await message(companyB)];
    const attachment = (messageId, externalMediaId, contentType) => prisma.communicationAttachment.create({ data: { messageId, externalMediaId, contentType, retentionExpiresAt: retention } });
    const attachmentA = await attachment(messageA.id, '9001', 'image/png');
    const attachmentB = await attachment(messageB.id, '9002', 'application/pdf');
    const fake = await attachment(messageA.id, '9003', 'application/pdf');
    const interrupted = await attachment(messageA.id, '9004', 'image/png');

    const downloads = new Map();
    const transport = { async downloadMedia(id) {
      downloads.set(id, (downloads.get(id) ?? 0) + 1);
      await sleep(100);
      if (id === '9001') return { bytes: PNG, contentType: 'image/png' };
      if (id === '9002') return { bytes: PDF, contentType: 'application/pdf' };
      if (id === '9003') return { bytes: Buffer.from('<html><script>steal()</script>'), contentType: 'application/pdf' };
      throw new WhatsappTransportError('conexao interrompida', 'TEMPORARY', 'NOT_SENT');
    } };
    const config = new ConfigService({ COMMUNICATION_MEDIA_DIR: root });
    const build = () => new CommunicationMediaService(prisma, config, crypto, transport);
    const [processA, processB] = [build(), build()];

    // Two API processes drain the same queue: each file is downloaded once.
    await Promise.all([processA.processPending(), processB.processPending()]);
    // Pending attachments from earlier harness stages are processed too; count this fixture's.
    assert.deepEqual(['9001', '9002', '9003', '9004'].map(id => downloads.get(id)), [1, 1, 1, 1]);
    const state = async id => prisma.communicationAttachment.findUnique({ where: { id } });
    assert.equal((await state(attachmentA.id)).state, 'READY');
    assert.equal((await state(attachmentB.id)).state, 'READY');
    assert.deepEqual(await state(fake.id).then(row => [row.state, row.errorCode, row.storageKey]), ['UNAVAILABLE', 'UNSUPPORTED_TYPE', null]);
    const retrying = await state(interrupted.id);
    assert.deepEqual([retrying.state, retrying.errorCode, retrying.attempts, retrying.leaseToken], ['PENDING', 'DOWNLOAD_FAILED', 1, null]);
    assert.ok(retrying.nextAttemptAt > new Date(), 'an interrupted download waits before retrying');
    await processA.processPending();
    assert.equal(downloads.get('9004'), 1, 'no retry before the backoff');
    const storedA = await state(attachmentA.id);
    const raw = await readFile(join(root, storedA.storageKey));
    assert.ok(!raw.includes(Buffer.from('synthetic receipt image')), 'the file is encrypted at rest');
    assert.match(storedA.storageKey, /^[0-9a-f]{2}\/[0-9a-f-]{36}\.bin$/);
    if (process.platform !== 'win32') assert.equal((await stat(join(root, storedA.storageKey))).mode & 0o777, 0o600);
    console.log('PASS media queue: one download per file across processes, encrypted at rest, fake type and interruption handled');

    // Authorization precedes storage access.
    let reads = 0;
    const readerOf = service => { const read = service.storage.read.bind(service.storage); service.storage.read = key => { reads++; return read(key); }; return service; };
    const reader = readerOf(build());
    const viewerA = { companyId: companyA, role: 'COMPANY_ADMIN' }, viewerB = { companyId: companyB, role: 'COMPANY_ADMIN' };
    const opened = await reader.openForViewer(viewerA, messageA.id, attachmentA.id);
    assert.deepEqual([opened.contentType, opened.disposition, opened.bytes.equals(PNG)], ['image/png', 'inline', true]);
    reads = 0;
    await assert.rejects(reader.openForViewer(viewerB, messageA.id, attachmentA.id), error => error.getStatus() === 404);
    await assert.rejects(reader.openForViewer(viewerA, messageB.id, attachmentB.id), error => error.getStatus() === 404);
    await assert.rejects(reader.openForViewer(viewerA, messageB.id, attachmentA.id), error => error.getStatus() === 404, 'attachment id bound to another message');
    await assert.rejects(reader.openForViewer(viewerA, messageA.id, fake.id), error => error.getStatus() === 422);
    await assert.rejects(reader.openForViewer(viewerA, messageA.id, interrupted.id), error => error.getStatus() === 409);
    assert.equal(reads, 0, 'denied or unavailable requests never reach the store');
    const pdf = await reader.openForViewer({ companyId: randomUUID(), role: 'PLATFORM_ADMIN' }, messageB.id, attachmentB.id);
    assert.deepEqual([pdf.contentType, pdf.disposition], ['application/pdf', 'attachment']);
    console.log('PASS attachment access: company A only its own, admin all, mismatched ids and pending/unavailable denied before storage');

    // A new process (container restart with the same volume) still serves the file.
    assert.ok((await build().openForViewer(viewerA, messageA.id, attachmentA.id)).bytes.equals(PNG));
    // A file moved onto another attachment does not decrypt: it is bound to its id.
    await copyFile(join(root, (await state(attachmentB.id)).storageKey), join(root, storedA.storageKey));
    await assert.rejects(build().openForViewer(viewerA, messageA.id, attachmentA.id), error => error.getStatus() === 422);
    assert.deepEqual(await state(attachmentA.id).then(row => [row.state, row.errorCode]), ['UNAVAILABLE', 'STORAGE_CORRUPTED']);
    console.log('PASS files survive a restart and a swapped file is detected, affecting only that attachment');

    // Retention: the file is removed, the message is kept.
    const { usedBytes } = await processA.usage();
    assert.equal(usedBytes, PDF.length, 'usage counts only served files');
    await prisma.communicationAttachment.update({ where: { id: attachmentB.id }, data: { retentionExpiresAt: new Date(Date.now() - 1000) } });
    assert.ok(await processA.purgeExpired() >= 1);
    const expired = await state(attachmentB.id);
    assert.deepEqual([expired.state, expired.storageKey], ['EXPIRED', null]);
    await assert.rejects(stat(join(root, `${attachmentB.id.slice(0, 2)}/${attachmentB.id}.bin`)), error => error.code === 'ENOENT');
    await assert.rejects(build().openForViewer({ companyId: companyB, role: 'COMPANY_ADMIN' }, messageB.id, attachmentB.id), error => error.getStatus() === 410);
    assert.ok(await prisma.communicationMessage.findUnique({ where: { id: messageB.id } }), 'the message survives its attachment');
    void adminId;
    console.log('PASS retention purge removes expired files and keeps the message');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};
