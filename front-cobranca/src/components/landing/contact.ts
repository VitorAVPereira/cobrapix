// The WhatsApp number comes from the deploy configuration; nothing is
// hard-coded. Without a number, wa.me opens WhatsApp's own contact picker with
// the message ready. Quote requests go through the API, which holds the
// destination address.
const WHATSAPP_MESSAGE = "Olá, tenho interesse nos serviços da Cifra+.";

const whatsappNumber = (process.env.NEXT_PUBLIC_CONTACT_WHATSAPP ?? "").replace(/\D/g, "");

export const WHATSAPP_URL = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

export const QUOTE_REQUEST_URL = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/contact/quote-request`;

export const QUOTE_DIALOG_ID = "orcamento";

export const LOGIN_URL = "/login";
