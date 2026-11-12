"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { CheckoutProduct, CheckoutSettings } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { errorCode } from "@/lib/disbursements";
import { checkoutLink } from "@/lib/checkout";
import { ProductForm, type ProductDraft } from "@/components/features/checkout/ProductForm";
import { CheckoutPreview } from "@/components/features/checkout/CheckoutPreview";
import { BumpsPanel } from "@/components/features/checkout/BumpsPanel";
import { OffersPanel } from "@/components/features/checkout/OffersPanel";
import {
  messageOf,
  NoticeText,
  secondaryButtonClass,
  type Notice,
  loadFailed,
} from "@/components/features/checkout/ui";

const CHANGED_ELSEWHERE: Notice = {
  error: true,
  text: "Este produto foi alterado em outra tela. Os dados foram recarregados.",
};

export default function CheckoutProductPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApiClient();
  const [product, setProduct] = useState<CheckoutProduct | null>(null);
  const [catalog, setCatalog] = useState<CheckoutProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [reload, setReload] = useState(0);
  const [toggling, setToggling] = useState(false);
  const [settings, setSettings] = useState<CheckoutSettings | null>(null);
  const [draft, setDraft] = useState<ProductDraft | null>(null);

  useEffect(() => {
    // The preview works without the settings (default look); a failure here never blocks editing.
    const controller = new AbortController();
    api
      .getCheckoutSettings(controller.signal)
      .then(setSettings)
      .catch(() => undefined);
    return () => controller.abort();
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.getCheckoutProduct(id, controller.signal),
      api.listCheckoutProducts(undefined, controller.signal),
    ])
      .then(([loaded, all]) => {
        setProduct(loaded);
        setCatalog(all);
      })
      .catch((caught: unknown) => {
        if (loadFailed(controller.signal, caught))
          setError(messageOf(caught, "Não foi possível carregar o produto."));
      });
    return () => controller.abort();
  }, [api, id, reload]);

  function reloadAfterConflict(): void {
    setNotice(CHANGED_ELSEWHERE);
    setReload((value) => value + 1);
  }

  async function toggleActive(current: CheckoutProduct) {
    setToggling(true);
    setNotice(null);
    try {
      setProduct(
        await api.setCheckoutProductActive(current.id, {
          expectedVersion: current.version,
          active: !current.active,
        }),
      );
    } catch (caught) {
      if (errorCode(caught) === "VERSION_CHANGED") reloadAfterConflict();
      else setNotice({ error: true, text: messageOf(caught, "Não foi possível alterar.") });
    } finally {
      setToggling(false);
    }
  }

  if (error)
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      </div>
    );
  if (!product)
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <Loader2 size={16} className="animate-spin" /> Carregando produto…
      </p>
    );

  return (
    <div className="mx-auto grid max-w-7xl gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
      <div className="min-w-0 space-y-6">
        <Link
          href="/checkout/produtos"
          className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline"
        >
          <ArrowLeft size={16} /> Produtos
        </Link>
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{product.name}</h1>
            <p className="text-sm text-slate-500">
              Link: {checkoutLink(product.slug)} {product.active ? "" : "· inativo"}
            </p>
          </div>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={toggling}
            onClick={() => void toggleActive(product)}
          >
            {product.active ? "Desativar produto" : "Ativar produto"}
          </button>
        </header>
        <NoticeText notice={notice} />

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <ProductForm
            // A new version (saved here or elsewhere) refills the form.
            key={product.version}
            product={product}
            submitLabel="Salvar produto"
            defaultColor={settings?.primaryColor}
            onDraftChange={setDraft}
            onSubmit={async (input) => {
              setNotice(null);
              try {
                setProduct(
                  await api.updateCheckoutProduct(product.id, {
                    ...input,
                    expectedVersion: product.version,
                  }),
                );
                setNotice({ error: false, text: "Produto salvo." });
              } catch (caught) {
                if (errorCode(caught) !== "VERSION_CHANGED") throw caught;
                reloadAfterConflict();
              }
            }}
          />
        </section>

        <BumpsPanel
          product={product}
          catalog={catalog}
          onChanged={setProduct}
          onConflict={() => setReload((value) => value + 1)}
        />

        <OffersPanel
          product={product}
          catalog={catalog}
          onChanged={setProduct}
          onConflict={() => setReload((value) => value + 1)}
        />
      </div>
      {draft && (
        <div className="xl:sticky xl:top-6">
          <CheckoutPreview draft={draft} bumps={product.bumps ?? []} catalog={catalog} settings={settings} />
        </div>
      )}
    </div>
  );
}
