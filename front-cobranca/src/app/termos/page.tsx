import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ADDRESS,
  CNPJ,
  CONTACT_EMAIL,
  CONTACT_PHONE,
  LEGAL_NAME,
  WHATSAPP_URL,
} from "@/components/landing/contact";

// Public page (outside the middleware matcher): the landing page and the
// payment providers' site review link here, and visitors have no session.
export const metadata: Metadata = {
  title: "Termos de Uso | Cifra+",
  description:
    "Condições de contratação e uso da Cifra+: cobrança por Pix, boleto e cartão e checkout de produtos digitais.",
  alternates: { canonical: "/termos" },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

const linkClass = "font-semibold text-emerald-800 underline underline-offset-4";

export default function TermsPage() {
  const email = (
    <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
      {CONTACT_EMAIL}
    </a>
  );
  const whatsapp = (
    <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
      WhatsApp {CONTACT_PHONE}
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
          <h1 className="text-3xl font-semibold text-slate-900">Termos de Uso</h1>
          <p className="text-sm text-slate-500">Atualizados em 25 de novembro de 2026.</p>
        </div>

        <section className="space-y-3 rounded-xl bg-slate-50 p-5">
          <h2 className="text-lg font-semibold text-slate-900">Resumo</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>A Cifra+ é um software para empresas cobrarem seus clientes e venderem produtos digitais.</li>
            <li>
              O pagamento é processado por uma instituição de pagamento, como a Efí. A Cifra+ não é
              banco nem instituição de pagamento.
            </li>
            <li>
              Cobrança: preço sob consulta. Checkout: 2% por venda paga, mais a tarifa da transação.
              Os valores podem ser negociados, e a proposta comercial aceita pela sua empresa vale
              sobre estes termos.
            </li>
            <li>Sua empresa responde pelo que cobra e pelo que vende. A Cifra+ responde pelo funcionamento do software.</li>
            <li>Você pode cancelar quando quiser. Mudanças de preço são avisadas com 30 dias de antecedência.</li>
          </ul>
          <p className="text-sm text-slate-500">
            O resumo ajuda a leitura e não substitui o texto completo abaixo.
          </p>
        </section>

        <Section title="1. Quem somos">
          <p>
            A Cifra+ é operada por {LEGAL_NAME}, inscrita no CNPJ sob o nº {CNPJ}, com sede na{" "}
            {ADDRESS}. Atendimento pelo e-mail {email} e pelo {whatsapp}.
          </p>
        </Section>

        <Section title="2. A quem estes termos se aplicam">
          <p>
            Estes termos valem para a empresa ou o profissional que contrata a Cifra+ para usar na
            própria atividade (o &quot;cliente&quot;) e para as pessoas que o cliente cadastra para
            acessar o sistema. Quem paga uma cobrança ou compra um produto pelo checkout segue os{" "}
            <Link href="/termos-checkout" className={linkClass}>
              Termos de Uso do checkout
            </Link>
            .
          </p>
          <p>
            Se houver proposta comercial ou contrato assinado com o cliente, eles valem sobre estes
            termos no que forem diferentes.
          </p>
        </Section>

        <Section title="3. O que a Cifra+ oferece">
          <ul className="list-disc space-y-3 pl-6">
            <li>
              <strong>Cobrança:</strong> o cliente cadastra seus devedores e faturas, e a Cifra+
              emite cobranças por Pix, boleto com Pix e cartão de crédito na conta Efí do próprio
              cliente, envia avisos por WhatsApp e e-mail conforme a régua configurada e mostra o que
              foi pago. O dinheiro entra direto na conta do cliente.
            </li>
            <li>
              <strong>Checkout:</strong> o cliente cadastra produtos digitais, preços, planos,
              ofertas e cupons e recebe uma página de venda. A Cifra+ processa o pedido, confirma o
              pagamento, envia o acesso ao comprador, organiza reembolsos e avisa o sistema do
              cliente. A conta em que a venda é recebida é a definida na contratação.
            </li>
          </ul>
          <p>
            A Cifra+ fornece a tecnologia. O processamento do pagamento é feito pela instituição de
            pagamento, que tem regras, prazos e tarifas próprias.
          </p>
        </Section>

        <Section title="4. Contratação e acesso">
          <ol className="list-decimal space-y-2 pl-6">
            <li>O cliente pede um orçamento pela página ou pelos nossos canais e recebe uma proposta.</li>
            <li>
              Com a proposta aceita, nossa equipe faz a ativação: cadastra a empresa e conecta a
              conta na instituição de pagamento, quando o serviço exige.
            </li>
            <li>O cliente recebe o acesso e cria a própria senha no primeiro login.</li>
          </ol>
          <p>
            O cliente mantém seus dados cadastrais corretos e cuida das senhas dos seus usuários. O
            que for feito com um acesso do cliente é considerado feito por ele. Se perceber uso
            indevido, o cliente deve nos avisar na hora.
          </p>
        </Section>

        <Section title="5. Preços e pagamento">
          <ul className="list-disc space-y-3 pl-6">
            <li>
              <strong>Cobrança:</strong> sob consulta, conforme o volume de cobranças e o ticket
              médio, pelo valor da proposta aceita.
            </li>
            <li>
              <strong>Checkout:</strong> 2% sobre cada venda paga, calculados sobre o valor vendido
              (produto e order bumps, depois do cupom e sem o acréscimo de tarifa pago pelo
              comprador), mais a tarifa da transação cobrada pela instituição de pagamento. A forma
              de cobrança dessa taxa está na proposta.
            </li>
            <li>
              Os valores podem ser negociados. O valor combinado com o cliente na proposta é o que
              vale para ele.
            </li>
            <li>
              As tarifas da instituição de pagamento são definidas por ela, e não pela Cifra+.
            </li>
            <li>
              A Cifra+ avisa por e-mail, com pelo menos 30 dias de antecedência, qualquer aumento de
              preço. Se não concordar, o cliente pode cancelar antes da data, sem multa.
            </li>
          </ul>
        </Section>

        <Section title="6. Responsabilidades do cliente">
          <ul className="list-disc space-y-2 pl-6">
            <li>Cobrar só valores devidos e vender só produtos que tem o direito de vender.</li>
            <li>
              Entregar o produto ou serviço vendido, dar suporte ao comprador e cumprir o Código de
              Defesa do Consumidor, inclusive o direito de arrependimento de 7 dias nas compras pela
              internet.
            </li>
            <li>
              Ter base legal para os dados que cadastra e para os avisos por WhatsApp e e-mail, e
              respeitar quem pedir para não receber mensagens.
            </li>
            <li>Seguir as regras da instituição de pagamento e do WhatsApp.</li>
            <li>
              Não usar a Cifra+ para produtos ou cobranças ilegais, enganosas ou que violem direitos
              de terceiros, nem para tentar acessar dados de outras empresas.
            </li>
          </ul>
        </Section>

        <Section title="7. Responsabilidades da Cifra+">
          <ul className="list-disc space-y-2 pl-6">
            <li>Manter o sistema funcionando, com segurança, e corrigir falhas que dependam dela.</li>
            <li>Separar os dados de cada cliente: uma empresa não acessa os dados de outra.</li>
            <li>Guardar credenciais com criptografia e não usá-las para outra finalidade.</li>
            <li>
              Responder pelos canais de atendimento em até 5 dias úteis e avisar com antecedência
              as manutenções programadas, quando possível.
            </li>
          </ul>
        </Section>

        <Section title="8. Fornecedores de terceiros">
          <p>
            O serviço depende de fornecedores como a instituição de pagamento, o WhatsApp e o envio
            de e-mail. Aprovação de conta, bloqueios, prazos de crédito, tarifas, aprovação de
            mensagens e disponibilidade desses serviços são decididos por eles. Quando um deles
            falhar, a Cifra+ avisa o cliente e ajuda a resolver o que estiver ao seu alcance.
          </p>
        </Section>

        <Section title="9. Limites de responsabilidade">
          <p>A Cifra+ não responde por:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>o produto ou serviço que o cliente vende ou cobra, nem pela relação dele com seus clientes;</li>
            <li>o não pagamento de devedores ou compradores;</li>
            <li>decisões e falhas dos fornecedores de terceiros descritos no item 8;</li>
            <li>dados errados cadastrados pelo cliente.</li>
          </ul>
          <p>
            Fora os casos de dolo ou culpa grave, a responsabilidade da Cifra+ perante o cliente fica
            limitada ao valor que ele pagou à Cifra+ nos 12 meses anteriores ao fato.
          </p>
        </Section>

        <Section title="10. Dados pessoais">
          <p>
            Nos dados de devedores e compradores que o cliente cadastra ou recebe pelo checkout, o
            cliente é o controlador e a Cifra+ trata os dados em nome dele, como operadora, conforme
            a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), só para prestar o serviço
            contratado. Nos dados de quem visita o site e dos usuários do sistema, a Cifra+ é a
            controladora, conforme a{" "}
            <Link href="/privacidade" className={linkClass}>
              Política de privacidade
            </Link>
            .
          </p>
          <p>
            A Cifra+ guarda os registros de acesso ao sistema por 6 meses, como exige o Marco Civil
            da Internet (Lei nº 12.965/2014), e avisa o cliente se houver incidente de segurança que
            envolva os dados dele.
          </p>
        </Section>

        <Section title="11. Propriedade intelectual">
          <p>
            O software, a marca e os textos da Cifra+ pertencem à Cifra+. O cliente recebe o direito
            de usá-los enquanto durar a contratação. Os dados, textos e imagens que o cliente
            cadastra continuam sendo dele.
          </p>
        </Section>

        <Section title="12. Suspensão e cancelamento">
          <ul className="list-disc space-y-3 pl-6">
            <li>
              O cliente pode cancelar a qualquer momento pelos nossos canais, no prazo de aviso da
              proposta, quando houver.
            </li>
            <li>
              A Cifra+ pode suspender o acesso se houver falta de pagamento depois de aviso, uso
              contrário a estes termos ou suspeita de fraude. Sempre que possível, avisa antes e
              explica o motivo.
            </li>
            <li>
              Cobranças já emitidas e vendas já feitas continuam na instituição de pagamento. Depois
              do cancelamento, o cliente pode pedir uma cópia dos seus dados em até 30 dias. Depois
              disso, os dados são apagados, exceto o que a lei manda guardar.
            </li>
          </ul>
        </Section>

        <Section title="13. Mudanças nestes termos">
          <p>
            A Cifra+ pode atualizar estes termos. A data no topo mostra a versão em vigor. Mudanças
            que aumentem preço ou obrigações do cliente são avisadas por e-mail com 30 dias de
            antecedência, e o cliente pode cancelar sem multa se não concordar.
          </p>
        </Section>

        <Section title="14. Lei e foro">
          <p>
            Estes termos seguem a lei brasileira. Fica eleito o foro do domicílio do cliente para
            resolver qualquer questão sobre eles.
          </p>
        </Section>

        <Section title="15. Contato">
          <p>
            {LEGAL_NAME}, CNPJ {CNPJ}, {ADDRESS}. E-mail {email} e {whatsapp}.
          </p>
        </Section>

        <p>
          <Link href="/" className={linkClass}>
            Voltar para a página inicial
          </Link>
        </p>
      </main>
    </div>
  );
}
