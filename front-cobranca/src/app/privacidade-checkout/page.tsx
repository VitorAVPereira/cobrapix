import type { Metadata } from "next";
import { PRIVACY_WHATSAPP_URL } from "@/components/landing/contact";

// Public page (outside the middleware matcher, like /privacidade). Draft text,
// not yet reviewed by a lawyer: changes to what the checkout collects must
// change this page too.
export const metadata: Metadata = {
  title: "Aviso de privacidade do checkout | Cifra+",
  description: "Como a Cifra+ e o vendedor tratam os dados de quem compra pelo Cifra+ Checkout.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function CheckoutPrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10 leading-relaxed text-slate-700">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Aviso de privacidade do checkout</h1>
          <p className="text-sm text-slate-500">Atualizado em 4 de novembro de 2026.</p>
        </div>

        <Section title="Quem trata seus dados">
          <p>
            Quando você compra pela página de pagamento do Cifra+ Checkout, a Cifra+ (Cifra Mais
            Desenvolvimento de Software Customizavel LTDA, CNPJ 67.971.459/0001-03) processa o
            pagamento em nome do vendedor do produto. O vendedor é quem oferece o produto e quem
            entrega o acesso a ele.
          </p>
        </Section>

        <Section title="Quais dados e para quê">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Nome, e-mail, CPF ou CNPJ e celular:</strong> para gerar o Pix, enviar o acesso ao
              produto e permitir que o vendedor fale com você sobre a compra.
            </li>
            <li>
              <strong>Itens escolhidos, cupom e valores:</strong> para calcular o total e registrar a venda.
            </li>
            <li>
              <strong>Origem do link (parâmetros de campanha):</strong> para o vendedor saber de qual
              divulgação você veio.
            </li>
          </ul>
        </Section>

        <Section title="Compra não concluída">
          <p>
            Se você gerar o Pix e não pagar, o vendedor pode entrar em contato pelo e-mail ou celular
            informados para ajudar a concluir a compra. Os dados pessoais de compras não concluídas
            ficam guardados por até 12 meses e depois são apagados; os números da tentativa podem ser
            mantidos sem identificar você.
          </p>
        </Section>

        <Section title="Compra concluída">
          <p>
            Os dados de compras pagas são guardados pelo tempo exigido pelas obrigações legais,
            fiscais e de prevenção a fraudes, inclusive para tratar pedidos de reembolso e
            contestações no banco.
          </p>
        </Section>

        <Section title="Com quem compartilhamos">
          <p>
            Com o vendedor do produto; com a Efí, instituição de pagamento que processa o Pix; e com o
            serviço que envia os e-mails de acesso. Não vendemos seus dados.
          </p>
        </Section>

        <Section title="Seus direitos">
          <p>
            Você pode pedir acesso, correção ou exclusão dos seus dados, ou tirar dúvidas, pelo{" "}
            <a
              href={PRIVACY_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-emerald-800 underline underline-offset-4"
            >
              WhatsApp da Cifra+
            </a>
            . Para dúvidas sobre o produto, fale com o vendedor pelo contato da página de pagamento.
          </p>
        </Section>
      </main>
    </div>
  );
}
