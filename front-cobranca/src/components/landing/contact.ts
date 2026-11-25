// The public contacts the payment providers' site review asks for: the same
// e-mail and phone the company registered with them, shown as text. Quote
// requests go through the API, which holds the destination address.
export const CONTACT_EMAIL = "contato@ciframais.com.br";
export const CONTACT_PHONE = "(11) 94004-4440";
export const LEGAL_NAME = "Cifra Mais Desenvolvimento de Software Customizavel LTDA";
export const CNPJ = "67.971.459/0001-03";
// As registered for the CNPJ at the Receita Federal.
export const ADDRESS = "Rua Pais Leme, 215, conj. 1713, Pinheiros, São Paulo/SP, CEP 05424-150";

// The deploy configuration may point WhatsApp elsewhere; without it, the
// public phone, so the link never opens WhatsApp's contact picker.
const whatsappNumber = (process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || "5511940044440").replace(/\D/g, "");

const whatsappUrl = (message: string) =>
  `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

export const WHATSAPP_URL = whatsappUrl("Olá, tenho interesse nos serviços da Cifra+.");

// The privacy policy names this WhatsApp as the channel for data subject requests.
export const PRIVACY_WHATSAPP_URL = whatsappUrl(
  "Olá, quero fazer um pedido sobre os meus dados pessoais.",
);

export const PRIVACY_URL = "/privacidade";

export const TERMS_URL = "/termos";

export const QUOTE_REQUEST_URL = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/contact/quote-request`;

export const QUOTE_DIALOG_ID = "orcamento";

export const LOGIN_URL = "/login";
