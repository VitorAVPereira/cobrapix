import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PRIVACY_WHATSAPP_URL } from "@/components/landing/contact";

// Public page (outside the middleware matcher): the quote form and the landing
// footer link here, and visitors have no session.
export const metadata: Metadata = {
  title: "Política de privacidade | Cifra+",
  description:
    "Como a Cifra+ trata os dados de quem visita a página, pede um orçamento ou fala com a gente pelo WhatsApp.",
  alternates: { canonical: "/privacidade" },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPolicyPage() {
  const whatsapp = (
    <a
      href={PRIVACY_WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-emerald-800 underline underline-offset-4"
    >
      WhatsApp da Cifra+
    </a>
  );

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-3xl items-center px-6 py-5">
          <Link href="/" aria-label="Cifra+, página inicial">
            <Image src="/brand/cifra-plus-primary.svg" alt="Cifra+" width={99} height={32} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-6 py-10 leading-relaxed text-slate-700">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-slate-900">Política de privacidade</h1>
          <p className="text-sm text-slate-500">Atualizada em 22 de outubro de 2026.</p>
        </div>

        <Section title="Quem somos">
          <p>
            Esta política explica como a Cifra+ (Cifra Mais Desenvolvimento de Software
            Customizavel LTDA, CNPJ 67.971.459/0001-03) trata os dados pessoais de quem visita
            esta página, pede um orçamento ou fala com a gente pelo WhatsApp. Para esses dados, a
            Cifra+ é a controladora, nos termos da Lei Geral de Proteção de Dados (Lei nº
            13.709/2018).
          </p>
        </Section>

        <Section title="Quais dados usamos e para quê">
          <ul className="list-disc space-y-3 pl-6">
            <li>
              <strong>Pedido de orçamento:</strong> nome, e-mail e celular, e, se você quiser
              informar, a quantidade de cobranças por mês e o ticket médio. Usamos esses dados
              para responder ao pedido, preparar a proposta e negociar a contratação, a seu
              pedido (art. 7º, V, da LGPD).
            </li>
            <li>
              <strong>Endereço IP:</strong> quando você envia o formulário, o endereço IP é usado
              por até 15 minutos para limitar pedidos repetidos e proteger a página contra abuso.
              Depois disso, é descartado. A base é o nosso legítimo interesse em manter o serviço
              seguro (art. 7º, IX).
            </li>
            <li>
              <strong>Conversa pelo WhatsApp:</strong> seu número e as mensagens que você enviar,
              para responder ao seu contato. A conversa passa pelo WhatsApp, que tem a própria
              política de privacidade.
            </li>
          </ul>
        </Section>

        <Section title="O que não fazemos">
          <ul className="list-disc space-y-3 pl-6">
            <li>Não vendemos nem alugamos seus dados.</li>
            <li>Não usamos seu contato para outra finalidade além das descritas acima.</li>
            <li>
              Esta página não usa cookies de publicidade nem ferramentas de análise de terceiros.
            </li>
          </ul>
        </Section>

        <Section title="Com quem compartilhamos">
          <p>
            Só com fornecedores que operam o serviço em nosso nome: a hospedagem do site (Vercel)
            e do servidor (InterServer) e o envio de e-mail (Resend), que entrega seu pedido à
            nossa equipe comercial. Esses fornecedores armazenam dados nos Estados Unidos, então
            seus dados podem ser transferidos para fora do Brasil. Também podemos informar dados
            a autoridades quando a lei exigir.
          </p>
        </Section>

        <Section title="Por quanto tempo guardamos">
          <ul className="list-disc space-y-3 pl-6">
            <li>
              Pedidos de orçamento e conversas pelo WhatsApp: até 12 meses depois do último
              contato, se não houver contratação. Se sua empresa contratar a Cifra+, os dados
              passam a fazer parte da relação comercial e seguem o contrato.
            </li>
            <li>Endereço IP: até 15 minutos.</li>
          </ul>
        </Section>

        <Section title="Como protegemos">
          <p>
            Os dados trafegam com criptografia (HTTPS) e os pedidos ficam acessíveis só à equipe
            que faz o atendimento comercial.
          </p>
        </Section>

        <Section title="Seus direitos">
          <p>Você pode, a qualquer momento:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>confirmar se tratamos seus dados e ter acesso a eles;</li>
            <li>corrigir dados incompletos, inexatos ou desatualizados;</li>
            <li>pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários ou tratados em desacordo com a lei;</li>
            <li>pedir a eliminação dos seus dados;</li>
            <li>pedir a portabilidade dos seus dados a outro fornecedor;</li>
            <li>saber com quem compartilhamos seus dados;</li>
            <li>se opor a um tratamento que descumpra a LGPD.</li>
          </ul>
          <p>
            Para fazer um pedido ou tirar dúvidas sobre privacidade, inclusive com o encarregado
            pela proteção de dados, fale pelo {whatsapp}. Respondemos em até 15 dias. Você também
            pode apresentar reclamação à{" "}
            <a
              href="https://www.gov.br/anpd"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-emerald-800 underline underline-offset-4"
            >
              Autoridade Nacional de Proteção de Dados (ANPD)
            </a>
            .
          </p>
        </Section>

        <Section title="Recebeu uma cobrança enviada pela Cifra+?">
          <p>
            A Cifra+ envia cobranças em nome das empresas que contratam a plataforma. Nesse caso,
            seus dados foram cadastrados pela empresa que está cobrando, e é ela quem decide sobre
            eles. Pedidos sobre esses dados devem ser feitos a essa empresa. Se preferir, fale com
            a gente pelo {whatsapp} e encaminhamos o pedido.
          </p>
        </Section>

        <Section title="Mudanças nesta política">
          <p>
            Podemos atualizar esta política. A data no topo mostra a versão em vigor.
          </p>
        </Section>

        <p>
          <Link href="/" className="font-semibold text-emerald-800 underline underline-offset-4">
            Voltar para a página inicial
          </Link>
        </p>
      </main>
    </div>
  );
}
