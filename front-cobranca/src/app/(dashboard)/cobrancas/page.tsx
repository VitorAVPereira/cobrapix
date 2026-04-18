"use client";

import { useState, useEffect, useMemo } from "react";
import { UploadCSV, ParsedDebtor } from "@/components/features/UploadCSV";
import { InvoiceTable } from "@/components/features/InvoiceTable";
import {
  Plus,
  RefreshCw,
  Users,
  DollarSign,
  AlertCircle,
  XCircle,
  Send,
  X,
  Search,
  FileSpreadsheet,
} from "lucide-react";

export default function CobrancasPage() {
  const [devedores, setDevedores] = useState<ParsedDebtor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isRunningBilling, setIsRunningBilling] = useState(false);
  const [billingResult, setBillingResult] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchInvoices = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/invoices");
      const data = await response.json();
      if (Array.isArray(data)) {
        setDevedores(data);
      }
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  const metricas = useMemo(() => {
    const total = devedores.length;
    const valorSoma = devedores.reduce(
      (acc, dev) => acc + dev.original_amount,
      0
    );

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const vencidas = devedores.filter((dev) => {
      if (dev.status === "PAID" || dev.status === "CANCELED") return false;
      const dataVencimento = new Date(`${dev.due_date}T12:00:00Z`);
      return dataVencimento < hoje;
    }).length;

    return { total, valorSoma, vencidas };
  }, [devedores]);

  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return devedores;
    const q = searchQuery.toLowerCase();
    return devedores.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.phone_number.includes(q) ||
        (d.email && d.email.toLowerCase().includes(q))
    );
  }, [devedores, searchQuery]);

  const handleRunBilling = async () => {
    setBillingResult(null);
    setIsRunningBilling(true);

    try {
      const res = await fetch("/api/billing/run", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setBillingResult({ message: data.error, isError: true });
        return;
      }

      setBillingResult({ message: data.message, isError: false });
    } catch {
      setBillingResult({
        message: "Falha de conexao ao executar cobranca.",
        isError: true,
      });
    } finally {
      setIsRunningBilling(false);
    }
  };

  const formatBRL = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Gerenciamento de Cobranças
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Visualize e gerencie as faturas ativas no seu sistema.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 sm:gap-3 shrink-0">
          <button
            onClick={fetchInvoices}
            className="p-2.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 bg-white"
            title="Atualizar dados"
          >
            <RefreshCw
              size={18}
              className={isLoading ? "animate-spin" : ""}
            />
          </button>

          <button
            onClick={handleRunBilling}
            disabled={isRunningBilling}
            className="bg-emerald-600 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 text-sm font-semibold hover:bg-emerald-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Disparar cobranças vencidas via WhatsApp"
          >
            <Send
              size={16}
              className={isRunningBilling ? "animate-pulse" : ""}
            />
            <span className="hidden sm:inline">
              {isRunningBilling ? "Executando..." : "Executar Cobrança"}
            </span>
          </button>

          <button
            onClick={() => setShowUpload(!showUpload)}
            className="bg-slate-900 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 text-sm font-semibold hover:bg-slate-800 transition-all shadow-sm"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">
              {showUpload ? "Ver Listagem" : "Nova Importação"}
            </span>
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6 mb-8">
        <div className="bg-white p-5 lg:p-6 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Users size={22} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Total de Faturas</p>
            <h3 className="text-2xl font-bold text-slate-900">
              {metricas.total}
            </h3>
          </div>
        </div>

        <div className="bg-white p-5 lg:p-6 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <DollarSign size={22} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Valor em Aberto</p>
            <h3 className="text-2xl font-bold text-slate-900">
              {formatBRL(metricas.valorSoma)}
            </h3>
          </div>
        </div>

        <div className="bg-white p-5 lg:p-6 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
            <AlertCircle size={22} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Faturas Vencidas</p>
            <h3 className="text-2xl font-bold text-slate-900">
              {metricas.vencidas}
            </h3>
            {metricas.vencidas > 0 && (
              <p className="text-xs text-rose-500 font-medium mt-0.5">
                Requer atenção
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Billing result banner */}
      {billingResult && (
        <div
          className={`mb-6 p-4 rounded-xl flex items-center justify-between ${
            billingResult.isError
              ? "bg-red-50 border border-red-200 text-red-700"
              : "bg-emerald-50 border border-emerald-200 text-emerald-700"
          }`}
        >
          <p className="text-sm font-medium">{billingResult.message}</p>
          <button
            onClick={() => setBillingResult(null)}
            className="p-1 hover:opacity-70 transition-opacity shrink-0 ml-4"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Upload area */}
      {showUpload || (devedores.length === 0 && !isLoading) ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 lg:p-8 mb-8">
          <h2 className="text-lg font-bold text-slate-900 mb-4">
            Importar Nova Planilha
          </h2>
          {importError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700 text-sm">
              <XCircle size={20} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Erro na importação</p>
                <p>{importError}</p>
              </div>
            </div>
          )}
          <UploadCSV
            onUploadSuccess={async (dados) => {
              setImportError(null);
              try {
                const res = await fetch("/api/invoices/import", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(dados),
                });

                if (res.ok) {
                  setShowUpload(false);
                  fetchInvoices();
                } else {
                  const body = await res.json();
                  const msg = body.details
                    ? body.details.join(" | ")
                    : body.error || "Erro desconhecido ao importar.";
                  setImportError(msg);
                }
              } catch {
                setImportError("Falha de conexão ao enviar os dados.");
              }
            }}
          />
        </div>
      ) : null}

      {/* Table area */}
      {isLoading ? (
        <div className="h-64 flex flex-col items-center justify-center text-slate-400">
          <RefreshCw size={36} className="animate-spin mb-4" />
          <p className="text-sm">Carregando cobranças...</p>
        </div>
      ) : devedores.length > 0 ? (
        <>
          {/* Search */}
          <div className="relative mb-4">
            <Search
              size={18}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome, telefone ou e-mail..."
              className="w-full sm:w-80 pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <InvoiceTable data={filteredData} />

          {searchQuery && filteredData.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">
              Nenhum resultado para &ldquo;{searchQuery}&rdquo;
            </div>
          )}
        </>
      ) : (
        !showUpload && (
          <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
            <div className="mx-auto w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <FileSpreadsheet size={28} className="text-slate-400" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-1">
              Nenhuma cobrança encontrada
            </h3>
            <p className="text-slate-500 text-sm mb-6 max-w-sm mx-auto">
              Importe uma planilha CSV com os dados dos devedores para começar.
            </p>
            <button
              onClick={() => setShowUpload(true)}
              className="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-800 transition-all inline-flex items-center gap-2"
            >
              <Plus size={18} />
              Nova Importação
            </button>
          </div>
        )
      )}
    </div>
  );
}
