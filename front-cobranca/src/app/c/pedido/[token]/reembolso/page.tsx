import type { Metadata } from "next";
import { RefundRequestPage } from "@/components/checkout-public/RefundRequestPage";

// Same order token as the order page: never indexed nor sent as referrer.
export const metadata: Metadata = {
  title: "Pedir reembolso | Cifra+",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function PublicRefundPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RefundRequestPage token={token} />;
}
