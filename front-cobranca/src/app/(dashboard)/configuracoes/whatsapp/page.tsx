"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "@/lib/use-api-client";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  LogOut,
  QrCode,
  RefreshCcw,
  Smartphone,
  WifiOff,
} from "lucide-react";

type ConnectionStatus =
  | "LOADING"
  | "DISCONNECTED"
  | "GENERATING"
  | "SCAN_READY"
  | "CONNECTED"
  | "ERROR";

type BackendWhatsappStatus = {
  state?: string;
  dbStatus?: string;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isConnectedStatus(data: BackendWhatsappStatus): boolean {
  const state = data.state?.toLowerCase();
  const dbStatus = data.dbStatus?.toUpperCase();

  return (
    state === "open" ||
    state === "connected" ||
    dbStatus === "CONNECTED"
  );
}

export default function WhatsappConfigPage() {
  const apiClient = useApiClient();
  const [status, setStatus] = useState<ConnectionStatus>("LOADING");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const data = await apiClient.getWhatsappStatus();

        if (isConnectedStatus(data)) {
          stopPolling();
          setQrCode(null);
          setStatus("CONNECTED");
        }
      } catch {
        // Mantém o polling silencioso enquanto a instância termina de subir.
      }
    }, 3000);
  }, [apiClient, stopPolling]);

  useEffect(() => {
    let cancelled = false;

    async function checkInitialStatus() {
      try {
        const data = await apiClient.getWhatsappStatus();
        if (cancelled) {
          return;
        }

        setStatus(isConnectedStatus(data) ? "CONNECTED" : "DISCONNECTED");
      } catch {
        if (!cancelled) {
          setStatus("DISCONNECTED");
        }
      }
    }

    void checkInitialStatus();

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleConnect = async () => {
    setErrorMsg(null);
    setStatus("GENERATING");

    try {
      const data = await apiClient.createWhatsappInstance();

      if (isConnectedStatus(data)) {
        stopPolling();
        setQrCode(null);
        setStatus("CONNECTED");
        return;
      }

      if (!data.qrCode) {
        throw new Error(
          "O QR Code ainda não foi liberado pela Evolution API. Tente novamente em alguns segundos.",
        );
      }

      setQrCode(data.qrCode);
      setStatus("SCAN_READY");
      startPolling();
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error, "Erro ao gerar QR code."));
      setStatus("ERROR");
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        "Deseja realmente desconectar o WhatsApp? O motor de cobrança será interrompido.",
      )
    ) {
      return;
    }

    try {
      await apiClient.disconnectWhatsapp();
      stopPolling();
      setQrCode(null);
      setStatus("DISCONNECTED");
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error, "Erro ao desconectar."));
      setStatus("ERROR");
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Configuração do WhatsApp
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Conecte o número da sua empresa para iniciar os disparos automáticos.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
        <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
          <div
            className="flex flex-col items-center transition-all duration-300 ease-out"
            key={status}
            style={{ animation: "fadeIn 0.3s ease-out" }}
          >
            {status === "LOADING" && (
              <div className="text-center">
                <Loader2
                  className="mx-auto mb-4 animate-spin text-slate-400"
                  size={36}
                />
                <p className="text-sm text-slate-500">Verificando conexão...</p>
              </div>
            )}

            {status === "DISCONNECTED" && (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-slate-100 bg-slate-50">
                  <Smartphone className="text-slate-400" size={28} />
                </div>
                <h3 className="mb-1 font-bold text-slate-900">
                  Pronto para conectar
                </h3>
                <p className="mb-6 max-w-xs text-sm text-slate-500">
                  Seu WhatsApp ainda não está vinculado ao motor de cobrança.
                </p>
                <button
                  onClick={handleConnect}
                  className="rounded-xl bg-emerald-600 px-6 py-2.5 font-bold text-white shadow-md transition-all hover:bg-emerald-700 active:scale-[0.98]"
                >
                  Gerar QR Code
                </button>
              </div>
            )}

            {status === "GENERATING" && (
              <div className="text-center">
                <Loader2
                  className="mx-auto mb-4 animate-spin text-emerald-500"
                  size={42}
                />
                <p className="font-medium text-slate-700">
                  Iniciando instância...
                </p>
                <p className="mt-1.5 text-xs text-slate-400">
                  Conectando à Evolution API.
                </p>
              </div>
            )}

            {status === "SCAN_READY" && qrCode && (
              <div className="text-center">
                <div className="mb-4 inline-block rounded-2xl border-[3px] border-emerald-500 bg-white p-3 shadow-lg shadow-emerald-500/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${qrCode}`}
                    alt="WhatsApp QR Code"
                    className="h-44 w-44"
                  />
                </div>
                <div className="mb-1 flex items-center justify-center gap-2 text-sm font-bold text-emerald-600">
                  <RefreshCcw size={14} className="animate-spin" />
                  Aguardando leitura...
                </div>
                <p className="text-xs text-slate-400">
                  Escaneie o QR Code com o WhatsApp.
                </p>
              </div>
            )}

            {status === "CONNECTED" && (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <CheckCircle2 size={40} />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Conectado!</h3>
                <p className="mt-1.5 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-600">
                  Tudo pronto por aqui! Aproveite o sistema.
                </p>
                <button
                  onClick={handleDisconnect}
                  className="mx-auto mt-8 flex items-center gap-2 text-xs font-semibold text-slate-400 transition-colors hover:text-rose-600"
                >
                  <LogOut size={14} />
                  Desconectar aparelho
                </button>
              </div>
            )}

            {status === "ERROR" && (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-red-100 bg-red-50">
                  <WifiOff className="text-red-400" size={28} />
                </div>
                <h3 className="mb-1 font-bold text-slate-900">
                  Falha na conexão
                </h3>
                <p className="mb-6 max-w-xs text-sm text-red-600">{errorMsg}</p>
                <button
                  onClick={handleConnect}
                  className="rounded-xl bg-slate-900 px-6 py-2.5 font-bold text-white shadow-md transition-all hover:bg-slate-800 active:scale-[0.98]"
                >
                  Tentar novamente
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h4 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
              <QrCode size={18} className="text-emerald-600" />
              Como conectar?
            </h4>
            <ul className="space-y-3.5 text-sm text-slate-600">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                  1
                </span>
                <span>Abra o WhatsApp no seu celular.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                  2
                </span>
                <span>
                  Toque em <strong>Configurações</strong> ou <strong>Menu</strong>{" "}
                  e selecione <strong>Aparelhos conectados</strong>.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                  3
                </span>
                <span>
                  Toque em <strong>Conectar um aparelho</strong> e aponte a
                  câmera para o QR Code.
                </span>
              </li>
            </ul>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50 p-4">
            <AlertCircle className="mt-0.5 shrink-0 text-amber-600" size={18} />
            <p className="text-xs leading-relaxed text-amber-800">
              <strong>Importante:</strong> Evite desconectar o celular da
              internet. O aparelho deve permanecer vinculado para que as
              cobranças saiam no horário.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <AlertCircle className="mt-0.5 shrink-0 text-blue-600" size={18} />
            <p className="text-xs leading-relaxed text-blue-800">
              <strong>Requisito:</strong> A Evolution API deve estar rodando no
              Docker (porta 8080). Caso veja erros, verifique se o container
              está ativo.
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
