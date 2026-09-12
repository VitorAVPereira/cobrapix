# Abertura Automatizada de Contas Efí — Plano de Implementação

## Decisão posterior do produto (12/09/2026)

Por orientação expressa do usuário, Bolix é o padrão e Pix permanece disponível. Boleto tradicional não será habilitado para novas emissões; seu histórico e callbacks permanecem compatíveis. Esta decisão substitui as referências abaixo a três modalidades novas e à homologação de seis variantes: validar as quatro combinações Pix/Bolix com taxa fixa/percentual. As tarifas reais continuam configuradas pela administração.

## Resumo

**Objetivo:** automatizar o onboarding financeiro de novos clientes PJ, provisionando uma conta Efí completa antes de liberar Pix, Boleto e Bolix.

**Arquitetura:** criar um módulo NestJS específico para onboarding Efí, com máquina de estados, processamento assíncrono no BullMQ e webhook protegido por mTLS. Credenciais financeiras continuam isoladas por cliente; Meta, Resend e credenciais da CifraMais ficam centralizadas nos segredos do servidor.

**Referências:** [credenciais](https://dev.efipay.com.br/docs/api-abertura-de-contas/credenciais/), [cadastro simplificado](https://dev.efipay.com.br/docs/api-abertura-de-contas/cadastro-simplificado/), [webhook](https://dev.efipay.com.br/docs/api-abertura-de-contas/webhook/), [split Pix](https://dev.efipay.com.br/docs/api-pix/split-de-pagamento-pix/) e [split Boleto/Bolix](https://dev.efipay.com.br/docs/api-cobrancas/split-de-pagamento/).

Cada etapa deve seguir TDD: teste falhando, implementação mínima, testes verdes e commit isolado.

## Passo a passo de implementação

### 1. Preservar o trabalho existente e criar uma base segura

- Manter intacta a worktree `codex/centralized-communication-channels`, que contém alterações não commitadas.
- Usá-la apenas como referência para templates globais, webhook, correlação de mensagens e inbox central; não incorporar seu modelo de segredos no banco ou failover com múltiplos números.
- Criar uma nova worktree `codex/efi-account-opening` baseada na `dev`.
- Registrar os resultados iniciais de testes, lint e builds dos dois projetos.
- Dividir a entrega em commits funcionais e reversíveis, mantendo o interruptor de novas aberturas desligado até homologação.

### 2. Evoluir banco de dados e domínio

Alterar o schema canônico [schema.prisma](C:/micro-saas/api-cobranca/prisma/schema.prisma) em duas migrações: primeiro expansão aditiva, depois remoção do legado após o corte.

- Criar `EfiOnboarding`, único por empresa, com status:
  `DRAFT`, `NOTICE_PENDING`, `AWAITING_REPRESENTATIVE`, `EFI_PROCESSING`, `SUBMISSION_UNCERTAIN`, `PROVISIONING`, `ACTIVE`, `REFUSED`, `CORRECTION_REQUIRED`, `CONFIGURATION_ERROR` e `DISCONNECTED`.
- Armazenar identificador da conta simplificada, tentativas, lembretes, erros sanitizados, consentimento, versões dos textos, usuário, IP e timestamps.
- Manter CPF, nascimento, nome da mãe e contatos do representante criptografados apenas enquanto necessários.
- Criar `PaymentFeeVersion` para tarifas globais ou sobrescritas por empresa, separadas por `PIX`, `BOLETO` e `BOLIX`.
- Representar cada componente como união discriminada:
  `FIXED` com `amountCents` ou `PERCENTAGE` com `basisPoints`.
- Criar `PaymentCharge` para permitir várias emissões relacionadas à mesma fatura, preservando cobrança original, substituições, IDs Efí, status e fotografia das tarifas.
- Acrescentar `DRAFT` ao status de fatura.
- Expandir `GatewayAccount` com versão da chave criptográfica, validade do certificado, saúde, última validação e falhas consecutivas.
- Criar `PlatformIntegrationState` para pausa operacional e saúde de Meta, Resend, abertura Efí e pagamentos, sem armazenar segredos.
- Remover posteriormente de `Company` as credenciais Meta/Resend e os campos de taxa “no prazo/recuperada”.
- Manter CNPJ único e atualizar o cadastro principal da empresa quando o onboarding for corrigido.
- Reter auditoria e comunicações por cinco anos; anonimizar destinatários após o prazo.
- Apagar dados sensíveis de onboarding após ativação ou depois de 30 dias sem avanço.

### 3. Centralizar segredos, criptografia e comunicações

- Substituir configurações por empresa por segredos do servidor para Meta, Resend e aplicação integradora Efí.
- Exigir no ambiente de produção:
  credenciais Meta, conta Resend, remetente/reply-to central, aplicação Efí de abertura, certificado integrador, conta/payee code/CNPJ da CifraMais e URLs de webhook.
- Alterar a criptografia AES-256-GCM para incluir `keyVersion` no envelope.
- Usar `PAYMENT_ENCRYPTION_KEYS` como mapa de versões e `PAYMENT_ACTIVE_KEY_VERSION` para novas gravações.
- Criar comando interno de rotação com modo de simulação padrão e `--apply`, recriptografando credenciais e dados pendentes em lotes transacionais.
- Tornar WhatsApp e e-mail globais, mantendo `companyId`, fatura e devedor apenas como contexto comercial.
- Centralizar os templates; clientes escolhem modelos aprovados e alteram somente saudação, instruções e assinatura permitidas.
- Usar nome fantasia nas mensagens, razão social como beneficiário e texto “cobrança de [empresa] via CifraMais”.
- Direcionar respostas para o atendimento central.
- Criar uma conversa global por telefone, vinculando cada mensagem enviada à empresa e cobrança correspondentes.
- Expor ao cliente somente seus próprios envios; mensagens recebidas ficam exclusivas do administrador.

### 4. Implementar o onboarding automatizado Efí

Criar módulo NestJS dedicado em `api-cobranca/src/efi-onboarding/`.

- Permitir operação somente para `COMPANY_ADMIN`; o fallback permanece restrito a `PLATFORM_ADMIN`.
- Salvar rascunho com dados da empresa, endereço, representante e consentimento.
- Aceitar representante diferente do usuário autenticado.
- Exigir declaração de autorização, termos e política de privacidade versionados.
- Enviar primeiro o aviso ao representante pelo WhatsApp da CifraMais.
- Considerar o aviso válido quando a Meta aceitar o envio; falha definitiva impede qualquer chamada à Efí.
- Repetir falhas temporárias do aviso após 5 minutos, 30 minutos e 2 horas.
- Submeter `POST /v1/conta-simplificada` uma única vez, com `meioDeNotificacao: ["whatsapp"]`.
- Solicitar apenas:
  `cobv.write`, `cobv.read`, `pix.read`, `webhook.write`, `webhook.read`, `payloadlocation.read`, `gn.pix.evp.write`, `gn.pix.evp.read`, `gn.split.write` e `gn.split.read`.
- Não solicitar `pix.write`, pois estornos permanecerão no painel da Efí.
- Aceitar tanto aplicação em conta existente quanto conta secundária.
- Bloquear edição enquanto a solicitação estiver pendente.
- Em timeout ambíguo sem identificador, usar `SUBMISSION_UNCERTAIN`, não reenviar e alertar o administrador.
- Tratar motivos funcionais de recusa de forma amigável; guardar detalhes técnicos somente para a CifraMais.
- Após recusa, bloquear nova tentativa por dois dias corridos e exigir correção e novo consentimento.
- Enviar lembretes ao representante após 24 e 72 horas e alertar a administração após sete dias.
- Usar webhook como mecanismo principal e reconciliação agendada a cada seis horas.

### 5. Provisionar e validar a conta aprovada

Ao receber `conta_aberta`:

1. Recuperar `clientId`, `clientSecret`, número da conta, dígito e `payeeCode`.
2. Validar CNPJ, conta ativa e escopos retornados.
3. Gerar e criptografar o P12 exclusivo.
4. Criar uma chave Pix EVP aleatória e exclusiva.
5. Configurar webhooks Pix e de cobranças.
6. Validar autenticação, CobV, split e API de Emissão de Cobranças.
7. Somente então marcar `GatewayAccount` e onboarding como `ACTIVE`.

- Executar as etapas idempotentes com cinco tentativas: 1, 5, 15, 30 e 60 minutos.
- Persistindo a falha, usar `CONFIGURATION_ERROR`, manter emissão bloqueada e alertar por Resend e painel.
- O fallback manual deve percorrer as mesmas validações e nunca permitir ativação forçada.
- Nunca retornar `clientSecret`, P12 ou credenciais pelas APIs.
- Ler a validade real do certificado; tentar renová-lo 30 dias antes e alertar em 30, 15 e 7 dias.
- Validar a integração antes de cada emissão, a cada seis horas e após ação administrativa.
- Após duas falhas consecutivas, bloquear novas emissões e preservar cobranças existentes.

### 6. Refatorar cobrança, split e tarifas

- Resolver a tarifa vigente na emissão: sobrescrita da empresa primeiro, configuração global depois.
- Impedir habilitação ou emissão de um método sem tarifa válida.
- Calcular cada componente sobre o valor bruto e arredondar comercialmente por componente.
- Exibir ao cliente apenas:
  valor bruto, “Taxa” total e líquido estimado/efetivo.
- Formatação:
  dois percentuais são somados; dois fixos são somados; fixo mais percentual aparece como `R$ X,XX + Y%`.
- Bloquear emissão quando `valor bruto ≤ tarifa Efí estimada + taxa CifraMais`.
- Fotografar na `PaymentCharge` a versão da tarifa usada; alterações afetam apenas novas emissões.
- Para Pix percentual, repassar o percentual integral da CifraMais e usar `divisaoTarifa: assumir_total`.
- Para Pix fixo, criar configuração dinâmica em valores fixos cuja soma corresponda ao bruto.
- Para Boleto/Bolix percentual ou fixo, usar marketplace com `mode = 1`, deixando a tarifa Efí integralmente na conta cliente.
- O split só será efetivado quando houver liquidação.
- Impedir pagamento parcial ou alteração do valor pelo pagador.
- Registrar tarifa Efí estimada na emissão e efetiva após liquidação, quando informada.
- Alertar divergência superior ao maior valor entre R$ 0,10 e 5% da estimativa.
- Manter estornos exclusivamente na Efí e apenas refletir o status recebido.
- Substituição de cobrança vencida será manual: o cliente escolhe novo vencimento, a cobrança anterior é cancelada e uma nova `PaymentCharge` usa a tarifa vigente.
- Rascunhos nunca são emitidos automaticamente após ativação.

### 7. Criar as experiências do cliente e administrador

No frontend Next.js:

- Após troca da senha temporária e novo login, redirecionar `COMPANY_ADMIN` para `/onboarding/efi`.
- Permitir “concluir depois” e manter aviso persistente enquanto não estiver ativo.
- Permitir cadastros de devedores, produtos, réguas e faturas em rascunho.
- Bloquear geração, lote e disparo de Pix/Boleto/Bolix no frontend e novamente no backend.
- Mostrar linha do tempo, motivo funcional de recusa, lembretes e ações permitidas.
- Não exibir segredos ou upload de documentos.
- Substituir “Conecte seu banco” pelo assistente automatizado para clientes.
- Criar no painel administrativo:
  acompanhamento de onboardings, falhas, pausa global, repetição de provisionamento, fallback manual e saúde mascarada;
  tarifas globais e sobrescritas por empresa;
  atendimento central;
  catálogo de templates;
  alertas de certificados e divergências de tarifa.
- Remover as taxas “no prazo” e “recuperada” das telas atuais.
- Manter MFA fora desta entrega.

## Interfaces públicas

### Cliente

- `GET /onboarding/efi`
- `PUT /onboarding/efi/draft`
- `POST /onboarding/efi/submit`
- `POST /onboarding/efi/retry`
- `GET /payments/fees?billingMethod=PIX|BOLETO|BOLIX&amountCents=...`
- `POST /payments/invoice/:id/replace`
- `GET /communications/outbound` paginado e limitado ao tenant

### Administrador

- `GET /admin/efi-onboarding`
- `GET /admin/efi-onboarding/:companyId`
- `POST /admin/efi-onboarding/:companyId/retry-provisioning`
- `POST /admin/efi-onboarding/:companyId/manual`
- `PUT /admin/integrations/efi-onboarding` com `{ enabled: boolean }`
- `GET /admin/integrations/health`
- `GET /admin/payment-fees`
- `POST /admin/payment-fees/versions`
- `GET /admin/payment-fees/:companyId`
- `POST /admin/payment-fees/:companyId/versions`

### Webhooks e códigos de erro

- `POST /webhooks/efi/account-opening`, acessível somente por mTLS.
- Manter webhooks Pix, cobranças, Meta e Resend com correlação idempotente.
- Padronizar respostas:
  `EFI_ONBOARDING_REQUIRED`, `ONBOARDING_LOCKED`, `EFI_SUBMISSION_UNCERTAIN`, `PAYMENT_METHOD_DISABLED`, `FEE_CONFIGURATION_MISSING` e `NON_POSITIVE_NET_AMOUNT`.

## Testes, infraestrutura e implantação

### Cobertura obrigatória

- Fluxo completo: cliente criado, senha alterada, rascunho, saída e retomada, aviso Meta, abertura, webhook, provisionamento e emissão.
- Recusa, bloqueio de dois dias, correção e novo consentimento.
- Falha de WhatsApp impedindo chamada à Efí.
- Timeout ambíguo sem duplicação.
- Cinco falhas de provisionamento levando a `CONFIGURATION_ERROR`.
- Escopos, certificado, EVP e webhooks obrigatórios antes de `ACTIVE`.
- Tarifas globais e sobrescritas nos seis pares de modalidade possíveis.
- Arredondamento, valor mínimo, fotografia da tarifa e divergência efetiva.
- Split fixo e percentual nos três meios.
- Substituição manual da cobrança vencida.
- Bloqueio após duas falhas de saúde.
- Segredos ausentes nas respostas e logs.
- Isolamento entre tenants e acesso de administrador.
- Histórico de envio próprio e inbox central sem acesso do cliente.
- Retenção de 30 dias, cinco anos e descarte de credenciais.
- Teste mTLS sem certificado retornando rejeição e certificado Efí válido chegando ao NestJS.

### Infraestrutura

- Publicar backend em AWS Lightsail 2 GB, região São Paulo, com Docker, Nginx e Redis local; Neon permanece externo e frontend permanece na Vercel.
- Usar hostname dedicado de webhook Efí configurado em `EFI_WEBHOOK_BASE_URL`.
- Configurar Nginx com TLS 1.2+, cadeia oficial Efí e rejeição obrigatória de clientes sem certificado.
- Manter health checks, reinício automático, logs estruturados sem PII e snapshots diários.
- Segredos ativos ficam somente no servidor.
- No desligamento de cliente, remover webhooks e segredos imediatamente; backups criptografados expiram em até 30 dias.

### Sequência de rollout

1. Subir migração aditiva e backend com abertura pausada.
2. Validar canais centrais e templates em homologação.
3. Executar fluxo completo Efí em homologação.
4. Validar Pix, Boleto e Bolix com taxas fixas e percentuais.
5. Validar Nginx/mTLS externamente.
6. Fazer backup identificado dos tenants de teste.
7. Excluir empresas de teste e seus dados dependentes.
8. Aplicar migração de remoção do legado e recriar somente o seed mínimo.
9. Configurar segredos de produção e textos aprovados pelo jurídico.
10. Executar smoke test com empresa controlada.
11. Ativar novas aberturas pelo interruptor administrativo.
12. Monitorar erros, filas, divergências e certificados durante a primeira semana.

## Premissas e limites

- Aplicável somente a novos clientes PJ; os tenants atuais são testes descartáveis após backup.
- Pix, Boleto e Bolix permanecem três formas distintas.
- Não haverá taxa de recuperação nesta versão.
- Não haverá estorno pela CifraMais, MFA, upload de documentos ou abertura para pessoa física.
- A Efí habilitará API Pix, split e API de Emissão de Cobranças na aplicação provisionada.
- Os textos jurídicos e de consentimento precisam de aprovação antes da produção.
- A conta Efí pertence ao cliente; encerramento na CifraMais não encerra a conta bancária.
- Novas emissões podem ser pausadas sem interromper integrações e cobranças já existentes.
