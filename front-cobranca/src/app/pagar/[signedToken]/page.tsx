import type { Metadata } from "next";
import PaymentPageClient from "./PaymentPageClient";
import { loadPayment } from "./load-payment";

// The link is personal: never indexed, and the token in the URL is not sent
// as referrer when the payer opens the boleto on the bank's site.
export const metadata: Metadata = {
  title: "Pagamento | Cifra+",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

// Every visit reads the current state: a paid or closed charge must not be
// rendered from an older copy that still had payment instruments.
export const dynamic = "force-dynamic";

interface PaymentPageProps {
  params: Promise<{
    signedToken: string;
  }>;
}

export default async function PaymentPage({ params }: PaymentPageProps) {
  const { signedToken } = await params;
  return <PaymentPageClient signedToken={signedToken} payment={await loadPayment(signedToken)} />;
}
