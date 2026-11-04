import Link from "next/link";
import type { ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { checkoutImageUrl } from "@/lib/checkout-public";

/** Banner, seller name, the page body, the Cifra+ notice and the WhatsApp button. */
export function CheckoutShell({
  page,
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
  children: ReactNode;
}) {
  const banner = checkoutImageUrl(page?.bannerUrl ?? null);
  const logo = checkoutImageUrl(page?.logoUrl ?? null);
  return (
    <div className="min-h-screen bg-slate-100">
      {banner && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the API
        <img src={banner} alt="" className="max-h-56 w-full object-cover" />
      )}
      <main className="mx-auto w-full max-w-xl space-y-5 px-4 py-6">
        {page && (
          <header className="flex items-center gap-3">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element -- served by the API
              <img src={logo} alt="" className="h-10 w-10 rounded-md object-cover" />
            )}
            <p className="font-semibold text-slate-800">{page.displayName}</p>
          </header>
        )}
        {children}
        <footer className="space-y-1 pb-16 text-center text-xs text-slate-500">
          <p>Pagamento processado pela Cifra+. O Pix aparece no seu banco com a Cifra+ como recebedora.</p>
          {(page?.supportEmail || page?.supportWhatsapp) && (
            <p>Dúvidas sobre o produto: {[page.supportEmail, page.supportWhatsapp].filter(Boolean).join(" · ")}</p>
          )}
          <p>
            <Link href="/privacidade-checkout" className="underline">
              Aviso de privacidade
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
