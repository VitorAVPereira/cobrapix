import type { Metadata } from "next";
import { OrderStatus } from "@/components/checkout-public/OrderStatus";

// The token is the order's only key: never indexed nor sent as referrer.
export const metadata: Metadata = {
  title: "Seu pedido | Cifra+",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function PublicOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OrderStatus token={token} />;
}
