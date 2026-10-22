// The WhatsApp number comes from the deploy configuration; nothing is
// hard-coded. Without a number, wa.me opens WhatsApp's own contact picker with
// the message ready. Quote requests go through the API, which holds the
// destination address.
const whatsappNumber = (process.env.NEXT_PUBLIC_CONTACT_WHATSAPP ?? "").replace(/\D/g, "");

const whatsappUrl = (message: string) =>
  `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

export const WHATSAPP_URL = whatsappUrl("Olá, tenho interesse nos serviços da Cifra+.");

// The privacy policy names this WhatsApp as the channel for data subject requests.
export const PRIVACY_WHATSAPP_URL = whatsappUrl(
  "Olá, quero fazer um pedido sobre os meus dados pessoais.",
);

export const PRIVACY_URL = "/privacidade";

export const QUOTE_REQUEST_URL = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/contact/quote-request`;

export const QUOTE_DIALOG_ID = "orcamento";

export const LOGIN_URL = "/login";
