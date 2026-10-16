import {
  CheckCheck,
  CircleCheck,
  Copy,
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
        CifraMais · WhatsApp
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
  ["Oficina Prado", "R$ 1.200,00", "12/11", "Pago?"],
  ["Carlos Lima", "R$ 480,00", "05/11", "Vencido"],
  ["Clínica Bem-Estar", "R$ 890,00", "15/11", "Em aberto"],
  ["Escola Aquarela", "R$ 2.150,00", "08/11", "Vencido"],
  ["Marcos Dias", "R$ 260,00", "18/11", "Avisar?"],
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
              <i className={styles.statusChip} data-tone={status === "Vencido" ? "late" : "plain"}>
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
    text: "Olá, Ana! Sua fatura de R$ 350,00 vence em 3 dias. Pague pelo link, com Pix ou boleto.",
    time: "17/11 · 09:00",
  },
  due: {
    channel: "E-mail",
    label: "E-mail de cobrança enviado no dia do vencimento",
    text: "Sua fatura de R$ 350,00 vence hoje. O código Pix e a linha digitável estão no link.",
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
          {isEmail ? "Assunto: Sua fatura vence hoje" : "CifraMais · WhatsApp"}
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
        <span className={styles.payTag}>Cobrança</span>
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

export function BoletoChargePreview() {
  return (
    <div
      className={styles.boletoPreview}
      role="img"
      aria-label="Boleto com código de barras, linha digitável e vencimento"
    >
      <div className={styles.slip} data-reveal="lift">
        <div className={styles.slipTop}>
          <span>Boleto bancário</span>
          <span className={styles.mono}>Venc. 20/11</span>
        </div>
        <strong className={styles.slipAmount}>R$ 350,00</strong>
        <span className={styles.barcode} />
        <span className={styles.slipLine}>00190.00009 01234.567893 01234.567893 1 00000000035000</span>
      </div>
    </div>
  );
}

const MONTHS = [
  ["Mai", 52],
  ["Jun", 61],
  ["Jul", 58],
  ["Ago", 72],
  ["Set", 80],
  ["Out", 91],
] as const;

export function DashboardPreview() {
  const tiles = [
    ["Recebido", "R$ 18.420,00", "good"],
    ["Em aberto", "R$ 6.150,00", "plain"],
    ["Vencido", "R$ 1.050,00", "late"],
    ["Faturas no mês", "64", "plain"],
  ] as const;
  return (
    <div
      className={styles.dashPreview}
      role="img"
      aria-label="Painel da empresa com valores recebidos, em aberto e vencidos, gráfico mensal e últimos pagamentos"
    >
      <div className={styles.dashTiles} data-reveal="lift">
        {tiles.map(([label, value, tone]) => (
          <div key={label} className={styles.dashTile} data-tone={tone}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className={styles.dashBody}>
        <div className={styles.dashChart}>
          <span className={styles.dashChartTitle}>Recebido por mês</span>
          <div className={styles.dashBars}>
            {MONTHS.map(([month, height]) => (
              <span key={month} className={styles.dashBar}>
                <i style={{ height: `${height}%` }} />
                <small>{month}</small>
              </span>
            ))}
          </div>
        </div>
        <div className={styles.dashList}>
          <span className={styles.dashChartTitle}>Últimos pagamentos</span>
          {[
            ["Ana Souza", "R$ 350,00", "Pix"],
            ["Oficina Prado", "R$ 1.200,00", "Boleto"],
            ["Loja Ipê", "R$ 740,00", "BOLIX"],
          ].map(([name, value, method]) => (
            <div key={name} className={styles.dashListRow}>
              <span>{name}</span>
              <span className={styles.mono}>{method}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const INVOICES = [
  ["Ana Souza", "20/11", "R$ 350,00", "Pago"],
  ["Oficina Prado", "22/11", "R$ 1.200,00", "Em aberto"],
  ["Carlos Lima", "05/11", "R$ 480,00", "Vencido"],
  ["Clínica Bem-Estar", "25/11", "R$ 890,00", "Em aberto"],
  ["Escola Aquarela", "08/11", "R$ 2.150,00", "Pago"],
  ["Loja Ipê", "28/11", "R$ 740,00", "Em aberto"],
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
