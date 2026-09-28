import { Prisma } from '@prisma/client';

/**
 * Lock order shared by catalog, grant, default and dispatch writers: templates by ID,
 * grants by (company, template), then the logical send key, then the intent. Every
 * writer takes the locks it needs in this order, so none of them can deadlock another.
 */
export async function lockTemplates(
  tx: Prisma.TransactionClient,
  templateIds: string[],
): Promise<void> {
  const ids = [...new Set(templateIds)].sort();
  if (!ids.length) return;
  await tx.$queryRaw`
    SELECT "id" FROM "GlobalMessageTemplate"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id" FOR UPDATE`;
}

export async function lockGrants(
  tx: Prisma.TransactionClient,
  companyId: string,
  templateIds: string[],
): Promise<void> {
  const ids = [...new Set(templateIds)].sort();
  if (!ids.length) return;
  await tx.$queryRaw`
    SELECT "id" FROM "CompanyWhatsappTemplateGrant"
    WHERE "companyId" = ${companyId} AND "templateId" IN (${Prisma.join(ids)})
    ORDER BY "templateId" FOR UPDATE`;
}

/** Serializes the logical send key even before any row exists for it. */
export async function lockLogicalKey(
  tx: Prisma.TransactionClient,
  logicalKey: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`template-send:${logicalKey}`}, 0))`;
}
