import Link from "next/link";
import type { ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { checkoutImageUrl } from "@/lib/checkout-public";

/** Banner, seller name, the page body, the Cifra+ footer and the WhatsApp button. */
export function CheckoutShell({
  page,
  purchase = false,
  embedded = false,
  children,
}: {
  page: {
    displayName: string;
    logoUrl: string | null;
    bannerUrl?: string | null;
    supportEmail: string | null;
    supportWhatsapp: string | null;
    whatsappButtonPhone?: string | null;
  } | null;
  /** The page confirms a purchase: the footer states the terms. */
  purchase?: boolean;
  /** Inside the seller's preview: no full-height page. */
  embedded?: boolean;
  children: ReactNode;
}) {
  const banner = checkoutImageUrl(page?.bannerUrl ?? null);
  const logo = checkoutImageUrl(page?.logoUrl ?? null);
  return (
    <div className={embedded ? "bg-neutral-100" : "min-h-screen bg-neutral-100"}>
      <main className="mx-auto w-full max-w-xl space-y-5 px-4 py-6 sm:py-10">
        {banner && (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API
          <img src={banner} alt="" className="max-h-56 w-full rounded-xl object-cover" />
        )}
        {page && (
          <header className="flex items-center gap-3">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element -- served by the API
              <img src={logo} alt="" className="h-9 w-9 rounded-md object-cover" />
            )}
            <p className="text-sm font-semibold text-neutral-800">{page.displayName}</p>
          </header>
        )}
        {children}
        <footer className={`space-y-4 px-2 pt-4 ${embedded ? "pb-4" : "pb-16"} text-center text-xs leading-relaxed text-neutral-500`}>
          {purchase && (
            <p>
              Ao confirmar a compra, você concorda com os{" "}
              <Link href="/termos-checkout" target="_blank" className="underline underline-offset-2">
                Termos de Uso da Cifra+
              </Link>
              .
            </p>
          )}
          <p>Pagamento processado pela Cifra+. O Pix aparece no seu banco com a Cifra+ como recebedora.</p>
          {(page?.supportEmail || page?.supportWhatsapp) && (
            <p>Dúvidas sobre o produto: {[page.supportEmail, page.supportWhatsapp].filter(Boolean).join(" · ")}</p>
          )}
          <p className="flex items-center justify-center gap-2">
            Processado por
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand file */}
            <img src="/brand/cifra-plus-mono-black.svg" alt="Cifra+" className="h-5 w-auto" />
          </p>
          <p>
            {new Date().getFullYear()} Cifra+{" "}
            <Link href="/termos-checkout" target="_blank" className="ml-2 text-neutral-900">
              Termos
            </Link>{" "}
            <Link href="/privacidade-checkout" target="_blank" className="ml-2 text-neutral-900">
              Privacidade
            </Link>
          </p>
        </footer>
      </main>
      {page?.whatsappButtonPhone && (
        <a
          href={`https://wa.me/55${page.whatsappButtonPhone}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Falar com ${page.displayName} no WhatsApp`}
          className="fixed bottom-5 right-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg"
        >
          <MessageCircle size={26} />
        </a>
      )}
    </div>
  );
}
