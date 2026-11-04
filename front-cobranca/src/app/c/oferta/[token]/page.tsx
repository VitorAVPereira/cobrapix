import type { Metadata } from "next";
import { OfferPage } from "@/components/checkout-public/OfferPage";

// The token is the offer key of a purchase: never indexed nor sent as referrer.
export const metadata: Metadata = {
  title: "Oferta especial | Cifra+",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function PublicOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ oferta?: string | string[] }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  // The seller's page links one offer by id; anything else shows the default.
  const offerId = typeof query.oferta === "string" && /^[0-9a-f-]{36}$/i.test(query.oferta) ? query.oferta : null;
  return <OfferPage token={token} offerId={offerId} />;
}
