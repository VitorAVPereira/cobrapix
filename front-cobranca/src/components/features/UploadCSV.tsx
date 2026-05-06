"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import { AlertCircle, Download, FileType, UploadCloud } from "lucide-react";
import type { CollectionProfileType } from "@/lib/api-client";
import { normalizeWhatsAppNumber } from "@/lib/whatsapp-number";

export type PaymentMethod = "PIX" | "BOLETO" | "BOLIX";

export interface ParsedDebtor {
  id?: string;
  invoiceId?: string;
  name: string;
  document?: string;
  phone_number: string;
  email?: string;
  original_amount: number;
  due_date: string;
  billing_type?: PaymentMethod;
  status?: string;
  debtorId?: string;
  whatsapp_opt_in?: boolean;
  studentName?: string | null;
  studentEnrollment?: string | null;
  studentGroup?: string | null;
  paidAt?: string | null;
  payment?: {
    generated: boolean;
    method: PaymentMethod;
    pixCopyPaste: string | null;
    boletoLine: string | null;
    boletoUrl: string | null;
    boletoPdf: string | null;
    paymentLink: string | null;
    expiresAt: string | null;
  };
  recurrence?: {
    recurrenceId: string;
    period: string;
    dueDay: number;
    status: "ACTIVE" | "PAUSED";
  };
  collectionProfile?: {
    id: string;
    name: string;
    profileType: CollectionProfileType;
  } | null;
}

interface UploadCSVProps {
  onUploadSuccess: (data: ParsedDebtor[]) => void;
  showEducationFields?: boolean;
}

function normalizePaymentMethod(value: string): PaymentMethod | null {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  if (normalized === "PIX") {
    return "PIX";
  }

  if (normalized === "BOLETO") {
    return "BOLETO";
  }

  if (normalized === "BOLIX") {
    return "BOLIX";
  }

  return null;
}

export function UploadCSV({
  onUploadSuccess,
  showEducationFields = false,
}: UploadCSVProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadTemplate = (): void => {
    const templateContent = showEducationFields
      ? "Nome,WhatsApp,Email,Valor,Vencimento,Forma de Pagamento,Opt-in WhatsApp,Aluno,Matricula,Turma/Curso\nResponsavel Silva,+5511999999999,responsavel@email.com,150.50,2026-12-01,BOLIX,SIM,Joao Silva,2026-001,7A"
      : "Nome,WhatsApp,Email,Valor,Vencimento,Forma de Pagamento,Opt-in WhatsApp\nJoao Silva,+5511999999999,joao@email.com,150.50,2026-12-01,BOLIX,SIM";
    const blob = new Blob([templateContent], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "modelo_cobrapix.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      setError(null);
      setIsProcessing(true);

      const file = acceptedFiles[0];
      if (!file) {
        setIsProcessing(false);
        return;
      }

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const rawData = results.data as Record<string, string>[];

            const validData: ParsedDebtor[] = rawData.map((row, index) => {
              const nome = row.Nome?.trim() || row.nome?.trim();
              let zap =
                row.WhatsApp?.trim() ||
                row.whatsapp?.trim() ||
                row.telefone?.trim();
              const emailRaw = row.Email?.trim() || row.email?.trim() || "";
              const valorRaw = row.Valor?.trim() || row.valor?.trim();
              const vencimento =
                row.Vencimento?.trim() || row.vencimento?.trim();
              const formaPagamentoRaw =
                row["Forma de Pagamento"]?.trim() ||
                row.forma_de_pagamento?.trim() ||
                row.formaPagamento?.trim() ||
                row.pagamento?.trim() ||
                row.billing_type?.trim() ||
                "";
              const optInRaw =
                row["Opt-in WhatsApp"]?.trim() ||
                row.opt_in_whatsapp?.trim() ||
                row.whatsapp_opt_in?.trim() ||
                "";
              const studentName =
                row.Aluno?.trim() ||
                row.aluno?.trim() ||
                row.studentName?.trim() ||
                row.student_name?.trim() ||
                "";
              const studentEnrollment =
                row.Matricula?.trim() ||
                row.matricula?.trim() ||
                row.studentEnrollment?.trim() ||
                row.student_enrollment?.trim() ||
                "";
              const studentGroup =
                row["Turma/Curso"]?.trim() ||
                row.Turma?.trim() ||
                row.turma?.trim() ||
                row.Curso?.trim() ||
                row.curso?.trim() ||
                row.studentGroup?.trim() ||
                row.student_group?.trim() ||
                "";

              if (!nome || !zap || !emailRaw || !valorRaw || !vencimento) {
                throw new Error(
                  `Linha ${index + 2}: Faltam dados obrigatorios. Verifique as colunas.`,
                );
              }

              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
                throw new Error(
                  `Linha ${index + 2}: O email de ${nome} parece invalido (${emailRaw}).`,
                );
              }

              try {
                zap = normalizeWhatsAppNumber(zap);
              } catch {
                throw new Error(
                  `Linha ${index + 2}: O WhatsApp de ${nome} parece invalido (${zap}).`,
                );
              }

              const valorNumerico = parseFloat(valorRaw.replace(",", "."));
              if (isNaN(valorNumerico)) {
                throw new Error(
                  `Linha ${index + 2}: O valor de ${nome} nao e um numero valido.`,
                );
              }

              const formaPagamento = normalizePaymentMethod(formaPagamentoRaw);
              if (!formaPagamento) {
                throw new Error(
                  `Linha ${index + 2}: Forma de pagamento invalida. Use PIX, BOLETO ou BOLIX.`,
                );
              }

              return {
                name: nome,
                phone_number: zap,
                email: emailRaw,
                original_amount: valorNumerico,
                due_date: vencimento,
                billing_type: formaPagamento,
                whatsapp_opt_in: ["SIM", "TRUE", "1", "YES"].includes(
                  optInRaw.toUpperCase(),
                ),
                studentName: studentName || undefined,
                studentEnrollment: studentEnrollment || undefined,
                studentGroup: studentGroup || undefined,
              };
            });

            onUploadSuccess(validData);
            setIsProcessing(false);
          } catch (err: unknown) {
            setError(
              err instanceof Error
                ? err.message
                : "Ocorreu um erro desconhecido ao processar os dados.",
            );
            setIsProcessing(false);
          }
        },
        error: () => {
          setError(
            "Erro ao ler o arquivo CSV. Tente salvar novamente pelo Excel.",
          );
          setIsProcessing(false);
        },
      });
    },
    [onUploadSuccess],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".csv"],
    },
    multiple: false,
  });

  return (
    <div className="w-full">
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={downloadTemplate}
          className="flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-emerald-600"
        >
          <Download size={16} />
          Baixar Planilha Padrao
        </button>
      </div>

      <div
        {...getRootProps()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition-colors
          ${isDragActive ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}
          ${error ? "border-red-400 bg-red-50" : ""}
        `}
      >
        <input {...getInputProps()} />

        {isProcessing ? (
          <div className="flex animate-pulse flex-col items-center">
            <FileType className="mb-4 h-12 w-12 animate-bounce text-emerald-500" />
            <p className="font-medium text-slate-600">
              Lendo e validando planilha...
            </p>
          </div>
        ) : (
          <>
            <div
              className={`mb-4 rounded-full p-4 ${error ? "bg-red-100 text-red-500" : "bg-slate-100 text-slate-500"}`}
            >
              {error ? <AlertCircle size={32} /> : <UploadCloud size={32} />}
            </div>
            <h3 className="mb-1 text-lg font-medium text-slate-900">
              {isDragActive ? "Pode soltar!" : "Arraste sua planilha CSV aqui"}
            </h3>
            <p className="mx-auto mb-6 max-w-xs text-slate-500">
              Ou clique para procurar no seu computador. Formato aceito: .csv
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
