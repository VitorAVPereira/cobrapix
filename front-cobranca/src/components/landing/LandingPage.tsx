import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Barcode,
  Check,
  CreditCard,
  Landmark,
  MessageCircle,
  Plus,
  QrCode,
} from "lucide-react";
import { LOGIN_URL, PRIVACY_URL, WHATSAPP_URL } from "./contact";
import { LandingFaq, type FaqItem } from "./LandingFaq";
import { LandingHeader } from "./LandingHeader";
import { LandingMotion } from "./LandingMotion";
import { QuoteButton, QuoteDialog, WhatsAppFloat } from "./QuoteRequest";
import {
  CardCheckoutPreview,
  ChargeMessagePreview,
  DashboardPreview,
  InvoiceListPreview,
  ManualReminderPreview,
  ManualSpreadsheetPreview,
  PayPagePreview,
  PixChargePreview,
  ReminderMessagePreview,
} from "./previews";
import styles from "./landing.module.css";

const ROOT_ID = "landing";

function QuoteCta() {
  return (
    <QuoteButton className={`${styles.btn} ${styles.btnPrimary}`}>
      Solicitar orçamento
      <ArrowRight size={18} className={styles.btnArrow} aria-hidden />
    </QuoteButton>
  );
}

function SquareLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className={styles.squareLabel}>
      <span aria-hidden />
      {children}
    </p>
  );
}

const PROBLEMS = [
  ["Planilhas", "Valores e datas espalhados em arquivos que ninguém atualiza."],
  ["Uma a uma", "Cada lembrete digitado no celular de alguém da equipe."],
  ["Atrasos", "O aviso sai tarde, quando sai."],
  ["Sem visão", "Saber o que foi pago exige conferir extrato por extrato."],
] as const;

const REGUA = [
  {
    variant: "before",
    title: "3 dias antes",
    text: "Lembrete pelo WhatsApp com o link de pagamento.",
  },
  {
    variant: "due",
    title: "No dia do vencimento",
    text: "E-mail com o link de pagamento da cobrança.",
  },
  {
    variant: "after",
    title: "5 dias depois",
    text: "Novo aviso pelo WhatsApp, em um tom amigável.",
  },
] as const;

const STEPS = [
  {
    title: "Você pede o orçamento",
    text: "Pelo formulário da página, contando como sua empresa cobra hoje.",
    checks: ["Resposta da nossa equipe", "Proposta para o seu volume"],
  },
  {
    title: "Nossa equipe faz a ativação",
    text: "Conectamos a conta Efí da sua empresa e validamos a chave Pix.",
    checks: ["Conta Efí conectada", "Chave Pix validada"],
  },
  {
    title: "Você cadastra clientes e faturas",
    text: "E monta uma régua de avisos para cada perfil de cliente.",
    checks: ["Clientes e faturas", "Perfis e etapas da régua"],
  },
  {
    title: "A primeira cobrança sai",
    text: "A Cifra+ emite a cobrança e envia a primeira mensagem.",
    checks: ["Pix, boleto ou cartão de crédito", "Aviso enviado"],
  },
];

const SECURITY = [
  [
    "Em conformidade com a LGPD",
    "Seguimos todos os pontos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Os dados dos seus clientes são tratados apenas para a cobrança e ficam protegidos em cada etapa.",
  ],
  [
    "Cada empresa vê só os próprios dados",
    "Clientes, faturas, mensagens e estatísticas ficam separados por empresa. Uma empresa não acessa nada de outra.",
  ],
  [
    "Credenciais guardadas com criptografia",
    "As credenciais e o certificado da sua conta Efí ficam cifrados e nunca aparecem na tela.",
  ],
  [
    "O dinheiro vai direto para você",
    "Cada cobrança é emitida e recebida na conta Efí da sua empresa. A Cifra+ não segura pagamentos.",
  ],
] as const;

const FAQ: FaqItem[] = [
  {
    question: "O dinheiro passa pela Cifra+?",
    answer:
      "Não. Cada cobrança é emitida na conta Efí da sua empresa e o pagamento cai direto nela.",
  },
  {
    question: "Quais formas de pagamento posso oferecer?",
    answer: (
      <>
        <p>Oferecemos três opções de pagamento:</p>
        <ul>
          <li>
            <strong>Pix</strong>, com QR Code e código copia e cola.
          </li>
          <li>
            <strong>Boleto</strong>, que também traz um QR Code Pix. Seu cliente escolhe pagar pelo
            código de barras ou pelo Pix, e o pagamento via Pix é compensado na hora. É a segurança
            do boleto com a agilidade do Pix no mesmo documento.
          </li>
          <li>
            <strong>Cartão de crédito</strong>, parcelado em até 6x.
          </li>
        </ul>
      </>
    ),
  },
  {
    question: "Como funciona a régua de cobrança?",
    answer: (
      <>
        <p>
          A régua é a sequência de lembretes que a Cifra+ envia sozinha para cada cobrança. Você
          configura uma vez:
        </p>
        <ol>
          <li>
            Separa seus clientes em perfis, como bons pagadores e maus pagadores. Crie quantos
            perfis quiser.
          </li>
          <li>Escolhe, para cada perfil, quando os avisos saem: antes, no dia ou depois do vencimento.</li>
          <li>Define o canal de cada aviso: WhatsApp ou e-mail.</li>
        </ol>
        <p>Depois disso, os avisos saem no dia certo e param assim que a fatura é paga.</p>
      </>
    ),
  },
  {
    question: "Meus clientes precisam criar conta?",
    answer: (
      <>
        <p>Não. Seu cliente não precisa de cadastro, senha nem aplicativo:</p>
        <ul>
          <li>Recebe o link da cobrança pelo WhatsApp ou por e-mail.</li>
          <li>
            Abre o link e paga ali mesmo, pela forma de pagamento da cobrança: Pix, boleto ou
            cartão de crédito.
          </li>
          <li>O link é seguro e mostra só aquela cobrança, sem acesso a nenhum outro dado.</li>
        </ul>
      </>
    ),
  },
  {
    question: "Como eu acesso o sistema?",
    answer: (
      <>
        <p>
          Depois da contratação, nossa equipe cria o acesso da sua empresa e passa uma senha
          temporária. Então:
        </p>
        <ol>
          <li>
            Clique em <strong>Entrar</strong>, no topo desta página.
          </li>
          <li>Informe seu e-mail e a senha temporária.</li>
          <li>No primeiro acesso, crie a sua própria senha.</li>
        </ol>
        <p>
          Esqueceu a senha? Use <strong>Esqueci minha senha</strong> na tela de entrada e receba
          as instruções por e-mail.
        </p>
      </>
    ),
  },
  {
    question: "Quanto custa?",
    answer:
      "Fazemos um orçamento personalizado para a sua empresa, de acordo com o volume de cobranças e o ticket médio. Clique em Solicitar orçamento e preencha o formulário, ou fale com a gente pelo WhatsApp.",
  },
];

export function LandingPage() {
  return (
    <div id={ROOT_ID} className={styles.page}>
      <a href="#inicio" className={styles.skipLink}>
        Ir para o conteúdo
      </a>
      <LandingHeader />

      <main id="inicio" tabIndex={-1}>
        {/* Hero: nubo-01-hero */}
        <section className={styles.hero} aria-labelledby="hero-title">
          <h1 id="hero-title" className={styles.heroTitle}>
            <span data-hero="line">Suas cobranças</span>{" "}
            <span data-hero="line2">
              no <em>automático</em>.
            </span>
          </h1>
          <p className={styles.heroLead} data-hero="lead">
            Emita Pix, boleto e cartão de crédito, avise por WhatsApp e e-mail e acompanhe cada
            pagamento.
          </p>
          <div className={styles.heroActions} data-hero="actions">
            <QuoteCta />
          </div>
          <div className={styles.heroStackWrap}>
            <div className={styles.heroStack} data-hero="stack">
              <span className={styles.heroBack} data-back="left" aria-hidden />
              <span className={styles.heroBack} data-back="right" aria-hidden />
              <div className={styles.heroCard}>
                <div className={styles.heroCardMedia}>
                  <ChargeMessagePreview />
                </div>
                <div className={styles.heroCardBand} aria-hidden>
                  <Image src="/brand/cifra-mark-reverse.svg" alt="" width={22} height={22} />
                  <span>PIX · BOLETO · CARTÃO · WHATSAPP</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Problema: avoora-02-about */}
        <section className={styles.problem} aria-labelledby="problema-title">
          <div className={`${styles.wrap} ${styles.problemGrid}`}>
            <div className={styles.problemLabel}>
              <SquareLabel>O PROBLEMA</SquareLabel>
            </div>
            <h2 id="problema-title" className={styles.problemTitle}>
              Sua equipe cobra um cliente por vez.{" "}
              <span className={styles.mutedLine}>Enquanto isso, a fatura vence.</span>
            </h2>
            <div className={styles.problemMedia}>
              <div className={styles.frame}>
                <ManualSpreadsheetPreview />
              </div>
              <div className={`${styles.frame} ${styles.frameAlt}`}>
                <ManualReminderPreview />
              </div>
            </div>
            <a href="#formas_pagamento" className={styles.rectCta}>
              Ver como a Cifra+ resolve
              <span className={styles.rectCtaIcon} aria-hidden>
                <ArrowRight size={16} />
              </span>
            </a>
          </div>
          <ul className={`${styles.wrap} ${styles.stats}`}>
            {PROBLEMS.map(([title, text], index) => (
              <li key={title} className={styles.stat} data-reveal="rise" data-reveal-delay={index * 60}>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Formas de pagamento: fabrica-04-benefits */}
        <section id="formas_pagamento" className={styles.payments} aria-labelledby="formas-title">
          <div className={`${styles.wrap} ${styles.paymentsGrid}`}>
            <p className={styles.circleLabel}>
              <span aria-hidden>
                <Plus size={13} strokeWidth={3} />
              </span>
              Formas de pagamento
            </p>
            <h2 id="formas-title" className={styles.paymentsTitle}>
              Três formas de receber: Pix, boleto e cartão de crédito.{" "}
              <span className={styles.mutedLine}>O dinheiro cai na sua conta Efí.</span>
            </h2>
            <div className={styles.paymentsFrame}>
              <PixChargePreview />
            </div>
            <div className={styles.paymentsRight}>
              <p className={styles.paymentsLead}>
                <strong>Só essas três, emitidas pela Efí.</strong> Cada cobrança sai da conta da sua
                empresa e a baixa é automática quando o pagamento entra.
              </p>
              <div className={styles.payGrid}>
                <article className={styles.payColumn} data-reveal="rise">
                  <div className={styles.payTile}>
                    <span className={styles.payIndex}>01</span>
                    <p className={styles.payWord}>Pix</p>
                  </div>
                  <div className={styles.payCard}>
                    <h3>QR Code e copia e cola</h3>
                    <p>Confirmação na hora, direto na sua conta.</p>
                    <ul className={styles.payChips} aria-label="Como pagar">
                      <li>
                        <QrCode size={18} aria-hidden /> QR Code
                      </li>
                    </ul>
                  </div>
                </article>
                <article className={styles.payColumn} data-reveal="rise" data-reveal-delay={60}>
                  <div className={styles.payTile}>
                    <span className={styles.payIndex}>02</span>
                    <p className={styles.payWord}>Boleto</p>
                  </div>
                  <div className={`${styles.payCard} ${styles.payCardAccent}`}>
                    <h3>Também pode ser pago com Pix, e compensa na hora</h3>
                    <p>
                      Código de barras e QR Code Pix no mesmo boleto: a segurança do boleto com a
                      agilidade do Pix.
                    </p>
                    <ul className={styles.payChips} aria-label="Como pagar">
                      <li>
                        <QrCode size={18} aria-hidden /> Pix
                      </li>
                      <li>
                        <Barcode size={18} aria-hidden /> Linha digitável
                      </li>
                    </ul>
                  </div>
                </article>
                <article className={styles.payColumn} data-reveal="rise" data-reveal-delay={120}>
                  <div className={styles.payTile}>
                    <span className={styles.payIndex}>03</span>
                    <p className={styles.payWord}>Cartão de crédito</p>
                  </div>
                  <div className={styles.payCard}>
                    <h3>Parcelado em até 6x</h3>
                    <p>Seu cliente paga com cartão na página da cobrança, sem criar conta.</p>
                    <ul className={styles.payChips} aria-label="Como pagar">
                      <li>
                        <CreditCard size={18} aria-hidden /> Até 6x
                      </li>
                      <li>
                        <Landmark size={18} aria-hidden /> Conta Efí
                      </li>
                    </ul>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>

        {/* Régua: meridian-04-services */}
        <section id="regua" className={styles.regua} aria-labelledby="regua-title">
          <div className={styles.wrap}>
            <div className={styles.reguaHead}>
              <h2 id="regua-title" className={styles.reguaTitle}>
                Avisos que saem na hora certa
              </h2>
              <p className={styles.reguaLead}>
                A régua de cobrança é configurável por perfil de cliente. Crie quantos perfis
                quiser, cada um com as próprias etapas, canais e mensagens.
              </p>
            </div>
            <p className={styles.reguaExample}>Exemplo de régua de um perfil</p>
            <ol className={styles.reguaCols}>
              {REGUA.map((item, index) => (
                <li key={item.variant} data-reveal="slide" data-reveal-delay={index * 80}>
                  <div className={styles.reguaFrame}>
                    <ReminderMessagePreview variant={item.variant} />
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pagador: ollef-05-work */}
        <section className={styles.payer} aria-labelledby="pagador-title">
          <div className={styles.wrap}>
            <div className={styles.payerHead}>
              <h2 id="pagador-title" className={styles.payerTitle}>
                Pagar sem login
              </h2>
              <p>Seu cliente abre o link e paga. O link mostra só aquela cobrança.</p>
              <a href="#perguntas" className={styles.underlineLink}>
                Ver perguntas frequentes
              </a>
            </div>
            <div className={styles.payerFrames}>
              <figure>
                <div className={styles.payerFrame}>
                  <PayPagePreview />
                </div>
                <figcaption>
                  <strong>Pix e boleto</strong>
                  Um toque para copiar o código Pix ou a linha digitável do boleto.
                </figcaption>
              </figure>
              <figure>
                <div className={`${styles.payerFrame} ${styles.payerFrameDark}`}>
                  <CardCheckoutPreview />
                </div>
                <figcaption>
                  <strong>Cartão de crédito</strong>
                  Pagamento na mesma página, parcelado em até 6x.
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* Painel: lexedge-11-blog */}
        <section className={styles.panel} aria-labelledby="painel-title">
          <div className={styles.wrap}>
            <div className={styles.panelHead}>
              <SquareLabel>Acompanhamento</SquareLabel>
              <h2 id="painel-title" className={styles.panelTitle}>
                Tudo o que entra, em um painel.{" "}
                <span className={styles.accentLine}>Fatura por fatura.</span>
              </h2>
            </div>
            <div className={styles.panelFrames}>
              <figure>
                <div className={styles.panelFrame}>
                  <DashboardPreview />
                </div>
                <figcaption>
                  <span>Painel · Recuperado, pendente e vencido</span>
                  <strong>Os números da sua empresa e dos avisos enviados</strong>
                </figcaption>
              </figure>
              <figure>
                <div className={styles.panelFrame}>
                  <InvoiceListPreview />
                </div>
                <figcaption>
                  <span>Faturas · Status por cliente</span>
                  <strong>Quem pagou, quem está pendente e quem atrasou</strong>
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* Como funciona: karo-template-07-services */}
        <section id="como_funciona" className={styles.how} aria-labelledby="como-title">
          <div className={`${styles.wrap} ${styles.howGrid}`}>
            <aside className={styles.howAside}>
              <p className={styles.howBrand}>Cifra+</p>
              <p className={styles.howIntro}>
                Cobrança por Pix, boleto e cartão de crédito, com avisos por WhatsApp e e-mail. A
                ativação é feita pela nossa equipe.
              </p>
              <div className={styles.howContact}>
                <p>Contato</p>
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </div>
              <QuoteButton className={styles.howButton}>Solicitar orçamento</QuoteButton>
            </aside>
            <div>
              <h2 id="como-title" className={styles.howTitle}>
                Como funciona
              </h2>
              <ol className={styles.howRows}>
                {STEPS.map((step, index) => (
                  <li key={step.title} data-reveal="rise">
                    <span className={styles.howNumber}>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.text}</p>
                      <ul>
                        {step.checks.map((check) => (
                          <li key={check}>
                            <Check size={18} aria-hidden />
                            {check}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Segurança: ollef-04-values */}
        <section className={styles.security} aria-labelledby="seguranca-title">
          <div className={`${styles.wrap} ${styles.securityGrid}`}>
            <h2 id="seguranca-title" className={`${styles.squareLabel} ${styles.securityLabel}`}>
              <span aria-hidden />
              Segurança
            </h2>
            <div className={styles.securityBlocks}>
              {SECURITY.map(([title, text]) => (
                <div key={title}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
            <a href="#perguntas" className={`${styles.underlineLink} ${styles.securityLink}`}>
              Ver perguntas frequentes
            </a>
          </div>
        </section>

        {/* Perguntas: lexedge-10-faq */}
        <section id="perguntas" className={styles.faq} aria-labelledby="perguntas-title">
          <div className={`${styles.wrap} ${styles.faqGrid}`}>
            <div className={styles.faqIntro}>
              <div>
                <SquareLabel>Perguntas</SquareLabel>
                <h2 id="perguntas-title" className={styles.faqTitle}>
                  Respostas diretas{" "}
                  <span className={styles.accentLine}>antes do seu orçamento.</span>
                </h2>
              </div>
              <div className={styles.faqSide}>
                <h3>Ainda com dúvida?</h3>
                <p>Fale com a nossa equipe. Explicamos como a cobrança funcionaria na sua empresa.</p>
                <QuoteButton className={styles.faqSideButton}>
                  Solicitar orçamento
                  <ArrowRight size={18} aria-hidden />
                </QuoteButton>
              </div>
            </div>
            <LandingFaq items={FAQ} />
          </div>
        </section>

        {/* Chamada final: mitchy-11-cta */}
        <section className={styles.cta} aria-labelledby="cta-title">
          <h2 id="cta-title" className={styles.ctaTitle}>
            Vamos montar a cobrança da sua empresa.{" "}
            <span>Peça um orçamento e nossa equipe entra em contato.</span>
          </h2>
          <div className={styles.ctaActions}>
            <QuoteCta />
          </div>
        </section>
      </main>

      {/* Rodapé: ritovex-11-footer */}
      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footerTop}`}>
          <p className={styles.footerStatement}>
            Cobrança por Pix, boleto e cartão de crédito, com o dinheiro na conta da sua empresa.
          </p>
          <div className={styles.footerQuote}>
            <QuoteButton className={styles.footerQuoteButton}>
              Solicitar orçamento
              <ArrowRight size={18} aria-hidden />
            </QuoteButton>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
              Falar pelo WhatsApp
              <ArrowRight size={18} aria-hidden />
            </a>
          </div>
        </div>
        <div className={`${styles.wrap} ${styles.footerCols}`}>
          <nav aria-label="Navegação do rodapé">
            <h2>Navegação</h2>
            <a href="#formas_pagamento">Formas de pagamento</a>
            <a href="#regua">Régua de cobrança</a>
            <a href="#como_funciona">Como funciona</a>
            <a href="#perguntas">Perguntas</a>
          </nav>
          <div>
            <h2>Acesso</h2>
            <Link href={LOGIN_URL}>Entrar no sistema</Link>
          </div>
          <div>
            <h2>Pagamentos</h2>
            <p>Pix</p>
            <p>Boleto</p>
            <p>Cartão de crédito</p>
          </div>
          <div>
            <h2>Fale com a gente</h2>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.footerInfo}
            >
              <MessageCircle size={20} aria-hidden /> WhatsApp
            </a>
            <QuoteButton className={styles.footerInfo}>
              <ArrowRight size={20} aria-hidden /> Solicitar orçamento
            </QuoteButton>
          </div>
        </div>
        <div className={`${styles.wrap} ${styles.footerBottom}`}>
          <p>
            © 2026 Cifra+. Todos os direitos reservados. <Link href={PRIVACY_URL}>Política de privacidade</Link>
          </p>
          <Image src="/brand/cifra-plus-reverse.svg" alt="Cifra+" width={99} height={32} />
        </div>
      </footer>

      <WhatsAppFloat />
      <QuoteDialog />
      <LandingMotion rootId={ROOT_ID} />
    </div>
  );
}
