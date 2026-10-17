import {
  CheckCheck,
  ChevronDown,
  CircleCheck,
  Copy,
  CreditCard,
  ExternalLink,
  Mail,
  MessageCircle,
  QrCode,
} from "lucide-react";
import styles from "./landing.module.css";

// Product illustrations drawn with HTML and example data. They are pictures
// of the interface (role="img"), never working controls.

export function ChargeMessagePreview() {
  return (
    <div
      className={styles.msgPreview}
      role="img"
      aria-label="Mensagem de cobrança no WhatsApp com botões para copiar o código Pix e ver a cobrança"
    >
      <div className={styles.msgHeader}>
        <MessageCircle size={14} aria-hidden />
        Cifra+ · WhatsApp
      </div>
      <div className={styles.msgBubble} data-hero="bubble">
        <p>Olá, Ana! Sua fatura de R$ 350,00 vence em 20/11.</p>
        <span className={styles.msgTime}>
          09:12 <CheckCheck size={14} aria-hidden />
        </span>
        <span className={styles.msgAction}>
          <Copy size={14} aria-hidden /> Copiar código Pix
        </span>
        <span className={styles.msgAction}>
          <ExternalLink size={14} aria-hidden /> Ver cobrança
        </span>
      </div>
    </div>
  );
}

const SHEET_ROWS = [
  ["Ana Souza", "R$ 350,00", "10/11", "Vencido"],
  ["Oficina Prado", "R$ 1.200,00", "12/11", "Pago"],
  ["Carlos Lima", "R$ 480,00", "05/11", "Vencido"],
  ["Clínica Bem-Estar", "R$ 890,00", "15/11", "Pendente"],
  ["Escola Aquarela", "R$ 2.150,00", "08/11", "Vencido"],
  ["Marcos Dias", "R$ 260,00", "18/11", "Pendente"],
];

export function ManualSpreadsheetPreview() {
  return (
    <div
      className={styles.sheetScene}
      role="img"
      aria-label="Planilha de cobranças com faturas vencidas e status anotados à mão"
    >
      <div className={styles.sheet} data-reveal="lift">
        <div className={styles.sheetHead}>
          <span>Cliente</span>
          <span>Valor</span>
          <span>Vencimento</span>
          <span>Status</span>
        </div>
        {SHEET_ROWS.map(([name, value, due, status]) => (
          <div key={name} className={styles.sheetRow}>
            <span>{name}</span>
            <span>{value}</span>
            <span className={styles.mono}>{due}</span>
            <span>
              <i
                className={styles.statusChip}
                data-tone={status === "Pago" ? "good" : status === "Vencido" ? "late" : "plain"}
              >
                {status}
              </i>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ManualReminderPreview() {
  return (
    <div
      className={styles.reminderScene}
      role="img"
      aria-label="Lembrete de cobrança digitado à mão e enviado pelo celular de alguém da equipe"
    >
      <div className={styles.reminderPhone} data-reveal="lift">
        <span className={styles.reminderLabel}>Enviado pelo celular</span>
        <p className={styles.reminderBubble}>
          Oi, Carlos! Passando para lembrar da fatura de R$ 480,00 que venceu dia 05.
        </p>
        <span className={styles.msgTime}>18:47</span>
      </div>
    </div>
  );
}

export function PixChargePreview() {
  return (
    <div
      className={styles.pixPreview}
      role="img"
      aria-label="Tela de cobrança Pix com QR Code, código copia e cola e confirmação de pagamento"
    >
      <div className={styles.phone} data-reveal="lift">
        <span className={styles.phoneLabel}>Cobrança Pix</span>
        <strong className={styles.phoneAmount}>R$ 350,00</strong>
        <span className={styles.qrBox}>
          <QrCode className={styles.qrIcon} strokeWidth={1.4} aria-hidden />
        </span>
        <span className={styles.fieldLabel}>Pix copia e cola</span>
        <span className={styles.codeField}>00020126580014br.gov.bcb…</span>
        <span className={styles.fakeButton}>
          <Copy size={14} aria-hidden /> Copiar código Pix
        </span>
      </div>
      <span className={styles.paidToast} data-reveal="rise" data-reveal-delay={120}>
        <CircleCheck size={16} aria-hidden /> Pagamento confirmado
      </span>
    </div>
  );
}

const REMINDERS = {
  before: {
    channel: "WhatsApp",
    label: "Lembrete de cobrança enviado pelo WhatsApp três dias antes do vencimento",
    text: "Olá, Ana! Sua fatura de R$ 350,00 vence em 3 dias. Pague pelo link.",
    time: "17/11 · 09:00",
  },
  due: {
    channel: "E-mail",
    label: "E-mail de cobrança enviado no dia do vencimento",
    text: "Sua fatura de R$ 350,00 vence hoje. Pague pelo link da cobrança.",
    time: "20/11 · 09:00",
  },
  after: {
    channel: "WhatsApp",
    label: "Aviso de atraso enviado pelo WhatsApp cinco dias depois do vencimento",
    text: "Ainda não identificamos o pagamento de R$ 350,00. Se já pagou, desconsidere.",
    time: "25/11 · 09:00",
  },
} as const;

export function ReminderMessagePreview({ variant }: { variant: keyof typeof REMINDERS }) {
  const item = REMINDERS[variant];
  const isEmail = item.channel === "E-mail";
  const Icon = isEmail ? Mail : MessageCircle;
  return (
    <div className={styles.reminderMsg} role="img" aria-label={item.label}>
      <div className={styles.reminderCard} data-kind={isEmail ? "email" : "chat"}>
        <span className={styles.reminderMeta}>
          {isEmail ? "Assunto: Sua fatura vence hoje" : "Cifra+ · WhatsApp"}
        </span>
        <p>{item.text}</p>
        <span className={styles.msgTime}>{item.time}</span>
      </div>
      <span className={styles.reminderBadge} aria-hidden>
        <Icon size={24} strokeWidth={1.8} />
      </span>
    </div>
  );
}

export function PayPagePreview() {
  return (
    <div
      className={styles.payScene}
      role="img"
      aria-label="Página de pagamento aberta no celular, sem login, com Pix copia e cola e linha digitável do boleto"
    >
      <div className={styles.payPhone} data-reveal="lift">
        <span className={styles.phoneLabel}>Sua Empresa Ltda.</span>
        <span className={styles.payTag}>BOLIX</span>
        <strong className={styles.phoneAmount}>R$ 350,00</strong>
        <span className={styles.payDue}>Vence em 20/11</span>
        <span className={styles.fieldLabel}>Pix copia e cola</span>
        <span className={styles.codeField}>00020126580014br.gov…</span>
        <span className={styles.fakeButton}>
          <Copy size={13} aria-hidden /> Copiar código Pix
        </span>
        <span className={styles.fieldLabel}>Linha digitável</span>
        <span className={styles.codeField}>00190.00009 01234.5678…</span>
      </div>
    </div>
  );
}

export function CardCheckoutPreview() {
  return (
    <div
      className={styles.payScene}
      role="img"
      aria-label="Página de pagamento com cartão de crédito, com escolha da bandeira e do parcelamento"
    >
      <div className={styles.payPhone} data-reveal="lift">
        <span className={styles.phoneLabel}>Sua Empresa Ltda.</span>
        <span className={styles.payTag}>Cartão de crédito</span>
        <strong className={styles.phoneAmount}>R$ 350,00</strong>
        <span className={styles.payDue}>Vence em 20/11</span>
        <span className={styles.fieldLabel}>Bandeira</span>
        <span className={styles.selectField}>
          Visa <ChevronDown size={14} aria-hidden />
        </span>
        <span className={styles.fieldLabel}>Parcelamento</span>
        <span className={styles.selectField}>
          De 1x a 6x <ChevronDown size={14} aria-hidden />
        </span>
        <span className={styles.fakeButton}>
          <CreditCard size={14} aria-hidden /> Pagar com cartão
        </span>
      </div>
    </div>
  );
}

// Same labels as the company dashboard (app/(dashboard)/page.tsx).
const DASH_TILES = [
  ["Total Recuperado", "R$ 18.420,00", "good"],
  ["Total Pendente", "R$ 6.150,00", "plain"],
  ["Cobranças Ativas", "64", "plain"],
  ["Vencidas em Aberto", "7", "late"],
] as const;

const DASH_CHANNELS = [
  {
    title: "Mensagens de WhatsApp",
    period: "Últimas 24 horas",
    stats: [
      ["120", "enviadas"],
      ["114", "entregues"],
      ["96", "lidas"],
      ["2", "falhas"],
    ],
  },
  {
    title: "E-mails de cobrança",
    period: "Últimos 30 dias",
    stats: [
      ["310", "enviados"],
      ["302", "entregues"],
      ["188", "abertos"],
      ["74", "cliques"],
    ],
  },
] as const;

export function DashboardPreview() {
  return (
    <div
      className={styles.dashPreview}
      role="img"
      aria-label="Painel da empresa com total recuperado, total pendente, cobranças ativas, vencidas em aberto e números de WhatsApp e e-mail"
    >
      <div className={styles.dashTiles} data-reveal="lift">
        {DASH_TILES.map(([label, value, tone]) => (
          <div key={label} className={styles.dashTile} data-tone={tone}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className={styles.dashBody}>
        {DASH_CHANNELS.map((channel) => (
          <div key={channel.title} className={styles.dashChannel}>
            <span className={styles.dashChartTitle}>{channel.title}</span>
            <small>{channel.period}</small>
            <div className={styles.dashStats}>
              {channel.stats.map(([value, label]) => (
                <span key={label}>
                  <strong>{value}</strong>
                  {label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const INVOICES = [
  ["Ana Souza", "20/11", "R$ 350,00", "Pago"],
  ["Oficina Prado", "22/11", "R$ 1.200,00", "Pendente"],
  ["Carlos Lima", "05/11", "R$ 480,00", "Vencido"],
  ["Clínica Bem-Estar", "25/11", "R$ 890,00", "Pendente"],
  ["Escola Aquarela", "08/11", "R$ 2.150,00", "Pago"],
  ["Loja Ipê", "28/11", "R$ 740,00", "Pendente"],
] as const;

export function InvoiceListPreview() {
  return (
    <div
      className={styles.invoicePreview}
      role="img"
      aria-label="Lista de faturas com cliente, vencimento, valor e status de cada cobrança"
    >
      <div className={styles.invoiceTable} data-reveal="lift">
        <div className={styles.invoiceHead}>
          <span>Cliente</span>
          <span>Vencimento</span>
          <span>Valor</span>
          <span>Status</span>
        </div>
        {INVOICES.map(([name, due, value, status]) => (
          <div key={name} className={styles.invoiceRow}>
            <span>{name}</span>
            <span className={styles.mono}>{due}</span>
            <span>{value}</span>
            <span>
              <i
                className={styles.statusChip}
                data-tone={status === "Pago" ? "good" : status === "Vencido" ? "late" : "plain"}
              >
                {status}
              </i>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
