"use client";

import type { CheckoutBump, CheckoutProduct, CheckoutSettings } from "@/lib/api-client";
import type { PublicCheckoutProduct } from "@/lib/checkout-public";
import { CheckoutForm } from "@/components/checkout-public/CheckoutForm";
import { CheckoutShell } from "@/components/checkout-public/CheckoutShell";
import type { ProductDraft } from "./ProductForm";

const assetPath = (id: string | null | undefined) => (id ? `/checkout/public/assets/${encodeURIComponent(id)}` : null);

/**
 * The payment page as the buyer will see it, built from what the seller is
 * typing (product) and what is saved (bumps, settings). Nothing here calls the
 * public API or is saved.
 */
export function previewData(
  draft: ProductDraft,
  bumps: CheckoutBump[],
  catalog: CheckoutProduct[],
  settings: CheckoutSettings | null,
): PublicCheckoutProduct {
  return {
    available: true,
    unavailableMessage: null,
    product: {
      slug: "previa",
      name: draft.name || "Nome do produto",
      description: draft.description,
      priceCents: draft.priceCents ?? 0,
      compareAtPriceCents: draft.compareAtPriceCents,
      imageUrl: assetPath(draft.imageAssetId),
      accessPeriodMonths: draft.accessPeriodMonths,
    },
    bumps: bumps
      .filter((bump) => bump.active && bump.offeredProduct.active)
      .sort((a, b) => a.position - b.position)
      .map((bump) => {
        const offered = catalog.find((item) => item.id === bump.offeredProductId);
        return {
          id: bump.id,
          name: bump.offeredProduct.name,
          headline: bump.headline,
          callToAction: bump.callToAction,
          description: bump.description ?? offered?.description ?? null,
          priceCents: bump.priceCents,
          compareAtPriceCents: bump.compareAtPriceCents,
          imageUrl: assetPath(offered?.imageAssetId),
          accessPeriodMonths: offered?.accessPeriodMonths ?? null,
        };
      }),
    page: {
      displayName: settings?.displayName ?? "",
      logoUrl: assetPath(draft.logoAssetId ?? settings?.logoAssetId),
      bannerUrl: assetPath(draft.bannerAssetId ?? settings?.bannerAssetId),
      primaryColor: draft.primaryColor ?? settings?.primaryColor ?? "#0F766E",
      supportEmail: settings?.supportEmail ?? null,
      supportWhatsapp: settings?.supportWhatsapp ?? null,
      // The floating button would cover the seller's screen.
      whatsappButtonPhone: null,
    },
    payment: {
      pixEnabled: settings?.pixEnabled ?? true,
      cardEnabled: settings?.cardEnabled ?? false,
      maxInstallments: null,
    },
  };
}

export function CheckoutPreview({
  draft,
  bumps,
  catalog,
  settings,
}: {
  draft: ProductDraft;
  bumps: CheckoutBump[];
  catalog: CheckoutProduct[];
  settings: CheckoutSettings | null;
}) {
  const data = previewData(draft, bumps, catalog, settings);
  return (
    <aside aria-label="Prévia da página de pagamento" className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Prévia da página de pagamento</h2>
        <p className="text-xs text-slate-500">
          Muda enquanto você edita; o comprador só vê depois de salvar. Order bumps aparecem como estão salvos.
        </p>
      </div>
      <div className="overflow-y-auto rounded-xl border border-slate-200 xl:max-h-[calc(100vh-8rem)]">
        <CheckoutShell page={data.page} purchase embedded>
          <CheckoutForm data={data} preview />
        </CheckoutShell>
      </div>
    </aside>
  );
}
