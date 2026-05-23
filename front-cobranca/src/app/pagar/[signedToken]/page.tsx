import PaymentPageClient from "./PaymentPageClient";
import type { PublicPaymentData } from "./PaymentPageClient";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface PaymentPageProps {
  params: Promise<{
    signedToken: string;
  }>;
}

async function loadPayment(
  signedToken: string,
): Promise<{ data: PublicPaymentData | null; error: string | null }> {
  try {
    const response = await fetch(
      `${API_URL}/payments/public/${encodeURIComponent(signedToken)}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      return {
        data: null,
        error: "Link de pagamento invalido, expirado ou indisponivel.",
      };
    }

    return {
      data: (await response.json()) as PublicPaymentData,
      error: null,
    };
  } catch {
    return {
      data: null,
      error: "Nao foi possivel carregar esta cobranca agora.",
    };
  }
}

export default async function PaymentPage({ params }: PaymentPageProps) {
  const { signedToken } = await params;
  const payment = await loadPayment(signedToken);

  return <PaymentPageClient data={payment.data} error={payment.error} />;
}
