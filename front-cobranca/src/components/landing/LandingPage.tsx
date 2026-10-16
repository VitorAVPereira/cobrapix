import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Barcode,
  Check,
  Landmark,
  Mail,
  MessageCircle,
  Plus,
  QrCode,
} from "lucide-react";
import { EMAIL_QUOTE_URL, LOGIN_URL, WHATSAPP_QUOTE_URL } from "./contact";
import { LandingFaq, type FaqItem } from "./LandingFaq";
import { LandingHeader } from "./LandingHeader";
import { LandingMotion } from "./LandingMotion";
import {
  BoletoChargePreview,
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

function WhatsAppButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={WHATSAPP_QUOTE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`${styles.btn} ${styles.btnPrimary} ${className}`}
    >
      <MessageCircle size={19} aria-hidden />
      Pedir orçamento pelo WhatsApp
      <ArrowRight size={18} className={styles.btnArrow} aria-hidden />
    </a>
  );
}

function EmailButton({ className = "" }: { className?: string }) {
  return (
    <a href={EMAIL_QUOTE_URL} className={`${styles.btn} ${className}`}>
      <Mail size={18} aria-hidden />
      Pedir orçamento por e-mail
    </a>
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
    text: "E-mail com o código Pix e a linha digitável do boleto.",
  },
  {
    variant: "after",
    title: "5 dias depois",
    text: "Novo aviso pelo WhatsApp, sem tom agressivo.",
  },
] as const;

const STEPS = [
  {
    title: "Você pede o orçamento",
    text: "Pelo WhatsApp ou por e-mail, contando como sua empresa cobra hoje.",
    checks: ["Resposta da nossa equipe", "Proposta para o seu volume"],
  },
  {
    title: "Nossa equipe faz a ativação",
    text: "Conectamos a conta Efí da sua empresa e validamos a chave Pix.",
    checks: ["Conta Efí conectada", "Chave Pix validada"],
  },
  {
    title: "Você cadastra clientes e faturas",
    text: "E monta a régua de avisos do seu jeito.",
    checks: ["Clientes e faturas", "Etapas da régua"],
  },
  {
    title: "A primeira cobrança sai",
    text: "A CifraMais emite a cobrança e envia a primeira mensagem.",
    checks: ["Pix ou boleto emitido", "Aviso enviado"],
  },
];

const SECURITY = [
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
    "Cada cobrança é emitida e recebida na conta Efí da sua empresa. A CifraMais não segura pagamentos.",
  ],
] as const;

const FAQ: FaqItem[] = [
  {
    question: "O dinheiro passa pela CifraMais?",
    answer:
      "Não. Cada cobrança é emitida na conta Efí da sua empresa e o pagamento cai direto nela.",
  },
  {
    question: "Quais formas de pagamento posso oferecer?",
    answer:
      "Pix com QR Code e copia e cola, boleto e BOLIX, que junta boleto e QR Code Pix no mesmo documento.",
  },
  {
    question: "Como funcionam os avisos por WhatsApp?",
    answer:
      "Você monta a régua com etapas antes, no dia e depois do vencimento. As mensagens usam modelos aprovados e também podem sair por e-mail.",
  },
  {
    question: "Meus clientes precisam criar conta?",
    answer:
      "Não. Eles recebem um link e pagam sem login. O link mostra só aquela cobrança.",
  },
  {
    question: "Como eu acesso o sistema?",
    answer:
      "Pelo botão Entrar, no topo da página, com o acesso criado pela nossa equipe.",
  },
  {
    question: "Quanto custa?",
    answer:
      "Montamos um orçamento para a sua empresa. Fale com a gente pelo WhatsApp ou por e-mail.",
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
            <span data-hero="line">Sua cobrança</span>{" "}
            <span data-hero="line2">
              no <em>automático</em>.
            </span>
          </h1>
          <p className={styles.heroLead} data-hero="lead">
            Emita Pix e boleto, avise por WhatsApp e e-mail e acompanhe cada pagamento.
          </p>
          <div className={styles.heroActions} data-hero="actions">
            <WhatsAppButton />
            <EmailButton className={styles.heroEmail} />
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
                  <span>PIX · BOLETO · BOLIX · WHATSAPP</span>
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
              Ver como a CifraMais resolve
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
              Seu cliente paga do jeito dele,{" "}
              <span className={styles.mutedLine}>e o dinheiro cai na sua conta Efí.</span>
            </h2>
            <div className={styles.paymentsFrame}>
              <PixChargePreview />
            </div>
            <div className={styles.paymentsRight}>
              <p className={styles.paymentsLead}>
                <strong>Emitido pela Efí.</strong> Cada cobrança sai da conta da sua empresa e a
                baixa é automática quando o pagamento entra.
              </p>
              <div className={styles.payGrid}>
                <article className={styles.payColumn} data-reveal="rise">
                  <div className={styles.payTile}>
                    <span className={styles.payIndex}>01</span>
                    <p className={styles.payWord}>Pix</p>
                  </div>
                  <div className={styles.payCard}>
                    <h3>Pix com QR Code e copia e cola</h3>
                    <p>Confirmação na hora, direto na sua conta.</p>
                  </div>
                </article>
                <article className={styles.payColumn} data-reveal="rise" data-reveal-delay={60}>
                  <div className={styles.payTile}>
                    <span className={styles.payIndex}>02</span>
                    <p className={styles.payWord}>Boleto e BOLIX</p>
                  </div>
                  <div className={`${styles.payCard} ${styles.payCardAccent}`}>
                    <h3>Boleto com QR Code Pix</h3>
                    <p>O mesmo documento aceita boleto ou Pix. Seu cliente escolhe.</p>
                    <ul className={styles.payChips} aria-label="Meios aceitos">
                      <li>
                        <QrCode size={18} aria-hidden /> Pix
                      </li>
                      <li>
                        <Barcode size={18} aria-hidden /> Boleto
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
            <h2 id="regua-title" className={styles.reguaTitle}>
              Avisos que saem na hora certa
            </h2>
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
                  <strong>Pix copia e cola</strong>
                  Um toque para copiar o código no celular.
                </figcaption>
              </figure>
              <figure>
                <div className={`${styles.payerFrame} ${styles.payerFrameDark}`}>
                  <BoletoChargePreview />
                </div>
                <figcaption>
                  <strong>Linha digitável do boleto</strong>
                  Para pagar em qualquer banco ou aplicativo.
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
                  <span>Painel · Recebido, em aberto e vencido</span>
                  <strong>Os números da sua empresa no mês</strong>
                </figcaption>
              </figure>
              <figure>
                <div className={styles.panelFrame}>
                  <InvoiceListPreview />
                </div>
                <figcaption>
                  <span>Faturas · Status por cliente</span>
                  <strong>Quem pagou, quem está em aberto e quem atrasou</strong>
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* Como funciona: karo-template-07-services */}
        <section id="como_funciona" className={styles.how} aria-labelledby="como-title">
          <div className={`${styles.wrap} ${styles.howGrid}`}>
            <aside className={styles.howAside}>
              <p className={styles.howBrand}>CifraMais</p>
              <p className={styles.howIntro}>
                Cobrança por Pix, boleto e WhatsApp para pequenas e médias empresas. A ativação é
                feita pela nossa equipe.
              </p>
              <div className={styles.howContact}>
                <p>Contato</p>
                <a href={WHATSAPP_QUOTE_URL} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
                <a href={EMAIL_QUOTE_URL}>E-mail</a>
              </div>
              <a
                href={WHATSAPP_QUOTE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.howButton}
              >
                <MessageCircle size={17} aria-hidden />
                Pedir orçamento pelo WhatsApp
              </a>
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
            <h2 id="seguranca-title" className={styles.securityLabel}>
              (Segurança)
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
                <a
                  href={WHATSAPP_QUOTE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.faqSideButton}
                >
                  <MessageCircle size={18} aria-hidden />
                  Pedir orçamento pelo WhatsApp
                </a>
              </div>
            </div>
            <LandingFaq items={FAQ} />
          </div>
        </section>

        {/* Chamada final: mitchy-11-cta */}
        <section className={styles.cta} aria-labelledby="cta-title">
          <h2 id="cta-title" className={styles.ctaTitle}>
            Vamos montar a cobrança da sua empresa.{" "}
            <span>Fale com a gente pelo WhatsApp ou por e-mail.</span>
          </h2>
          <div className={styles.ctaActions}>
            <WhatsAppButton />
            <EmailButton className={styles.btnOutlineAccent} />
          </div>
        </section>
      </main>

      {/* Rodapé: ritovex-11-footer */}
      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footerTop}`}>
          <p className={styles.footerStatement}>
            Cobrança por Pix, boleto e WhatsApp, com o dinheiro na conta da sua empresa.
          </p>
          <div className={styles.footerQuote}>
            <a href={WHATSAPP_QUOTE_URL} target="_blank" rel="noopener noreferrer">
              Pedir orçamento pelo WhatsApp
              <ArrowRight size={18} aria-hidden />
            </a>
            <a href={EMAIL_QUOTE_URL}>
              Pedir orçamento por e-mail
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
            <p>BOLIX</p>
          </div>
          <div>
            <h2>Fale com a gente</h2>
            <p className={styles.footerInfo}>
              <MessageCircle size={20} aria-hidden /> Atendimento para empresas
            </p>
            <p className={styles.footerInfo}>
              <Mail size={20} aria-hidden /> Orçamento para o seu volume
            </p>
          </div>
        </div>
        <div className={`${styles.wrap} ${styles.footerBottom}`}>
          <p>© 2026 CifraMais. Todos os direitos reservados.</p>
          <Image src="/brand/cifra-plus-reverse.svg" alt="CifraMais" width={99} height={32} />
        </div>
        <div className={styles.wrap}>
          <Image
            src="/brand/cifra-wordmark-reverse.svg"
            alt=""
            width={556}
            height={206}
            className={styles.footerWordmark}
          />
        </div>
      </footer>

      <LandingMotion rootId={ROOT_ID} />
    </div>
  );
}
