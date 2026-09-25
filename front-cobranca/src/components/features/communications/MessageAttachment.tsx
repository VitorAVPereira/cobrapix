"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ApiError, MessageAttachmentSummary } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { isAbort } from "./format";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const UNAVAILABLE_REASONS: Record<string, string> = {
  FILE_TOO_LARGE: "o arquivo passa de 16 MiB",
  UNSUPPORTED_TYPE: "tipo de arquivo não suportado",
  TYPE_MISMATCH: "o conteúdo não corresponde ao tipo informado",
  PROVIDER_MEDIA_EXPIRED: "o arquivo expirou no provedor antes do download",
  DOWNLOAD_FAILED: "não foi possível baixar o arquivo",
  STORAGE_LIMIT_REACHED: "limite de armazenamento atingido",
  STORAGE_FAILED: "falha ao armazenar o arquivo",
  STORAGE_MISSING: "arquivo não encontrado no armazenamento",
  STORAGE_CORRUPTED: "arquivo armazenado inválido",
  MEDIA_REFERENCE_MISSING: "referência do arquivo ausente",
};

const STATUS_MESSAGES: Record<number, string> = {
  404: "Anexo não encontrado.",
  409: "Anexo ainda em processamento.",
  410: "Anexo expirado pelo prazo de retenção.",
  422: "Anexo indisponível.",
};

function size(bytes: number | null): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024
    ? ` · ${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
    : ` · ${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Loads an attachment on demand through the authenticated API. Images and audio are
 * shown inline; PDF is only offered as a download; any other type is refused, so
 * HTML/SVG are never rendered. Failures affect the attachment, never the message.
 */
export function MessageAttachment({
  messageId,
  attachment,
}: {
  messageId: string;
  attachment: MessageAttachmentSummary;
}): ReactNode {
  const api = useApiClient();
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
      if (file) URL.revokeObjectURL(file.url);
    },
    [file],
  );

  async function load(): Promise<void> {
    controller.current?.abort();
    controller.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const blob = await api.fetchAttachment(
        messageId,
        attachment.id,
        controller.current.signal,
      );
      const type = blob.type.split(";")[0]?.trim().toLowerCase() ?? "";
      if (
        !IMAGE_TYPES.has(type) &&
        !type.startsWith("audio/") &&
        type !== "application/pdf"
      ) {
        setError("Tipo de arquivo não suportado para exibição.");
        return;
      }
      setFile({ url: URL.createObjectURL(blob), type });
    } catch (caught: unknown) {
      if (isAbort(caught)) return;
      const status = (caught as ApiError).status;
      setError(
        (status ? STATUS_MESSAGES[status] : undefined) ??
          "Não foi possível carregar o anexo.",
      );
    } finally {
      setLoading(false);
    }
  }

  const description = `${attachment.contentType ?? "sem tipo informado"}${size(attachment.sizeBytes)}`;
  const label = `Anexo ${description}`;
  if (attachment.state === "PENDING")
    return <p className="mt-2 text-xs text-slate-600">{label} · em processamento</p>;
  if (attachment.state === "EXPIRED")
    return (
      <p className="mt-2 text-xs text-slate-600">
        {label} · expirado pelo prazo de retenção
      </p>
    );
  if (attachment.state === "UNAVAILABLE")
    return (
      <p className="mt-2 text-xs text-amber-800">
        {label} · indisponível
        {attachment.errorCode && UNAVAILABLE_REASONS[attachment.errorCode]
          ? `: ${UNAVAILABLE_REASONS[attachment.errorCode]}`
          : ""}
      </p>
    );
  return (
    <div className="mt-2 space-y-2 text-xs">
      {!file && (
        <button
          className="rounded border px-2 py-1 disabled:opacity-50"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Carregando anexo…" : `Ver anexo ${description}`}
        </button>
      )}
      {file && IMAGE_TYPES.has(file.type) && (
        // Object URL of a validated image; next/image cannot load blob URLs.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.url}
          alt="Imagem anexada à mensagem"
          className="max-h-64 rounded border"
        />
      )}
      {file?.type.startsWith("audio/") && (
        <audio controls src={file.url} aria-label="Áudio anexado à mensagem" />
      )}
      {file?.type === "application/pdf" && (
        <a
          href={file.url}
          download={`anexo-${attachment.id.slice(0, 8)}.pdf`}
          className="font-medium text-indigo-700 underline"
        >
          Baixar PDF
        </a>
      )}
      {error && <p className="text-red-700">{error}</p>}
    </div>
  );
}
