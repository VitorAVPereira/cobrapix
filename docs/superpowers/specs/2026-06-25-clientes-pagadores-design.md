# Clientes Pagadores Design

## Contexto

O CobraPix hoje cria e atualiza pagadores principalmente a partir da tela de cobrancas. O schema ja possui `Debtor` como entidade separada, mas o usuario comum ainda nao tem uma pagina dedicada para ver todos os clientes pagadores, criar um cliente sem cobranca e manter dados cadastrais fora do fluxo de fatura.

A tela admin existente `Admin > Clientes` representa clientes da plataforma (`Company`). A nova tela `Clientes` e para usuarios da empresa e representa os pagadores/devedores cadastrados em `Debtor`.

## Decisao

Criar uma pagina operacional chamada `Clientes`, acessivel para `COMPANY_ADMIN`, usando `Debtor` como cadastro mestre de pagadores.

O cliente pagador pode existir sem nenhuma cobranca. Para a primeira versao:

- `name`, `document` e `phoneNumber` sao obrigatorios.
- `email` e opcional.
- `phoneNumber` continua obrigatorio e unico por empresa.
- Nao ha alteracao de schema Prisma nesta etapa.
- Todo cliente deve ter perfil de pagador.
- Ao criar um cliente sem perfil informado, o backend atribui automaticamente o perfil padrao de tipo `NEW`, exibido na UI como "Novo pagador".
- O perfil de pagador continua editavel na propria tela por meio de `collectionProfileId`, mas nao pode ser removido para ficar vazio.

## Objetivos

- Listar todos os clientes pagadores cadastrados pela empresa.
- Permitir cadastrar cliente sem criar cobranca.
- Permitir editar nome, CPF/CNPJ, WhatsApp, e-mail, opt-in e perfil de pagador.
- Exibir informacoes operacionais por cliente:
  - perfil de pagador;
  - quantidade e valor de cobrancas em aberto;
  - quantidade e valor de cobrancas pagas;
  - ultima cobranca ou ultimo pagamento quando disponivel.
- Permitir abrir cobrancas em aberto do cliente na tela de cobrancas ja filtrada.
- Permitir criar nova cobranca para um cliente existente sem redigitar dados do pagador.
- Reaproveitar os modais existentes de historico de pagamentos e configuracao de cobranca/perfil quando fizer sentido.

## Fora de escopo

- Cliente sem WhatsApp.
- Importacao em massa de clientes sem cobranca.
- Excluir cliente.
- Mesclar clientes duplicados.
- Reenviar cobranca pela tela de clientes.
- Criar grafico ou painel analitico profundo por cliente.
- Alterar regras de classificacao automatica de perfis.
- Alterar a tela admin `Admin > Clientes`.
- Exibir quantidade de clientes sem perfil.

## Backend

### Rotas

Adicionar rotas autenticadas em `InvoicesController`, sob `/invoices/debtors`, protegidas por `JwtAuthGuard` e `ThrottleGuard`.

- `GET /invoices/debtors`
- `POST /invoices/debtors`
- `PUT /invoices/debtors/:debtorId`

Essas rotas convivem com as rotas ja existentes:

- `POST /invoices/debtors/:debtorId/invoices`
- `GET /invoices/debtors/:debtorId/settings`
- `PUT /invoices/debtors/:debtorId/settings`
- `GET /invoices/debtors/:debtorId/payment-history`

O controller deve validar UUIDs antes de delegar ao service.

### Listagem

`GET /invoices/debtors`

Query params:

- `page?: string`
- `pageSize?: string`
- `search?: string`
- `profileId?: string`
- `paymentStatus?: "all" | "open" | "paid" | "no_open"`

Resposta:

```ts
interface DebtorListResponse {
  data: DebtorListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: DebtorListSummary;
}

interface DebtorListSummary {
  totalDebtors: number;
  openInvoiceAmount: number;
  openInvoiceCount: number;
  paidInvoiceAmount: number;
  paidInvoiceCount: number;
}

interface DebtorListItem {
  debtorId: string;
  name: string;
  document: string;
  phone_number: string;
  email: string | null;
  whatsapp_opt_in: boolean;
  whatsappOptInAt: string | null;
  collectionProfile: {
    id: string;
    name: string;
    profileType: CollectionProfileType;
  };
  openInvoicesCount: number;
  openInvoicesAmount: number;
  paidInvoicesCount: number;
  paidInvoicesAmount: number;
  lastInvoiceAt: string | null;
  lastPaymentAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Busca deve considerar:

- nome;
- documento normalizado;
- WhatsApp;
- e-mail.

Resumo financeiro:

- cobrancas em aberto: `Invoice.status = PENDING`;
- cobrancas pagas: `Invoice.status = PAID`;
- valores usam `Invoice.originalAmount`;
- valores devem ser convertidos de `Decimal` para `number`.

Antes de listar, criar ou editar clientes, a feature deve garantir que os perfis padrao da empresa existam. Clientes legados com `collectionProfileId = null` devem ser vinculados ao perfil ativo de tipo `NEW` para que a listagem nao exiba clientes sem perfil.

### Criacao

`POST /invoices/debtors`

Payload:

```ts
interface CreateDebtorInput {
  name: string;
  document: string;
  phone_number: string;
  email?: string | null;
  whatsappOptIn?: boolean;
  collectionProfileId?: string;
}
```

Regras:

- `name` obrigatorio.
- `document` obrigatorio e validado com as regras ja existentes de CPF/CNPJ.
- `phone_number` obrigatorio e normalizado com a regra atual de WhatsApp.
- `email` opcional; se informado, deve ter formato valido.
- `collectionProfileId`, quando informado, precisa existir para a mesma empresa.
- se `collectionProfileId` nao for informado, usar automaticamente o perfil ativo de tipo `NEW`;
- rejeitar `collectionProfileId` vazio ou `null`.
- Se o WhatsApp ja existir para a empresa, retornar erro amigavel de duplicidade.

### Edicao

`PUT /invoices/debtors/:debtorId`

Payload:

```ts
interface UpdateDebtorInput {
  name?: string;
  document?: string;
  phone_number?: string;
  email?: string | null;
  whatsappOptIn?: boolean;
  collectionProfileId?: string;
}
```

Regras:

- sempre filtrar por `id` e `companyId`;
- retornar `404` quando o pagador nao pertencer a empresa;
- manter validacoes de documento, WhatsApp, e-mail e perfil;
- rejeitar tentativa de salvar `collectionProfileId` vazio ou `null`;
- ao mudar WhatsApp, validar duplicidade dentro da empresa;
- se `whatsappOptIn` mudar para `true`, preencher `whatsappOptInAt` quando ainda estiver vazio e usar uma fonte explicita como `manual-client-page`.

### Filtro em cobrancas

Adicionar suporte a `debtorId` em:

- `GET /invoices?debtorId=<id>&status=PENDING`
- `ApiClient.getInvoices({ debtorId, status })`
- `front-cobranca/src/app/(dashboard)/cobrancas/page.tsx`

A tela de cobrancas deve ler `debtorId` e `status` da URL e aplicar esses filtros na chamada inicial. O filtro de busca atual continua funcionando.

## Frontend

### Navegacao

Adicionar item `Clientes` para usuarios `COMPANY_ADMIN` no menu principal do dashboard, separado de `Admin > Clientes`.

Rota:

- `front-cobranca/src/app/(dashboard)/clientes/page.tsx`

Icone recomendado:

- `Users` ou `Contact` de `lucide-react`.

### Layout

A pagina segue uma visao operacional:

- header com titulo `Clientes`;
- botao `Novo cliente`;
- cards compactos com totais:
  - clientes cadastrados;
  - valor em aberto;
  - cobrancas pagas;
- busca por nome, CPF/CNPJ, WhatsApp ou e-mail;
- filtro por perfil de pagador;
- filtro operacional simples, como todos, com aberto, sem aberto ou com pagas;
- tabela densa com colunas:
  - Cliente;
  - Contato;
  - Perfil;
  - Em aberto;
  - Pagas;
  - Acoes.

Na coluna `Acoes`, usar um botao de icone com `MoreVertical` e `aria-label="Abrir acoes do cliente"`. O texto "Abrir menu" nao deve aparecer na tabela.

### Modal de cliente

O modal de criar/editar cliente deve conter:

- nome;
- CPF/CNPJ;
- WhatsApp;
- e-mail opcional;
- checkbox de opt-in WhatsApp oficial;
- select de perfil de pagador preselecionado como "Novo pagador" ao criar.

Estados:

- loading ao carregar perfis;
- saving ao salvar;
- erro amigavel vindo da API;
- sucesso apos criar ou editar.

### Acoes por cliente

Menu de acoes:

- Editar cliente.
- Nova cobranca.
- Ver cobrancas em aberto.
- Historico de pagamentos.
- Configurar perfil/cobranca.

Comportamentos:

- `Editar cliente` abre o modal de cliente preenchido.
- `Nova cobranca` abre o modal de cobranca para aquele `debtorId`, sem pedir dados cadastrais do pagador.
- `Ver cobrancas em aberto` navega para `/cobrancas?debtorId=<debtorId>&status=PENDING`.
- `Historico de pagamentos` reaproveita `DebtorPaymentHistoryModal`.
- `Configurar perfil/cobranca` reaproveita `DebtorSettingsModal` ou o mesmo formulario de edicao quando a configuracao ficar equivalente.
- Qualquer modal reaproveitado deve remover a opcao "sem perfil" e impedir gravar `collectionProfileId = null`.

## API client

Adicionar tipos e metodos em `front-cobranca/src/lib/api-client.ts`:

- `DebtorListItem`
- `DebtorListSummary`
- `DebtorListResponse`
- `CreateDebtorInput`
- `UpdateDebtorInput`
- `getDebtors(params)`
- `createDebtor(data)`
- `updateDebtor(debtorId, data)`

Atualizar:

- `getInvoices(params)` para aceitar `debtorId`.

## Tratamento de erros

Backend:

- `400` para documento invalido, WhatsApp invalido, e-mail invalido ou perfil invalido.
- `400` para tentativa de remover o perfil de pagador.
- `404` para cliente nao encontrado na empresa.
- `409` para WhatsApp duplicado na empresa.

Frontend:

- mostrar mensagens amigaveis no topo da pagina ou dentro do modal;
- manter os dados preenchidos quando salvar falhar;
- desabilitar botao de salvar durante envio;
- estado vazio quando nao houver cliente cadastrado;
- estado vazio filtrado quando a busca nao encontrar clientes.

## Testes

### Backend

- cria cliente sem cobranca.
- cria cliente com perfil `NEW` quando nenhum perfil e enviado.
- exige nome, CPF/CNPJ e WhatsApp.
- aceita e-mail ausente.
- normaliza WhatsApp antes de salvar.
- rejeita WhatsApp duplicado na mesma empresa.
- permite mesmo WhatsApp em empresas diferentes somente se a regra atual permitir por `companyId`.
- edita dados cadastrais e perfil.
- rejeita remocao de perfil.
- rejeita perfil de outra empresa.
- vincula clientes legados sem perfil ao perfil `NEW`.
- lista clientes sem cobranca.
- retorna sempre `collectionProfile` preenchido na listagem de clientes.
- calcula quantidade e valor de cobrancas `PENDING`.
- calcula quantidade e valor de cobrancas `PAID`.
- aplica busca por nome, documento, WhatsApp e e-mail.
- `GET /invoices` filtra por `debtorId` e `status`.

### Frontend

- renderiza cards e tabela com retorno da API.
- abre menu pelo botao de icone.
- abre modal de novo cliente.
- modal de novo cliente vem com "Novo pagador" selecionado.
- valida campos obrigatorios antes de enviar.
- cria cliente com e-mail opcional.
- edita cliente existente.
- navega para `/cobrancas?debtorId=<id>&status=PENDING` ao clicar em ver cobrancas em aberto.
- abre modal de historico de pagamentos.
- abre configuracao de perfil/cobranca.
- tela de cobrancas usa `debtorId` e `status` da URL na chamada inicial.

## Riscos

- A palavra "Clientes" ja existe na area admin para clientes da plataforma. A navegacao deve deixar claro que usuarios comuns veem clientes pagadores, enquanto platform admins continuam na area admin.
- O service de invoices ja concentra muitas responsabilidades. A implementacao deve considerar extrair helpers internos ou um service pequeno para debtors se a alteracao deixar o arquivo dificil de manter.
- Resumos por cliente podem ficar caros com grande volume de invoices. A primeira versao pode agregar com Prisma e consolidacao em memoria, mas deve manter paginacao e indices existentes por `companyId`, `debtorId` e status.
- Reaproveitar modais existentes pode expor termos antigos como "devedor". A UI nova deve preferir "cliente" ou "pagador" quando estiver na pagina Clientes.

## Criterios de aceite

- Usuario `COMPANY_ADMIN` ve o item `Clientes` no menu principal.
- A pagina lista clientes cadastrados mesmo sem cobranca.
- O usuario cria cliente informando nome, CPF/CNPJ e WhatsApp, com e-mail opcional.
- Cliente criado sem perfil selecionado explicitamente recebe o perfil "Novo pagador".
- A pagina nao exibe card ou contagem de clientes sem perfil.
- O usuario edita dados cadastrais e perfil de pagador.
- A tabela mostra perfil, cobrancas em aberto e cobrancas pagas por cliente.
- A coluna de acoes usa botao de icone, nao texto "Abrir menu".
- `Ver cobrancas em aberto` leva para a tela de cobrancas filtrada pelo cliente e status pendente.
- `Nova cobranca` cria fatura para o cliente selecionado sem redigitar dados cadastrais.
- Historico de pagamentos e configuracao de perfil continuam acessiveis.
- Testes relevantes de backend, frontend e API client passam.
