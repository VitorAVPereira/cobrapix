/**
 * Lógica de cobrança compartilhada entre:
 * - Gatilho manual (POST /api/billing/run)
 * - Vercel Cron (GET /api/cron/billing)
 *
 * Regras:
 * - Empresa precisa ter WhatsApp CONNECTED e whatsappInstanceId
 * - Só cobra faturas PENDING com dueDate <= fim de hoje
 * - Dedup: não reenvia se já existe CollectionLog WHATSAPP_SENT hoje
 * - Fallback: loga como SIMULATED se Evolution API falhar
 */

import type { Company } from "@prisma/client";
import { prisma } from "./prisma";
import { sendTextMessage } from "./evolution";
import { buildCollectionMessage } from "./message-templates";

export interface BillingSummary {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
}

type BillingContext = "manual" | "automatic";

/**
 * Executa cobrança para uma única empresa.
 * Assume que company já foi validada (CONNECTED + instanceId).
 */
export async function runBillingForCompany(
  company: Company,
  context: BillingContext = "manual"
): Promise<BillingSummary> {
  if (
    company.whatsappStatus !== "CONNECTED" ||
    !company.whatsappInstanceId
  ) {
    return { total: 0, sent: 0, failed: 0, skipped: 0 };
  }

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      companyId: company.id,
      status: "PENDING",
      dueDate: { lte: endOfToday },
    },
    include: {
      debtor: true,
      collectionLogs: {
        where: {
          createdAt: { gte: startOfToday },
          actionType: "WHATSAPP_SENT",
        },
      },
    },
  });

  const prefix = context === "automatic" ? "[AUTOMÁTICO] " : "";
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const invoice of overdueInvoices) {
    if (invoice.collectionLogs.length > 0) {
      skipped++;
      continue;
    }

    const message = buildCollectionMessage({
      debtorName: invoice.debtor.name,
      originalAmount: Number(invoice.originalAmount),
      dueDate: invoice.dueDate,
      companyName: company.corporateName,
    });

    const phone = invoice.debtor.phoneNumber.startsWith("55")
      ? invoice.debtor.phoneNumber
      : `55${invoice.debtor.phoneNumber}`;

    try {
      await sendTextMessage(company.whatsappInstanceId, phone, message);

      await prisma.collectionLog.create({
        data: {
          companyId: company.id,
          invoiceId: invoice.id,
          actionType: "WHATSAPP_SENT",
          description: `${prefix}Mensagem de cobrança enviada para ${invoice.debtor.name} (${phone})`,
          status: "SENT",
        },
      });

      sent++;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Erro desconhecido";

      await prisma.collectionLog.create({
        data: {
          companyId: company.id,
          invoiceId: invoice.id,
          actionType: "WHATSAPP_SENT",
          description: `${prefix}SIMULADO - Falha ao enviar para ${invoice.debtor.name}: ${errorMessage}`,
          status: "SIMULATED",
        },
      });

      failed++;
    }
  }

  return { total: overdueInvoices.length, sent, failed, skipped };
}

/**
 * Executa cobrança para todas as empresas com WhatsApp conectado.
 * Usado pelo Vercel Cron.
 */
export async function runBillingForAllCompanies(): Promise<{
  companiesProcessed: number;
  totals: BillingSummary;
}> {
  const companies = await prisma.company.findMany({
    where: {
      whatsappStatus: "CONNECTED",
      whatsappInstanceId: { not: null },
    },
  });

  const totals: BillingSummary = {
    total: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  for (const company of companies) {
    const result = await runBillingForCompany(company, "automatic");
    totals.total += result.total;
    totals.sent += result.sent;
    totals.failed += result.failed;
    totals.skipped += result.skipped;
  }

  return { companiesProcessed: companies.length, totals };
}
