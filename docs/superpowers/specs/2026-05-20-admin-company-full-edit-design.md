# Edicao completa de empresas pelo admin da plataforma

## Contexto

O painel `front-cobranca/src/app/(dashboard)/admin/clientes/page.tsx` ja permite que usuarios `PLATFORM_ADMIN` cadastrem empresas, configurem alguns dados de cobranca, Meta Cloud API e Efi, e ressetem a senha do primeiro usuario administrador da empresa.

O backend `api-cobranca/src/admin` ja expoe `GET /admin/clients`, `GET /admin/clients/:id`, `POST /admin/clients`, `PUT /admin/clients/:id` e `POST /admin/clients/:id/reset-password`, protegidos por `JwtAuthGuard`, `PlatformAdminGuard` e `ThrottleGuard`.

A edicao atual cobre apenas parte dos campos da empresa. O objetivo e permitir que o admin da plataforma edite todas as informacoes operacionais e configuracoes relevantes de qualquer empresa cadastrada, com revisao explicita das alteracoes antes de salvar.

## Objetivos

- Permitir edicao de todos os campos editaveis da empresa no painel admin.
- Exibir um modal de confirmacao antes de salvar, listando cada campo alterado com valor atual e novo valor.
- Permitir substituicao de dados sensiveis, incluindo token Meta, credenciais Efi, senha/certificado e chaves relacionadas.
- Mostrar dados sensiveis somente no momento de confirmacao quando forem novos valores digitados nessa edicao.
- Proteger dados sensiveis apos a confirmacao: a API nao deve retornar segredos em texto plano e a UI deve limpar valores sensiveis do estado apos salvar.

## Fora de escopo

- Edicao direta de campos tecnicos imutaveis como `id`, `createdAt`, `updatedAt` e campos criptografados brutos.
- Edicao direta de relacoes historicas como faturas, devedores, tentativas de cobranca, logs e notificacoes ja emitidas.
- Exibir valores sensiveis atualmente salvos, pois eles ficam criptografados ou protegidos no backend.

## Campos editaveis

### Empresa

- `corporateName`
- `document`
- `email`
- `phoneNumber`
- `status`
- `gatewayProvider`
- `gatewayStatus`
- `legalRepresentative`
- `legalRepresentativeCpf`
- `legalRepresentativeBirthDate`
- `addressPostalCode`
- `addressStreet`
- `addressNumber`
- `addressDistrict`
- `addressCity`
- `addressState`
- `bankName`
- `bankAgency`
- `bankAccount`
- `maxDiscountsPerDebtor`
- `discountTriggerDay`
- `collectionReminderDays`
- `autoGenerateFirstCharge`
- `autoDiscountEnabled`
- `autoDiscountDaysAfterDue`
- `autoDiscountPercentage`
- `preferredBillingMethod`
- `enabledBillingMethods`
- `onTimeSplitPercentageBps`
- `overdueSplitPercentageBps`
- `businessSegment`
- `paymentNotificationEnabled`
- `paymentNotificationEmails`
- `whatsappProvider`
- `whatsappInstanceId`
- `whatsappStatus`
- `metaPhoneNumberId`
- `metaBusinessAccountId`
- `metaBusinessPhoneNumber`
- `metaDefaultLanguage`
- `messagingLimitTier`
- `resendFromEmail`
- `erpWebhookUrl`
- `erpEnabledEvents`

### Segredos substituiveis

Estes campos podem ser enviados como novos valores, mas nao devem ser retornados em texto plano pelo backend:

- `metaAccessToken`
- `resendApiKey`
- `erpApiKey`
- `efiClientId`
- `efiClientSecret`
- `efiCertificateBase64`
- `efiCertificatePassword`

### Gateway Efi

- `environment`
- `status`
- `payeeCode`
- `efiAccountNumber`
- `efiAccountDigit`
- `pixKey`
- `certificatePath` quando nao houver upload em base64

## Backend

### Contratos

`AdminClientResponse` deve retornar uma visao completa e segura da empresa:

- dados cadastrais, operacionais, cobranca, notificacoes, Meta e ERP;
- dados nao sensiveis da conta Efi;
- marcadores booleanos como `hasMetaAccessToken`, `hasResendApiKey`, `hasErpApiKey`, `hasEfiClientId`, `hasEfiClientSecret` e `hasEfiCertificate`;
- nunca retornar tokens, secrets, certificados, senhas ou hashes em texto plano.

`UpdateAdminClientDto` deve aceitar um payload completo e tipado, dividido em secoes:

- `company`
- `billing`
- `notifications`
- `whatsapp`
- `integrations`
- `efi`

Cada DTO deve usar `class-validator`, tipos explicitos e limites coerentes com o schema Prisma.

### Persistencia

`AdminService.updateClient` deve:

- validar que a empresa existe;
- atualizar `Company` com os campos editaveis recebidos;
- normalizar documentos, telefones, CPF e CEP com `onlyDigits` onde fizer sentido;
- criptografar ou hashear segredos antes de persistir;
- chamar os servicos especializados quando a regra de negocio exigir comportamento existente, como Meta e Efi;
- manter segredos atuais quando o campo sensivel vier vazio ou ausente;
- atualizar apenas os blocos enviados, sem limpar configuracoes por acidente.

### Multi-tenancy

Rotas admin continuam restritas a `PLATFORM_ADMIN`. Por serem rotas globais de administracao da plataforma, elas podem buscar empresas por `id` sem `companyId` do usuario logado, mas somente dentro do modulo admin protegido por `PlatformAdminGuard`.

## Frontend

### Fluxo

- A tabela de clientes ganha acao `Editar`.
- Ao clicar em `Editar`, a tela entra em modo edicao para a empresa selecionada.
- O formulario reaproveita o layout atual, mas separa os campos em blocos:
  - Empresa
  - Cobranca e taxas
  - Notificacoes
  - WhatsApp e Meta
  - Efi
  - ERP e e-mail
- Campos sensiveis aparecem vazios ou mascarados, com indicacao de que deixar vazio mantem o valor atual.
- Se o admin preencher um campo sensivel, o novo valor fica disponivel apenas no estado local ate a confirmacao/salvamento.

### Modal de confirmacao

Antes de chamar `PUT /admin/clients/:id`, a UI deve comparar o snapshot carregado com o formulario atual e exibir:

- nome do campo;
- valor atual;
- novo valor;
- destaque visual para campos sensiveis.

Regras para sensiveis:

- valor atual aparece como `Protegido` quando existir;
- novo valor digitado pode ser exibido no modal de confirmacao;
- se o campo sensivel ficar vazio, ele nao aparece como alterado e o valor salvo e mantido;
- apos salvar ou cancelar a edicao, os campos sensiveis digitados devem ser limpos do estado local.

### Criacao versus edicao

- Criacao continua exigindo primeiro usuario administrador e senha temporaria.
- Edicao nao altera senha do usuario administrador; isso continua no fluxo de reset de senha.
- Criacao pode exigir campos Efi quando a conta Efi estiver sendo configurada.
- Edicao permite alterar parcialmente Efi e manter credenciais/certificado existentes quando campos sensiveis ficarem vazios.

## Tratamento de erros

- Erros HTTP continuam passando pelo `api-client.ts` e devem aparecer com mensagens amigaveis.
- Validacoes do backend devem impedir listas vazias de metodos de cobranca, percentuais fora da faixa e enums invalidos.
- A UI deve impedir salvar se nao houver nenhuma alteracao.
- Se a confirmacao for cancelada, nada deve ser enviado ao backend.

## Testes

### Backend

- `AdminService.updateClient` atualiza campos completos de `Company`.
- `AdminService.updateClient` substitui segredos quando novos valores sao enviados.
- `AdminService.updateClient` mantem segredos existentes quando campos sensiveis ficam ausentes.
- `AdminClientResponse` nunca contem tokens, secrets, certificados, senhas ou hashes.

### Frontend

- Clicar em `Editar` preenche o formulario com dados nao sensiveis da empresa.
- Alterar campos e enviar abre modal de confirmacao com campo, valor atual e novo valor.
- Novos valores sensiveis digitados aparecem no modal de confirmacao e sao limpos apos salvar.
- Confirmar chama `updateAdminClient`; cancelar nao chama a API.

### API client

- `updateAdminClient` usa `PUT /admin/clients/:id`.
- Payload Efi com `efiCertificateBase64` remove caminho de certificado, igual ao fluxo de criacao.

## Criterios de aceite

- Um `PLATFORM_ADMIN` consegue editar configuracoes completas de qualquer empresa cadastrada.
- A tela mostra exatamente quais campos mudarao antes de salvar.
- Dados sensiveis podem ser substituidos e conferidos no modal apenas quando digitados na edicao.
- Apos salvar, dados sensiveis nao ficam expostos na resposta da API nem persistem visiveis na UI.
- Testes relevantes de backend, frontend e API client passam.
