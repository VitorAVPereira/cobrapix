"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import { UploadCloud, FileType, AlertCircle, Download } from "lucide-react"; // Removido o import não utilizado

export interface ParsedDebtor {
  name: string;
  phone_number: string;
  email?: string;
  original_amount: number;
  due_date: string;
  status?: string; // Populated when loaded from API (PENDING, PAID, CANCELED)
}

interface UploadCSVProps {
  onUploadSuccess: (data: ParsedDebtor[]) => void;
}

export function UploadCSV({ onUploadSuccess }: UploadCSVProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadTemplate = () => {
    const templateContent =
      "Nome,WhatsApp,Email,Valor,Vencimento\nJoão Silva,5511999999999,joao@email.com,150.50,2025-12-01";
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
            // Correção do TypeScript: Avisando que 'results.data' é um array de objetos de texto
            const rawData = results.data as Record<string, string>[];

            const validData: ParsedDebtor[] = rawData.map((row, index) => {
              const nome = row["Nome"]?.trim() || row["nome"]?.trim();
              let zap =
                row["WhatsApp"]?.trim() ||
                row["whatsapp"]?.trim() ||
                row["telefone"]?.trim();
              const emailRaw =
                row["Email"]?.trim() || row["email"]?.trim() || ""; // Captura o email
              const valorRaw = row["Valor"]?.trim() || row["valor"]?.trim();
              const vencimento =
                row["Vencimento"]?.trim() || row["vencimento"]?.trim();

              if (!nome || !zap || !valorRaw || !vencimento) {
                throw new Error(
                  `Linha ${index + 2}: Faltam dados obrigatórios. Verifique as colunas.`,
                );
              }

              // Validação simples de E-mail (se ele existir na planilha)
              if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
                throw new Error(
                  `Linha ${index + 2}: O e-mail de ${nome} parece inválido (${emailRaw}).`,
                );
              }

              zap = zap.replace(/\D/g, "");
              if (zap.length < 10) {
                throw new Error(
                  `Linha ${index + 2}: O WhatsApp de ${nome} parece inválido (${zap}).`,
                );
              }

              const valorNumerico = parseFloat(valorRaw.replace(",", "."));
              if (isNaN(valorNumerico)) {
                throw new Error(
                  `Linha ${index + 2}: O valor de ${nome} não é um número válido.`,
                );
              }

              return {
                name: nome,
                phone_number: zap,
                email: emailRaw,
                original_amount: valorNumerico,
                due_date: vencimento,
              };
            });

            onUploadSuccess(validData);
            setIsProcessing(false);

            // Correção do TypeScript no Catch
          } catch (err: unknown) {
            if (err instanceof Error) {
              setError(err.message);
            } else {
              setError("Ocorreu um erro desconhecido ao processar os dados.");
            }
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
      <div className="flex justify-end mb-4">
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-600 transition-colors"
        >
          <Download size={16} />
          Baixar Planilha Padrão
        </button>
      </div>

      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-colors
          ${isDragActive ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300"}
          ${error ? "border-red-400 bg-red-50" : ""}
        `}
      >
        <input {...getInputProps()} />

        {isProcessing ? (
          <div className="animate-pulse flex flex-col items-center">
            <FileType className="text-emerald-500 w-12 h-12 mb-4 animate-bounce" />
            <p className="text-slate-600 font-medium">
              Lendo e validando planilha...
            </p>
          </div>
        ) : (
          <>
            <div
              className={`p-4 rounded-full mb-4 ${error ? "bg-red-100 text-red-500" : "bg-slate-100 text-slate-500"}`}
            >
              {error ? <AlertCircle size={32} /> : <UploadCloud size={32} />}
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-1">
              {isDragActive ? "Pode soltar!" : "Arraste sua planilha CSV aqui"}
            </h3>
            <p className="text-slate-500 max-w-xs mx-auto mb-6">
              Ou clique para procurar no seu computador. Formato aceito: .csv
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700 text-sm">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
