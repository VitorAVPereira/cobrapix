"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import type { CheckoutAssetKind } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

export const inputClass =
  "h-11 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
export const buttonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300";
export const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export type Notice = { error: boolean; text: string } | null;

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  // The hint stays outside the label so it is not part of the field's name.
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        {label}
        {children}
      </label>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );
}

/**
 * A load failed for real: not a replaced request, and not the first one sent
 * before the session loaded (the screen loads again once it does).
 */
export function loadFailed(signal: AbortSignal, error: unknown): boolean {
  const data = (error as { data?: { code?: unknown } } | null)?.data;
  return !signal.aborted && data?.code !== "SESSION_NOT_READY";
}

export function NoticeText({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.error ? "alert" : "status"}
      className={`text-sm ${notice.error ? "text-red-600" : "text-emerald-700"}`}
    >
      {notice.text}
    </p>
  );
}

const MAX_IMAGE_BYTES = 1024 * 1024;

/** Uploads a PNG, JPEG or WebP and hands back its asset id. */
export function ImageUpload({
  label,
  kind,
  assetId,
  onChange,
}: {
  label: string;
  kind: CheckoutAssetKind;
  assetId: string | null;
  onChange: (assetId: string | null) => void;
}) {
  const api = useApiClient();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setError("A imagem pode ter no máximo 1 MB.");
      return;
    }
    setUploading(true);
    try {
      const asset = await api.uploadCheckoutAsset(kind, file);
      onChange(asset.id);
    } catch (caught) {
      setError(messageOf(caught, "Não foi possível enviar a imagem."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm font-medium text-slate-700">
      {label}
      <div className="flex items-center gap-3">
        {assetId ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API, not Next
          <img
            src={api.checkoutAssetUrl(assetId)}
            alt={label}
            className="h-16 w-16 rounded-md border border-slate-200 object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-slate-300 text-slate-400">
            <ImagePlus size={20} />
          </span>
        )}
        <label className={`${secondaryButtonClass} cursor-pointer`}>
          {uploading && <Loader2 size={16} className="animate-spin" />}
          {assetId ? "Trocar imagem" : "Enviar imagem"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label={`${label}: arquivo`}
            disabled={uploading}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
        </label>
        {assetId && (
          <button
            type="button"
            className="text-sm font-semibold text-slate-500 hover:text-red-600"
            onClick={() => onChange(null)}
          >
            Remover
          </button>
        )}
      </div>
      <span className="text-xs font-normal text-slate-500">PNG, JPEG ou WebP, até 1 MB.</span>
      {error && (
        <span role="alert" className="text-xs font-normal text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
