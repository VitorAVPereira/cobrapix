"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useApiClient } from "@/lib/use-api-client";
import {
  QrCode,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Smartphone,
  RefreshCcw,
  LogOut,
  WifiOff,
} from "lucide-react";

type ConnectionStatus =
  | "LOADING"
  | "DISCONNECTED"
  | "GENERATING"
  | "SCAN_READY"
  | "CONNECTED"
  | "ERROR";

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
        if (data.state === "open") {
          stopPolling();
          setQrCode(null);
          setStatus("CONNECTED");
        }
      } catch {
        /* silent */
      }
    }, 3000);
  }, [stopPolling]);

  useEffect(() => {
    let cancelled = false;

    async function checkInitialStatus() {
      try {
        const data = await apiClient.getWhatsappStatus();
        if (cancelled) return;

        if (data.state === "open") {
          setStatus("CONNECTED");
        } else {
          setStatus("DISCONNECTED");
        }
      } catch {
        if (!cancelled) setStatus("DISCONNECTED");
      }
    }

    checkInitialStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleConnect = async () => {
    setErrorMsg(null);
    setStatus("GENERATING");

    try {
      const data = await apiClient.createWhatsappInstance();
      setQrCode(data.qrCode);
      setStatus("SCAN_READY");
      startPolling();
    } catch (error: any) {
      setErrorMsg(error.message || "Erro ao gerar QR code.");
      setStatus("ERROR");
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        "Deseja realmente desconectar o WhatsApp? O motor de cobrança será interrompido."
      )
    ) {
      return;
    }

    try {
      await apiClient.disconnectWhatsapp();
      stopPolling();
      setQrCode(null);
      setStatus("DISCONNECTED");
    } catch (error: any) {
      setErrorMsg(error.message || "Erro ao desconectar.");
      setStatus("ERROR");
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Configuração do WhatsApp
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Conecte o número da sua empresa para iniciar os disparos automáticos.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        {/* Status & QR Code */}
        <div className="bg-white p-6 lg:p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center min-h-[320px]">
          <div
            className="transition-all duration-300 ease-out flex flex-col items-center"
            key={status}
            style={{ animation: "fadeIn 0.3s ease-out" }}
          >
            {status === "LOADING" && (
              <div className="text-center">
                <Loader2
                  className="animate-spin text-slate-400 mx-auto mb-4"
                  size={36}
                />
                <p className="text-sm text-slate-500">
                  Verificando conexão...
                </p>
              </div>
            )}

            {status === "DISCONNECTED" && (
              <div className="text-center">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                  <Smartphone className="text-slate-400" size={28} />
                </div>
                <h3 className="font-bold text-slate-900 mb-1">
                  Pronto para conectar
                </h3>
                <p className="text-sm text-slate-500 mb-6 max-w-xs">
                  Seu WhatsApp ainda não está vinculado ao motor de cobrança.
                </p>
                <button
                  onClick={handleConnect}
                  className="bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-emerald-700 active:scale-[0.98] transition-all shadow-md"
                >
                  Gerar QR Code
                </button>
              </div>
            )}

            {status === "GENERATING" && (
              <div className="text-center">
                <Loader2
                  className="animate-spin text-emerald-500 mx-auto mb-4"
                  size={42}
                />
                <p className="font-medium text-slate-700">
                  Iniciando instância...
                </p>
                <p className="text-xs text-slate-400 mt-1.5">
                  Conectando à Evolution API.
                </p>
              </div>
            )}

            {status === "SCAN_READY" && qrCode && (
              <div className="text-center">
                <div className="p-3 bg-white border-[3px] border-emerald-500 rounded-2xl mb-4 inline-block shadow-lg shadow-emerald-500/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${qrCode}`}
                    alt="WhatsApp QR Code"
                    className="w-44 h-44"
                  />
                </div>
                <div className="flex items-center justify-center gap-2 text-emerald-600 font-bold mb-1 text-sm">
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
                <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={40} />
                </div>
                <h3 className="text-xl font-bold text-slate-900">
                  Conectado!
                </h3>
                <p className="text-sm text-slate-500 mt-1.5">
                  O motor de cobrança está ativo e monitorando.
                </p>
                <button
                  onClick={handleDisconnect}
                  className="mt-6 text-rose-600 text-sm font-semibold flex items-center gap-2 hover:underline mx-auto"
                >
                  <LogOut size={15} />
                  Desconectar Aparelho
                </button>
              </div>
            )}

            {status === "ERROR" && (
              <div className="text-center">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100">
                  <WifiOff className="text-red-400" size={28} />
                </div>
                <h3 className="font-bold text-slate-900 mb-1">
                  Falha na Conexão
                </h3>
                <p className="text-sm text-red-600 mb-6 max-w-xs">
                  {errorMsg}
                </p>
                <button
                  onClick={handleConnect}
                  className="bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-slate-800 active:scale-[0.98] transition-all shadow-md"
                >
                  Tentar Novamente
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-5">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2 text-sm">
              <QrCode size={18} className="text-emerald-600" />
              Como conectar?
            </h4>
            <ul className="space-y-3.5 text-sm text-slate-600">
              <li className="flex gap-3">
                <span className="flex-none w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-xs">
                  1
                </span>
                <span>Abra o WhatsApp no seu celular.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-none w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-xs">
                  2
                </span>
                <span>
                  Toque em <strong>Configurações</strong> ou{" "}
                  <strong>Menu</strong> e selecione{" "}
                  <strong>Aparelhos Conectados</strong>.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-none w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-xs">
                  3
                </span>
                <span>
                  Toque em <strong>Conectar um aparelho</strong> e aponte a
                  câmera para o QR Code.
                </span>
              </li>
            </ul>
          </div>

          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl">
            <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={18} />
            <p className="text-xs text-amber-800 leading-relaxed">
              <strong>Importante:</strong> Evite desconectar o celular da
              internet. O aparelho deve permanecer vinculado para que as
              cobranças saiam no horário.
            </p>
          </div>

          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
            <AlertCircle className="text-blue-600 shrink-0 mt-0.5" size={18} />
            <p className="text-xs text-blue-800 leading-relaxed">
              <strong>Requisito:</strong> A Evolution API deve estar rodando no
              Docker (porta 8080). Caso veja erros, verifique se o container
              está ativo.
            </p>
          </div>
        </div>
      </div>

      {/* CSS for fade animation */}
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
