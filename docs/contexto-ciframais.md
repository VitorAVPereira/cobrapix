# Contexto do Cifra+ para o projeto de captação de leads

Conferido no repositório `cobrapix` em 22/10/2026 (commit `3ae05d8`). Este documento é um
resumo para quem trabalha **fora** do sistema de cobrança, na automação de captação de
clientes. A fonte da verdade é o código do `cobrapix`; na dúvida, confira lá e trate este
texto como possivelmente desatualizado.

Como usar: copie este arquivo para a raiz do projeto novo e referencie-o no `AGENTS.md` ou
`CLAUDE.md` dele. Se possível, anexe também o repositório `cobrapix` (só leitura) às sessões.

---

## 1. O que é o Cifra+

- **Nome público:** Cifra+. Internamente o sistema se chama CifraMais; o repositório se
  chama `cobrapix` (nome antigo). Em material para cliente, use sempre **Cifra+**.
- **O que faz:** plataforma de cobrança para empresas. A empresa cadastra seus clientes e
  faturas; o Cifra+ emite a cobrança por **Pix, boleto (com QR Code Pix) ou cartão de
  crédito em até 6x** na **conta Efí da própria empresa**, envia avisos por **WhatsApp e
  e-mail** seguindo uma régua configurável e mostra em um painel quem pagou, quem está
  pendente e quem atrasou.
- **Modelo B2B multiempresa:** cada empresa cliente vê só os próprios dados.
- **O dinheiro não passa pelo Cifra+:** o pagamento cai direto na conta Efí da empresa. A
  remuneração do Cifra+ é uma tarifa por cobrança (fixa ou percentual, por forma de
  pagamento, negociada por empresa), recebida por split automático da Efí.
- **Recurso adicional:** pagamentos a colaboradores. A empresa paga funcionários por Pix a
  partir da própria conta Efí, com aprovação do responsável pelo WhatsApp, inclusive com
  agendamento e repetição. É liberado empresa por empresa pelo admin. Não calcula folha.

## 2. Para quem (perfil de cliente)

Confirmado no código e na página:

- Empresas que emitem muitas cobranças para clientes e hoje cobram "na mão" (planilha,
  lembrete digitado no celular, conferência de extrato).
- O preço é **orçamento personalizado** pelo **volume de cobranças por mês** e pelo
  **ticket médio**, os dois dados opcionais que o formulário de orçamento já pede.
- A empresa precisa ter, ou aceitar abrir, uma **conta Efí**. A abertura de conta pelo
  Cifra+ está desligada; hoje a equipe conecta uma conta que já existe.
- O cadastro de empresa tem um campo de segmento com dois valores: Geral e **Educação**.
  O segmento de escolas existe no produto.

Hipóteses (confirmar com o responsável antes de usar em campanha): o foco é pequenas e
médias empresas com cobrança recorrente (escolas, academias, prestadores de serviço,
condomínios); as telas foram pensadas para mais de 1.000 cobranças por mês.

## 3. Mensagens já aprovadas (fonte: página de apresentação)

Use estes textos como base de tom e de promessa. Estão em
`front-cobranca/src/components/landing/LandingPage.tsx`.

- **Título:** "Suas cobranças no automático."
- **Subtítulo:** "Emita Pix, boleto e cartão de crédito, avise por WhatsApp e e-mail e
  acompanhe cada pagamento."
- **Problema:** "Sua equipe cobra um cliente por vez." Planilhas desatualizadas, lembretes
  um a um, aviso que sai tarde, sem visão do que foi pago.
- **Formas de pagamento:** Pix (QR Code e copia e cola, confirmação na hora); boleto que
  também pode ser pago com Pix e compensa na hora; cartão de crédito parcelado em até 6x.
  Baixa automática quando o pagamento entra.
- **Régua:** sequência de lembretes por perfil de cliente (por exemplo, bons e maus
  pagadores). Para cada perfil, a empresa escolhe quando o aviso sai (antes, no dia ou
  depois do vencimento) e por qual canal; a mensagem é escolhida pelo sistema. Os avisos
  param quando a fatura é paga.
- **Pagador sem login:** o cliente da empresa recebe um link, abre e paga. O link mostra só
  aquela cobrança.
- **Segurança:** dados separados por empresa, credenciais Efí cifradas, dinheiro direto na
  conta da empresa, dados tratados conforme a LGPD (sem prometer "todos os pontos" da lei),
  com link para a política de privacidade.
- **Como funciona:** (1) você pede o orçamento; (2) nossa equipe faz a ativação (conecta a
  conta Efí e valida a chave Pix); (3) você cadastra clientes e faturas, à mão ou por
  planilha CSV; (4) a primeira cobrança sai.
- **CTA principal:** "Solicitar orçamento". CTA secundário: WhatsApp comercial.

## 4. O que pode e o que não pode ser prometido

| Pode | Não pode |
| --- | --- |
| Pix, boleto com Pix e cartão em até 6x | Outras formas (débito, TED, carnê, link de outro gateway) |
| Dinheiro direto na conta Efí da empresa | Que o Cifra+ recebe ou adianta o dinheiro |
| Ativação feita pela equipe Cifra+ | Autocadastro ou teste grátis instantâneo: não existe |
| Avisos por WhatsApp e e-mail com régua por perfil | Texto livre de WhatsApp a qualquer momento: a Meta exige templates aprovados |
| Importação de cobranças por planilha CSV | Integração com ERP ou API pública: não existe hoje |
| Orçamento por volume e ticket médio | Preço fixo, tabela pública ou percentuais: são negociados por empresa |
| Pagamentos a colaboradores por Pix com aprovação no WhatsApp | Cálculo de folha, encargos ou eSocial |

O cartão de crédito já aparece na página, mas o runbook (`docs/operations/efi-credit-card.md`)
pede homologação por conta antes de habilitar. Confirme com a equipe se ele está disponível
para novos clientes antes de usá-lo como destaque de campanha.

## 5. Como a captação funciona hoje

1. Quem visita `/` sem sessão vê a página de apresentação (rota interna `/apresentacao`,
   reescrita no `front-cobranca/src/middleware.ts`). O botão **Entrar** leva ao login.
2. **Formulário "Solicitar orçamento"** (`front-cobranca/src/components/landing/QuoteRequest.tsx`)
   envia `POST <API>/contact/quote-request`, rota pública sem login
   (`api-cobranca/src/contact/`):
   - Campos: `name` (2 a 120 caracteres), `email`, `phone` (celular com DDD, de 10 a 13
     dígitos), `monthlyVolume` e `averageTicket` (texto livre opcional, até 60 caracteres),
     e `website` como armadilha para robôs (preenchido, a API responde "ok" e descarta).
   - Limite: 5 pedidos a cada 15 minutos por IP (resposta 429).
   - Efeito: **só manda um e-mail** pelo Resend para `QUOTE_REQUEST_EMAIL`, com
     `reply-to` no e-mail do lead. Pedidos repetidos com o mesmo e-mail e celular no
     mesmo dia geram um e-mail só.
   - **O lead não é gravado em banco.** Não há CRM, histórico, origem (UTM) nem status.
3. **Botão de WhatsApp:** link `wa.me` para o número em `NEXT_PUBLIC_CONTACT_WHATSAPP`, com
   a mensagem "Olá, tenho interesse nos serviços da Cifra+."
4. Depois da venda, tudo é manual, pelo admin no painel do Cifra+:
   - cria a empresa: razão social, CNPJ, e-mail, telefone e segmento;
   - cria o primeiro usuário (nome e e-mail), que recebe uma senha temporária e cria a
     própria no primeiro acesso;
   - faz a ativação financeira: credenciais Efí, certificado `.p12`, chave Pix, dados do
     representante legal e tarifas da empresa;
   - a partir daí a empresa cadastra clientes e faturas.

## 6. Onde o projeto novo pode se ligar

Não há API para leads nem para criar empresas fora do painel do admin. Recomendações:

- **Guarde os leads no projeto novo** (CRM, planilha ou banco próprio). Não escreva no banco
  do Cifra+ e não use credenciais de admin em automação.
- Para levar os leads da página atual ao projeto novo, há dois caminhos, ambos com mudança
  no `cobrapix`, que deve ser pedida e revisada lá:
  - o endpoint `/contact/quote-request` também encaminha o lead para um webhook do projeto
    novo (chave idempotente, assinatura e repetição se falhar);
  - ou o formulário da página passa a enviar direto para o projeto novo.
- Para a conversão (lead que virou cliente), a ponte hoje é humana: o admin cria a
  empresa. Qualquer automação nesse ponto exige pedido próprio no `cobrapix`.

## 7. Regras que o projeto novo não pode quebrar

- **Nunca use dados dos clientes das empresas (pagadores) nem dos usuários das empresas
  para prospecção.** Eles foram coletados para cobrança. Usar para outra finalidade fere a
  LGPD e o isolamento entre empresas, que é promessa de venda.
- **Não use o canal de WhatsApp de cobrança para prospecção.** O número central (via
  Datafy) é compartilhado por todas as empresas e tem limite diário e nota de qualidade na
  Meta. Bloqueios ou queda de qualidade por prospecção param a cobrança de todos os
  clientes. Use outro número e outra conta WhatsApp Business, e templates de marketing
  próprios.
- **Não envie prospecção pelo mesmo remetente ou domínio de e-mail das cobranças** (conta
  central Resend). Reclamações de spam afetam a entrega dos avisos de cobrança. Use um
  domínio ou subdomínio separado.
- **LGPD na captação:** informe a finalidade e a base legal na coleta, ofereça
  descadastro em toda mensagem e respeite o pedido. Guarde quando e como cada lead deu o
  contato. Telefone e e-mail não vão para logs.
- **Segredos:** nada do `api.env`, chaves Datafy, Resend ou Efí entra no projeto novo.
  Cada projeto tem as próprias credenciais.
- **Textos para cliente** em português do Brasil, claros e sem jargão técnico (nada de
  "webhook", "BOLIX" ou "split" em material de venda).

## 8. Vocabulário mínimo

| Termo | Significado |
| --- | --- |
| Empresa | Cliente do Cifra+. É o que o projeto novo quer captar. |
| Cliente da empresa, pagador ou devedor | Quem paga a empresa. Não é lead do Cifra+. |
| Fatura | Valor que a empresa tem a receber. |
| Cobrança | Emissão da fatura na Efí (Pix, boleto ou cartão). |
| Régua | Sequência automática de avisos antes e depois do vencimento. |
| Ativação financeira | Conexão da conta Efí da empresa, feita pela equipe Cifra+. |
| Efí | Banco ou instituição de pagamento (antiga Gerencianet) onde a empresa recebe. |
| Admin | Equipe Cifra+, que cria empresas, ativa e atende. |

## 9. Marca

- Arquivos SVG em `front-cobranca/public/brand/`: `cifra-plus-primary.svg`,
  `cifra-plus-reverse.svg`, versões mono (preta, petróleo, branca), símbolo e ícone.
- Fonte da interface: Geist. As cores estão em `front-cobranca/src/app/globals.css`.
- Rodapé: "© 2026 Cifra+. Todos os direitos reservados."

## 10. Sistema por trás (se precisar ler o código)

- `front-cobranca/`: Next.js 16 e React 19, publicado na Vercel. A página de apresentação
  fica em `src/components/landing/`.
- `api-cobranca/`: NestJS 11, Prisma 7, PostgreSQL e Redis, numa VPS. A publicação é
  manual: código no `main` não significa que já está no ar.
- Regras completas do sistema: `AGENTS.md` na raiz do `cobrapix`.

## 11. Pontos em aberto

- **Política de privacidade pública em `/privacidade`**, ligada no formulário de orçamento
  e no rodapé. Cobre só o que existe hoje: visita, pedido de orçamento e conversa pelo
  WhatsApp, com uso restrito a responder e negociar, retenção de até 12 meses sem
  contratação e pedidos do titular pelo WhatsApp comercial. Ela diz que o contato **não** é
  usado para outra finalidade: campanhas, CRM, novos fornecedores ou novos canais de
  captação exigem atualizar a política antes. Ainda não passou por revisão jurídica.
- Os leads de hoje existem só na caixa de entrada de `QUOTE_REQUEST_EMAIL`; não há
  registro de origem, campanha nem conversão.
- Confirmar com o responsável: perfil de cliente ideal, segmentos prioritários, faixa de
  preço que pode ser citada e se o cartão já está disponível para novos clientes.
