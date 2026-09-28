'use strict';
// Only a fresh local Docker database; never use DATABASE_URL or DIRECT_URL.
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { startDisposablePostgres, migrate, migrationSql, root } = require('./support/disposable-postgres.cjs');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const { EmailTemplatesService } = require('../src/email/email-templates.service.ts');

const TARGET = '_collection_rule_email_templates';
const noMailer = {};
const noConfig = { get: () => undefined };

async function seed(pool) {
  const ids = {
    companyId: randomUUID(), whatsappId: randomUUID(), orphanWhatsappId: randomUUID(), emailId: randomUUID(),
    profileId: randomUUID(), emailStepId: randomUUID(), whatsappStepId: randomUUID(), defaultEmailStepId: randomUUID(),
    orphanStepId: randomUUID(), debtorId: randomUUID(), invoiceId: randomUUID(), attemptId: randomUUID(),
  };
  await pool.query('INSERT INTO "Company" ("id","corporateName","email","phoneNumber","document","updatedAt") VALUES ($1,\'Tenant\',\'tenant@example.test\',\'5511999999999\',\'12345678000190\',NOW())', [ids.companyId]);
  await pool.query('INSERT INTO "GlobalMessageTemplate" ("id","name","slug","content","updatedAt") VALUES ($1,\'WA\',\'pre-vencimento\',\'WhatsApp text\',NOW()),($2,\'Orphan\',\'tenant-only\',\'Orphan\',NOW())', [ids.whatsappId, ids.orphanWhatsappId]);
  await pool.query('INSERT INTO "GlobalEmailTemplate" ("id","name","slug","subject","content","updatedAt") VALUES ($1,\'Mail\',\'pre-vencimento\',\'{{nome_empresa}}: lembrete\',\'{{saudacao}}, {{nome_devedor}}. {{instrucoes}} {{assinatura}}\',NOW())', [ids.emailId]);
  await pool.query('INSERT INTO "CompanyTemplatePreference" ("id","companyId","channel","slug","greeting","signature","globalEmailTemplateId","updatedAt") VALUES ($1,$2,\'EMAIL\',\'pre-vencimento\',\'Oi\',\'Financeiro Tenant\',$3,NOW())', [randomUUID(), ids.companyId, ids.emailId]);
  await pool.query('INSERT INTO "CollectionProfile" ("id","companyId","name","profileType","updatedAt") VALUES ($1,$2,\'Custom\',\'NEW\',NOW())', [ids.profileId, ids.companyId]);
  const step = 'INSERT INTO "CollectionRuleStep" ("id","profileId","stepOrder","channel","templateId","delayDays","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW())';
  await pool.query(step, [ids.emailStepId, ids.profileId, 0, 'EMAIL', ids.whatsappId, -30]);
  await pool.query(step, [ids.whatsappStepId, ids.profileId, 1, 'WHATSAPP', ids.whatsappId, 28]);
  await pool.query(step, [ids.defaultEmailStepId, ids.profileId, 2, 'EMAIL', null, 2]);
  await pool.query(step, [ids.orphanStepId, ids.profileId, 3, 'EMAIL', ids.orphanWhatsappId, 5]);
  await pool.query('INSERT INTO "Debtor" ("id","companyId","name","phoneNumber","collectionProfileId","updatedAt") VALUES ($1,$2,\'Maria\',\'5511999999999\',$3,NOW())', [ids.debtorId, ids.companyId, ids.profileId]);
  await pool.query('INSERT INTO "Invoice" ("id","companyId","debtorId","originalAmount","dueDate","updatedAt") VALUES ($1,$2,$3,150,NOW(),NOW())', [ids.invoiceId, ids.companyId, ids.debtorId]);
  await pool.query('INSERT INTO "CollectionAttempt" ("id","companyId","invoiceId","ruleStepId","channel","status") VALUES ($1,$2,$3,$4,\'WHATSAPP\',\'SENT\')', [ids.attemptId, ids.companyId, ids.invoiceId, ids.whatsappStepId]);
  return ids;
}

const stepShape = 'SELECT "id","stepOrder","channel","delayDays","isActive" FROM "CollectionRuleStep" WHERE "profileId"=$1 ORDER BY "stepOrder"';
const render = template => ({ subject: template.subject, content: template.content, greeting: template.greeting, instructions: template.instructions, signature: template.signature });

(async () => {
  const db = await startDisposablePostgres('email-migration');
  let prisma;
  try {
    const { target, all } = await migrate(db.pool, { until: TARGET });
    assert.ok(target, 'migration under test exists');
    const ids = await seed(db.pool);
    prisma = new PrismaClient({ adapter: new PrismaPg(db.pool) });
    const email = new EmailTemplatesService(prisma, noMailer, noConfig);
    // What the old resolver effectively used: the WhatsApp slug looked up in the email catalog.
    const before = {
      effectiveEmailTemplateId: (await email.findActiveOrDefault(ids.companyId, 'pre-vencimento')).id,
      renderedEmail: render(await email.findActiveOrDefault(ids.companyId, 'pre-vencimento')),
      renderedDefault: render(await email.findActiveOrDefault(ids.companyId, null)),
      attempts: (await db.pool.query('SELECT * FROM "CollectionAttempt" ORDER BY "id"')).rows,
      stepIdsAndDelays: (await db.pool.query(stepShape, [ids.profileId])).rows,
    };
    assert.equal(before.effectiveEmailTemplateId, ids.emailId);

    // An EMAIL reference without a matching email template stops the migration, untouched.
    const client = await db.pool.connect();
    try {
      await assert.rejects(client.query(migrationSql(target)), error => /sem template de e-mail correspondente/.test(error.message) && error.message.includes(ids.orphanStepId));
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    const columns = await db.pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=\'CollectionRuleStep\' AND column_name=\'emailTemplateId\'');
    assert.equal(columns.rowCount, 0, 'failed conversion rolled back the new column');
    assert.equal((await db.pool.query('SELECT "templateId" FROM "CollectionRuleStep" WHERE "id"=$1', [ids.emailStepId])).rows[0].templateId, ids.whatsappId);
    console.log('PASS unmapped EMAIL reference aborts the conversion with a diagnostic and rolls back');

    await db.pool.query('UPDATE "CollectionRuleStep" SET "templateId"=$2 WHERE "id"=$1', [ids.orphanStepId, ids.whatsappId]);
    await db.pool.query(migrationSql(target));
    await migrate(db.pool, { after: TARGET });

    const row = id => db.pool.query('SELECT "templateId","emailTemplateId" FROM "CollectionRuleStep" WHERE "id"=$1', [id]).then(result => result.rows[0]);
    const after = {
      emailStep: await row(ids.emailStepId),
      whatsappStep: await row(ids.whatsappStepId),
      defaultStep: await row(ids.defaultEmailStepId),
      attempts: (await db.pool.query('SELECT * FROM "CollectionAttempt" ORDER BY "id"')).rows,
      stepIdsAndDelays: (await db.pool.query(stepShape, [ids.profileId])).rows,
    };
    after.renderedEmail = render(await email.resolveForRule(ids.companyId, after.emailStep.emailTemplateId));
    after.renderedDefault = render(await email.resolveForRule(ids.companyId, after.defaultStep.emailTemplateId));
    assert.equal(after.emailStep.emailTemplateId, before.effectiveEmailTemplateId);
    assert.equal(after.emailStep.templateId, null);
    assert.equal(after.defaultStep.emailTemplateId, null, 'default selection stays default');
    assert.equal(after.whatsappStep.templateId, ids.whatsappId);
    assert.equal(after.whatsappStep.emailTemplateId, null);
    assert.deepEqual(after.attempts, before.attempts);
    assert.deepEqual(after.stepIdsAndDelays, before.stepIdsAndDelays);
    assert.deepEqual(after.renderedEmail, before.renderedEmail);
    assert.deepEqual(after.renderedDefault, before.renderedDefault);
    console.log('PASS EMAIL steps keep the effective template, calendar and attempts');

    await assert.rejects(db.pool.query('UPDATE "CollectionRuleStep" SET "templateId"=$2 WHERE "id"=$1', [ids.defaultEmailStepId, ids.whatsappId]), /CollectionRuleStep_channel_template_check/);
    await assert.rejects(db.pool.query('UPDATE "CollectionRuleStep" SET "emailTemplateId"=$2 WHERE "id"=$1', [ids.whatsappStepId, ids.emailId]), /CollectionRuleStep_channel_template_check/);
    await assert.rejects(email.resolveForRule(ids.companyId, randomUUID()), error => error.getStatus() === 404);
    await db.pool.query('UPDATE "GlobalEmailTemplate" SET "isActive"=false WHERE "id"=$1', [ids.emailId]);
    await assert.rejects(email.resolveForRule(ids.companyId, ids.emailId), error => error.getStatus() === 404);
    console.log('PASS channel CHECK and explicit email IDs are enforced');
    console.log(`PASS email rule templates on PostgreSQL 16 with ${all.length} migrations`);
  } finally {
    if (prisma) await prisma.$disconnect();
    await db.pool.end();
    db.stop();
  }
})().catch(error => { console.error(error.code ? `${error.code}: ${error.message}` : error.stack); process.exitCode = 1; });
