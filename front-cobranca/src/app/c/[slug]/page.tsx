import type { Metadata } from "next";
import { CheckoutPage } from "@/components/checkout-public/CheckoutPage";

export const metadata: Metadata = {
  title: "Pagamento | Cifra+",
  robots: { index: false, follow: false },
};

export default async function PublicCheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CheckoutPage slug={slug} />;
}
