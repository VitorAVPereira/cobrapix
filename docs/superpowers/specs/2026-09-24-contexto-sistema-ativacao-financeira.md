# 1. Contexto do CifraMais e da ativação financeira

Data: 24/09/2026. Público: desenvolvedor que está entrando no projeto.

Este documento explica o estado encontrado no repositório e as decisões do responsável pelo produto. Não confirma o estado atual da VPS. O plano da nova demanda está em [2. Ativação financeira administrativa](../plans/2026-09-24-ativacao-financeira-administrativa.md).

## O que o sistema faz

O CifraMais é uma plataforma de cobrança para várias empresas. Cada empresa cadastra seus clientes/devedores e suas faturas. O sistema gera instruções de pagamento, envia avisos de cobrança e acompanha a liquidação. O administrador da plataforma cria e acompanha as empresas, configura integrações e tarifas e atende as conversas no canal central.

Uma empresa é um **tenant**: seus dados são separados pelo `companyId`. Um devedor pode dever a várias empresas; telefone, e-mail e CPF/CNPJ não substituem essa separação. O administrador global tem papel `PLATFORM_ADMIN`; o administrador de uma empresa tem papel `COMPANY_ADMIN`.

## Vocabulário de negócio

| Termo | Significado neste projeto |
| --- | --- |
| Cliente da plataforma / empresa | Empresa que utiliza o CifraMais para cobrar seus próprios devedores. |
| Devedor / pagador | Pessoa ou empresa que paga uma fatura dessa empresa. |
| Fatura (`Invoice`) | Obrigação comercial: devedor, valor, vencimento, situação. |
| Cobrança (`PaymentCharge`) | Emissão financeira de uma fatura, com identificação Efí, meio de pagamento, situação e versão de tarifas. Uma substituição não deve apagar a emissão anterior. |
| Ativação financeira | Processo que torna uma empresa apta a emitir cobranças; é diferente de criar seu login ou colocar seu cadastro como ativo. |
| Abertura de conta | Fluxo bancário específico da Efí que cria/vincula uma conta e disponibiliza sua integração. É uma das formas de obter uma conta utilizável. |
| Credenciais | `clientId` e `clientSecret` usados pelo backend para autenticar uma aplicação bancária. Não são login e senha do usuário no CifraMais. |
| Certificado `.p12` | Material criptográfico privado usado na integração Efí; não é o certificado HTTPS do site/Nginx. |
| Split | Instrução ao provedor para dividir um pagamento entre recebedores. Configurar um split não comprova que o dinheiro já foi repassado. |
| Repasse | Liquidação do valor devido à empresa. Deve ser distinguida do pagamento feito pelo devedor. |
| Webhook | Notificação recebida do provedor; precisa de autenticação, identificação da cobrança e tratamento de duplicatas. |

## Arquitetura e operação

- `front-cobranca`: Next.js, páginas de empresas e do administrador. Não possui acesso direto ao banco.
- `api-cobranca`: NestJS, regras de negócio, autenticação, autorização, integrações e workers.
- Prisma/PostgreSQL: persistência; o schema canônico é `api-cobranca/prisma/schema.prisma`.
- Redis/BullMQ: filas de trabalho. A fila transporta referências; o banco precisa preservar estados e impedir duplicação de operações financeiras.
- Efí: integração de pagamentos e, separadamente, abertura de contas.
- WhatsApp: número central compartilhado, com transporte Meta direto ou Datafy; as empresas terão visualização das mensagens autorizadas e as respostas ficam com o administrador.
- Resend: e-mails transacionais e de cobrança.

O histórico da configuração relata frontend na Vercel e API, PostgreSQL, Redis e Nginx na VPS InterServer. Os domínios utilizados são `ciframais.com.br`, `api.ciframais.com.br` e `efi-webhooks.ciframais.com.br`. HTTPS e renovação por Certbot foram testados na configuração anterior. A publicação continua manual; não se deve pressupor que o código local já está publicado.

## Fluxo financeiro atualmente implementado

1. O administrador cria a empresa e seu usuário.
2. O cliente acessa o CifraMais e preenche o assistente de ativação, com informações cadastrais e aceites.
3. O backend registra o pedido, envia a comunicação prevista e solicita a abertura/vinculação pela API de abertura de contas da Efí.
4. O sistema acompanha a análise e a confirmação. Pedidos com resultado incerto não são enviados novamente sem conciliação.
5. O provisionamento obtém as credenciais da conta, prepara o certificado, a chave Pix e os webhooks e valida o acesso aos recursos de pagamento.
6. Uma transação marca a ativação e a conta de integração como `ACTIVE` e registra auditoria.
7. Emissões, primeira cobrança e régua de cobrança verificam a ativação. O pagamento é processado pela conta vinculada à empresa; a remuneração da CifraMais usa a configuração de tarifas/split.

Modelos principais:

| Modelo | Responsabilidade atual |
| --- | --- |
| `Company`, `User`, `Debtor`, `Invoice` | Empresa, acesso, devedores e faturas. |
| `EfiOnboarding` | Estado da ativação, revisão do cadastro, consentimento, identificador da solicitação e checkpoints. |
| `GatewayAccount` | Conta Efí por empresa, credenciais criptografadas, certificado, chave Pix e saúde da integração. |
| `PaymentFeeVersion` | Versão da tarifa aplicada por meio de pagamento. |
| `PaymentCharge` | Emissão, valores, fotografia das tarifas, identificadores do provedor e histórico de situação. |
| `CollectionAttempt`, `CollectionLog` | Tentativas e acompanhamento operacional das cobranças. |
| `AuditLog` | Registro atribuível de operações administrativas. |

O código atual considera `EfiOnboarding.status = ACTIVE` uma condição financeira importante. `GatewayHealthService.assertIssuable` exige também conta ativa, pagamentos liberados e integração validada. Alterar apenas o status exibido no painel não prepara uma integração funcional.

## O bloqueio atual

Nos testes relatados, a autenticação Efí funcionou, mas os escopos `gn.registration.*` necessários ao fluxo de abertura não estavam disponíveis. A liberação desse serviço é uma dependência externa.

Existe `POST /admin/efi-onboarding/:companyId/manual`, mas ele é **recuperação administrativa do fluxo de abertura**: recebe `requestId` e chama `EfiOpeningClient.getCredentials`. Portanto, não resolve a nova demanda de operar sem essa API.

Os caminhos antigos também não oferecem uma alternativa pronta: `EfiService.upsertManualGatewayAccount` e `POST /payments/gateway-account` recusam o cadastro direto; `AdminService.rejectLegacyIntegrations` bloqueia a edição financeira pelo formulário genérico de cliente.

## Nova decisão de produto

O administrador deverá ativar cada cliente manualmente e escolher entre dois modos:

| Modo | Conta que emite/recebe a cobrança | Material necessário |
| --- | --- | --- |
| Conta da CifraMais | Conta Efí da plataforma, com repasse do valor devido ao cliente | Integração da plataforma e identificação validada do recebedor; não exigir certificado próprio do cliente para autenticar a cobrança da plataforma. |
| Conta própria do cliente | Conta Efí da empresa | Credenciais, certificado e dados de recebimento dessa empresa. |

O caminho automático de abertura permanece disponível para uso futuro. **Origem da ativação** e **conta usada para cobrar** são conceitos diferentes: uma ativação administrativa pode selecionar qualquer um dos dois modos; a abertura automática continua associada à conta própria do cliente.

No modo conta da CifraMais, o responsável confirmou **duas opções de repasse**: automático por split e manual após o recebimento. A configuração será por empresa e valerá para novas emissões. No repasse manual, o plano propõe transferência feita pelo administrador no banco e registro/conciliação no CifraMais; um botão de registro não deve executar uma transferência bancária escondida.

Para o modo com conta própria, a documentação Efí descreve credenciais e certificado gerados na conta digital e separados por ambiente. A API Cobranças tem sua autorização própria. Isso permite planejar a integração de uma conta existente, mantendo as validações de cada serviço utilizado. [API Pix](https://dev.efipay.com.br/docs/api-pix/credenciais/), [API Cobranças](https://dev.efipay.com.br/docs/api-cobrancas/credenciais/).

## Cuidados que afetam diretamente o desenvolvimento

1. O split atual foi escrito para a conta do cliente repassar a comissão à plataforma. Cobrar pela plataforma requer outra composição, não apenas trocar o certificado.
2. A conta e o destino utilizados precisam ser preservados em cada emissão. Consultar/cancelar uma cobrança antiga com as credenciais novas de outra conta falhará ou confundirá a conciliação.
3. No modo plataforma, várias empresas compartilham o mesmo recebedor bancário. O webhook identifica a cobrança; o `companyId` vem do vínculo persistido, não da conta compartilhada ou de um parâmetro arbitrário.
4. Cobrança paga e repasse concluído precisam de estados diferentes.
5. Credenciais da plataforma não devem ser copiadas para cada empresa. Segredos não podem aparecer em respostas, auditoria, logs ou armazenamento persistente do navegador.
6. A manutenção de certificados atual usa a API de abertura. Contas integradas manualmente precisam de renovação administrativa própria.
7. Permissões, tarifas, split e liberação de pagamentos continuam necessários. A mudança elimina a dependência de abertura, não as condições dos serviços de pagamento.

## Onde começar a leitura do código

| Área | Arquivos de entrada |
| --- | --- |
| Ativação e recuperação | `api-cobranca/src/efi-onboarding/efi-onboarding.service.ts`, `onboarding-admin.service.ts`, `onboarding-provisioner.ts` |
| Tarefas e manutenção | `onboarding-workflow.ts`, `onboarding-worker.ts`, `onboarding-maintenance.ts`, `onboarding-lifecycle.ts`, `onboarding-events.ts` na mesma pasta |
| Emissão e conciliação | `api-cobranca/src/payment/payment.service.ts`, `payment-charge.service.ts`, `efi.service.ts`, `gateway-health.service.ts` |
| Acesso à Efí e certificados | `api-cobranca/src/payment/efi-gateway.client.ts`, `efi-certificate.ts`, `payment-crypto.service.ts` |
| Proteções de negócio | `api-cobranca/src/billing/billing.service.ts`, `src/invoices/invoices.service.ts`, `src/queue/workers/message.worker.ts` |
| Painel administrativo | `front-cobranca/src/app/(dashboard)/admin/clientes/page.tsx`, `admin/efi-onboarding/page.tsx` |
| Visão da empresa | `front-cobranca/src/app/(dashboard)/onboarding/efi/page.tsx`, `src/lib/efi-onboarding.ts` |

## Estado das outras entregas

Há implementação local e registros de execução das etapas 1–7 do Datafy: transporte, persistência, webhooks, envio, atribuição por empresa, telas e mídias. O registro mais recente da etapa 7 relata 84 suítes/549 testes de backend, 35 suítes/123 testes de frontend, builds e integração com PostgreSQL. São resultados registrados naquela execução, não uma nova certificação feita para este documento. Consultar os registros das [etapas 4](../plans/2026-09-24-datafy-stage4-execution.md), [5](../plans/2026-09-24-datafy-stage5-execution.md), [6](../plans/2026-09-24-datafy-stage6-execution.md) e [7](../plans/2026-09-24-datafy-stage7-execution.md) antes de alterar os módulos relacionados.

As validações externas e a publicação têm etapas próprias. A nova ativação financeira não deve mudar o transporte Datafy ou depender da implantação dessas telas. Existem alterações locais ainda não versionadas; não confundir esses arquivos com entregas já publicadas na VPS.

Esta entrega é documental. Nenhuma ativação, movimentação financeira ou publicação foi executada para produzir estes dois documentos.
