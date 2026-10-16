// Commercial contacts come from the deploy configuration; no number or address
// is hard-coded. Without a number, wa.me opens WhatsApp's own contact picker
// with the message ready, and mailto opens a draft with the subject ready.
const QUOTE_MESSAGE = "Olá! Gostaria de solicitar um orçamento da CifraMais.";
const QUOTE_SUBJECT = "Orçamento CifraMais";

const whatsappNumber = (process.env.NEXT_PUBLIC_CONTACT_WHATSAPP ?? "").replace(/\D/g, "");
const contactEmail = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "").trim();

export const WHATSAPP_QUOTE_URL = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(QUOTE_MESSAGE)}`;

export const EMAIL_QUOTE_URL = `mailto:${contactEmail}?subject=${encodeURIComponent(QUOTE_SUBJECT)}`;

export const LOGIN_URL = "/login";
