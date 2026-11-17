import type { Metadata } from "next";
import { SubscriptionPage } from "@/components/checkout-public/SubscriptionPage";

// The token comes only by e-mail: never indexed nor sent as referrer.
export const metadata: Metadata = {
  title: "Sua assinatura | Cifra+",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function PublicSubscriptionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SubscriptionPage token={token} />;
}
