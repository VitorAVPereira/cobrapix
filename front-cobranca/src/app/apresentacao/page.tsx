import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

// Served on "/" to visitors without a session (see middleware.ts).
export const metadata: Metadata = {
  title: "CifraMais | Cobrança por Pix, boleto e WhatsApp",
  description:
    "A CifraMais emite cobranças por Pix, boleto e BOLIX na conta Efí da sua empresa, envia avisos por WhatsApp e e-mail e mostra o que já foi pago. Peça um orçamento.",
  alternates: { canonical: "/" },
};

export default function ApresentacaoPage() {
  return <LandingPage />;
}
