import type { Metadata } from "next";
import Link from "next/link";
import { PRIVACY_WHATSAPP_URL } from "@/components/landing/contact";

// Public page (outside the middleware matcher, like /privacidade-checkout).
// Draft text, not yet reviewed by a lawyer: it must describe what the checkout
// actually does, so a change in payment, access or refund rules changes it too.
export const metadata: Metadata = {
  title: "Termos de Uso do checkout | Cifra+",
  description: "Condições de compra pelo Cifra+ Checkout: pagamento, acesso ao produto e reembolso.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function CheckoutTermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10 leading-relaxed text-slate-700">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Termos de Uso do checkout</h1>
          <p className="text-sm text-slate-500">Atualizado em 10 de novembro de 2026.</p>
        </div>

        <Section title="Quem é quem">
          <p>
            A Cifra+ (Cifra Mais Desenvolvimento de Software Customizavel LTDA, CNPJ 67.971.459/0001-03)
            processa o pagamento em nome do vendedor do produto. O vendedor é quem oferece o produto, define o
            preço e o período de acesso, entrega o acesso e responde pelo conteúdo e pelo suporte do produto.
          </p>
        </Section>

        <Section title="Pagamento">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Pix:</strong> o código vale por 30 minutos. No seu banco, a Cifra+ aparece como recebedora.
            </li>
            <li>
              <strong>Cartão de crédito:</strong> em até 12 vezes, quando o vendedor oferece. O acréscimo do
              parcelamento aparece antes de você confirmar. Os dados do cartão vão direto para a Efí,
              instituição de pagamento que processa a cobrança.
            </li>
            <li>
              <strong>Valor:</strong> o total mostrado antes do pagamento já inclui os itens escolhidos, o
              cupom e as taxas que se aplicam à forma de pagamento.
            </li>
          </ul>
        </Section>

        <Section title="Acesso ao produto">
          <p>
            Depois da confirmação do pagamento, o acesso chega pelo e-mail informado e, quando o vendedor
            configura, pela própria página. Se o produto tem período de acesso (por exemplo, &quot;por
            trimestre&quot;), ele conta a partir da confirmação do pagamento.
          </p>
          <p>
            Hoje a compra não é renovada automaticamente: ao fim do período, para continuar, faça uma nova compra.
            Nenhuma cobrança futura é feita sem que você pague de novo.
          </p>
        </Section>

        <Section title="Reembolso e arrependimento">
          <p>
            Você pode pedir o reembolso em até 7 dias depois do pagamento, pelo link do e-mail da compra.
            O vendedor pode falar com você sobre o pedido nesse período, e você pode desistir do pedido pelo
            mesmo link. Depois disso, o valor é devolvido pelo mesmo meio de pagamento. A Cifra+ envia um
            e-mail quando o pedido é recebido e quando a devolução é concluída.
          </p>
          <p>
            Antes de contestar a compra no banco ou no cartão, use o pedido de reembolso ou fale com o
            vendedor: a contestação costuma demorar mais.
          </p>
        </Section>

        <Section title="Seus dados">
          <p>
            O uso dos seus dados está no{" "}
            <Link href="/privacidade-checkout" className="font-semibold text-emerald-800 underline underline-offset-4">
              Aviso de privacidade do checkout
            </Link>
            .
          </p>
        </Section>

        <Section title="Contato">
          <p>
            Dúvidas sobre o produto: fale com o vendedor pelo contato da página de pagamento. Dúvidas sobre o
            pagamento: fale com a Cifra+ pelo{" "}
            <a
              href={PRIVACY_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-emerald-800 underline underline-offset-4"
            >
              WhatsApp
            </a>
            .
          </p>
        </Section>
      </main>
    </div>
  );
}
