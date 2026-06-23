# Admin Visao Geral Analytics Design

## Contexto

O painel admin ja possui a rota `front-cobranca/src/app/(dashboard)/admin/clientes/page.tsx` para cadastro, edicao, reset de senha e configuracoes operacionais de clientes. Essa tela deve continuar focada em CRUD e configuracao.

O backend admin ja expoe rotas protegidas por `JwtAuthGuard`, `PlatformAdminGuard` e `ThrottleGuard` em `api-cobranca/src/admin`. O schema Prisma ja contem as entidades necessarias para uma primeira visao analitica: `Company`, `Invoice`, `CollectionAttempt`, `CollectionLog` e `EmailEvent`.

O objetivo e criar uma aba separada de administracao chamada "Visao geral", com leitura macro de todos os clientes e filtro individual por cliente, sem misturar analytics com cadastro/edicao.

## Decisao

Criar uma rota analitica dedicada no backend:

- `GET /admin/clients/analytics`

Criar uma nova tela no frontend:

- `front-cobranca/src/app/(dashboard)/admin/visao-geral/page.tsx`

A tela `Admin > Clientes` continua exclusiva para cadastro e edicao. A nova tela `Admin > Visao geral` mostra cards macro, filtros e tabela comparativa por cliente.

## Objetivos

- Mostrar indicadores agregados de todos os clientes.
- Permitir filtrar a mesma visao por cliente especifico.
- Mostrar tabela comparativa por cliente com as mesmas metricas dos cards.
- Usar periodo padrao de mes atual.
- Permitir periodos selecionaveis e periodo customizado.
- Calcular custo interno estimado de WhatsApp como `R$ 0,33` por mensagem enviada com sucesso.
- Tratar e-mail como custo zero.
- Medir recuperacao somente quando houve inadimplencia, tentativa de cobranca e pagamento posterior.

## Fora de escopo

- Alterar o dashboard comum do cliente em `front-cobranca/src/app/(dashboard)/page.tsx`.
- Alterar regras de cobranca, envio, templates ou filas.
- Criar persistencia nova de custo por mensagem.
- Criar relatorios exportaveis.
- Criar graficos historicos ou comparativos mes contra mes.
- Cobrar clientes automaticamente pelo custo calculado.

## Metricas

Todas as metricas financeiras de cobrancas usam `Invoice.createdAt` para o recorte de periodo, salvo quando especificado de outra forma.

### Periodo

Periodo padrao:

- Mes atual.

Periodos suportados:

- `current_month`
- `today`
- `7d`
- `30d`
- `year`
- `custom`, usando `startDate` e `endDate`

O backend deve retornar o periodo normalizado com `startDate` e `endDate`, para a UI exibir claramente o intervalo aplicado.

Datas customizadas devem ser inclusivas por dia de calendario: `startDate` representa o inicio do dia e `endDate` representa o inicio do dia seguinte como limite exclusivo. Isso evita perder eventos no ultimo dia por diferencas de horario.

### Valores e contagens

`totalChargedAmount`

- Soma de `Invoice.originalAmount` das cobrancas criadas no periodo.

`activeChargesCount`

- Contagem de invoices `PENDING` criadas no periodo com `dueDate >= hoje`.

`overduePendingChargesCount`

- Contagem de invoices `PENDING` criadas no periodo com `dueDate < hoje`.

`canceledChargesCount`

- Contagem de invoices `CANCELED` criadas no periodo.

`pendingTotalAmount`

- Soma de `Invoice.originalAmount` de invoices `PENDING` criadas no periodo, incluindo dentro do prazo e vencidas.

`overduePendingAmount`

- Soma de `Invoice.originalAmount` de invoices `PENDING` criadas no periodo com `dueDate < hoje`.

`averageTicketAmount`

- Media de `Invoice.originalAmount` das invoices criadas no periodo com status `PENDING` ou `PAID`.
- Invoices `CANCELED` nao entram no calculo.

### Mensagens e e-mails

`whatsappSentCount`

- Contagem de tentativas `CollectionAttempt` com `channel = WHATSAPP` e status de sucesso.
- Status de sucesso para WhatsApp: `SENT`, `DELIVERED`, `OPENED`, `CLICKED`.
- O periodo usa `CollectionAttempt.createdAt`.

`whatsappCostAmount`

- `whatsappSentCount * 0.33`.
- O valor e estimativa interna fixa em reais.

`emailSentCount`

- Contagem de tentativas `CollectionAttempt` com `channel = EMAIL` e status de sucesso.
- Status de sucesso para e-mail: `SENT`, `DELIVERED`, `OPENED`, `CLICKED`.
- O periodo usa `CollectionAttempt.createdAt`.

`emailCostAmount`

- Sempre `0`.

`MessagingUsage` nao deve ser usada para custo, porque registra uso por numero unico e nao representa disparos historicos por mensagem.

### Cobrancas recuperadas

Uma cobranca recuperada deve cumprir todas as regras:

- `Invoice.status = PAID`.
- `Invoice.paidAt` existe.
- `Invoice.paidAt > Invoice.dueDate`.
- Existe pelo menos uma `CollectionAttempt` `EMAIL` ou `WHATSAPP` relacionada a invoice.
- A tentativa foi criada antes do pagamento: `CollectionAttempt.createdAt < Invoice.paidAt`.

Metricas:

- `recoveredChargesCount`: quantidade de invoices recuperadas.
- `recoveredAmount`: soma de `Invoice.originalAmount` dessas invoices.

O periodo de recuperacao deve usar `Invoice.paidAt`, porque a recuperacao acontece quando o pagamento atrasado foi confirmado.

## Backend

### Contrato HTTP

Adicionar em `AdminController`:

- `GET /admin/clients/analytics`

Guards:

- `JwtAuthGuard`
- `PlatformAdminGuard`
- `ThrottleGuard`

Query params:

- `period?: "current_month" | "today" | "7d" | "30d" | "year" | "custom"`
- `startDate?: string`
- `endDate?: string`
- `companyId?: string`
- `search?: string`
- `page?: string`
- `pageSize?: string`

`period` ausente deve ser tratado como `current_month`.

### Resposta

```ts
interface AdminClientAnalyticsResponse {
  period: {
    key: string;
    startDate: string;
    endDate: string;
  };
  totals: AdminClientAnalyticsMetrics;
  clients: AdminClientAnalyticsRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

interface AdminClientAnalyticsRow {
  companyId: string;
  corporateName: string;
  document: string;
  email: string;
  status: string;
  metrics: AdminClientAnalyticsMetrics;
}

interface AdminClientAnalyticsMetrics {
  totalChargedAmount: number;
  activeChargesCount: number;
  overduePendingChargesCount: number;
  canceledChargesCount: number;
  pendingTotalAmount: number;
  overduePendingAmount: number;
  whatsappSentCount: number;
  whatsappCostAmount: number;
  emailSentCount: number;
  emailCostAmount: number;
  averageTicketAmount: number;
  recoveredChargesCount: number;
  recoveredAmount: number;
}
```

### Servico

Criar `AdminAnalyticsService` dentro de `api-cobranca/src/admin`.

Responsabilidades:

- Normalizar periodo.
- Aplicar filtro por `companyId`.
- Aplicar busca por `corporateName`, `email` ou `document`.
- Buscar empresas visiveis ao admin.
- Agregar metricas por `companyId`.
- Montar totais macro a partir das linhas por cliente.
- Converter `Decimal` Prisma para `number`.
- Garantir custo WhatsApp com duas casas decimais.

Manter essa logica fora do CRUD principal evita que `AdminService` cresca demais e deixa analytics pronto para otimizacao futura.

### Estrategia de agregacao

O MVP pode usar um conjunto pequeno de queries Prisma agregadas por tabela e consolidacao em memoria por `companyId`:

- Empresas filtradas e paginadas.
- Invoices criadas no periodo.
- Collection attempts de WhatsApp e e-mail no periodo.
- Invoices recuperadas usando `paidAt` no periodo e existencia de tentativa antes de `paidAt`.

Se a query de recuperacao ficar pesada em Prisma puro, usar `prisma.$queryRaw` tipado e parametrizado para essa metrica especifica. A consulta deve continuar filtrando por empresas elegiveis e nunca interpolar strings inseguras.

### Multi-tenancy e seguranca

A rota e global da plataforma e pode consultar multiplas empresas, mas somente quando o usuario autenticado passa por `PlatformAdminGuard`.

O endpoint nao retorna segredos, tokens, chaves, certificados, hashes ou dados de configuracao sensivel. Retorna somente identificacao basica da empresa e metricas.

## Frontend

### Navegacao

Adicionar uma entrada de menu para admin:

- `Visao geral`
- `Clientes`

`Clientes` permanece apontando para a tela atual de cadastro/edicao.

`Visao geral` aponta para a nova rota analitica.

### Tela

Criar `front-cobranca/src/app/(dashboard)/admin/visao-geral/page.tsx` como client component.

Estrutura:

- Header com titulo "Visao geral" e contexto financeiro/operacional.
- Barra de filtros com periodo, busca por cliente e filtro de cliente quando aplicavel.
- Cards macro com:
  - Valor cobrado
  - Pendente total
  - Vencido pendente
  - Recuperado
  - Ticket medio
  - WhatsApp e custo
  - E-mails
- Tabela por cliente com:
  - Cliente/status
  - Cobrado
  - Pendente total
  - Vencido pendente
  - Ativas
  - Canceladas
  - Recuperadas
  - WhatsApp/custo
  - E-mails
  - Ticket medio

Usar layout denso e operacional, coerente com o admin existente. A tabela pode manter scroll horizontal em telas pequenas.

### API client

Adicionar tipos e metodo em `front-cobranca/src/lib/api-client.ts`:

- `AdminClientAnalyticsMetrics`
- `AdminClientAnalyticsRow`
- `AdminClientAnalyticsResponse`
- `getAdminClientAnalytics(params)`

O metodo deve montar query params somente com valores preenchidos.

### Estados de UI

- Loading nos cards e tabela.
- Alerta de erro quando o endpoint falhar.
- Estado vazio quando nao houver clientes ou metricas no periodo.
- Valores monetarios formatados em BRL.
- Contagens formatadas em `pt-BR`.

## Tratamento de erros

Backend:

- `period` desconhecido retorna `400`.
- `custom` sem `startDate` e `endDate` validos retorna `400`.
- `companyId` inexistente retorna resposta vazia, com `totals` zerado e `clients` vazio, para manter comportamento de filtro.

Frontend:

- Erros aparecem como alerta na pagina.
- Filtros invalidos de data customizada devem impedir chamada e pedir ajuste localmente.

## Testes

### Backend

- `AdminAnalyticsService` usa mes atual como periodo padrao.
- Calcula `totalChargedAmount` por `Invoice.createdAt`.
- Separa `activeChargesCount` de `overduePendingChargesCount`.
- Calcula `pendingTotalAmount` e `overduePendingAmount`.
- Exclui `CANCELED` do ticket medio.
- Calcula custo WhatsApp como `whatsappSentCount * 0.33`.
- Conta e-mails enviados com sucesso e custo zero.
- Nao conta recuperacao quando o pagamento foi no prazo.
- Nao conta recuperacao quando nao houve tentativa de cobranca.
- Conta recuperacao quando `paidAt > dueDate` e existe tentativa anterior ao pagamento.
- Filtra por `companyId` e `search`.
- Endpoint exige `PLATFORM_ADMIN`.

### Frontend

- `api-client` monta query params corretamente.
- A pagina renderiza cards com valores retornados.
- A tabela renderiza uma linha por cliente.
- Periodo e busca disparam recarregamento.
- Estados de loading, erro e vazio aparecem corretamente.
- Valores monetarios usam BRL e contagens usam `pt-BR`.

## Riscos

- Historico antigo pode ter `CollectionLog` sem `CollectionAttempt`; recuperacao baseada apenas em attempts pode subcontar casos antigos. O plano de implementacao deve decidir se ha necessidade de fallback por `CollectionLog` apos olhar os dados existentes.
- Queries multi-cliente podem ficar caras com volume alto. O endpoint separado permite paginação e futura otimizacao sem afetar o CRUD admin.
- `CollectionAttempt.createdAt` representa momento da tentativa, nao necessariamente entrega real. Para o MVP, "enviado com sucesso" segue status da tentativa.

## Criterios de aceite

- Um `PLATFORM_ADMIN` acessa `Admin > Visao geral`.
- `Admin > Clientes` continua focado em cadastro e edicao, sem cards analiticos.
- Periodo padrao da visao geral e mes atual.
- Cards macro e tabela por cliente seguem as metricas aprovadas.
- Filtro por cliente recalcula a visao para o cliente selecionado.
- Custo WhatsApp aparece como `R$ 0,33` por envio bem-sucedido.
- E-mail aparece com custo zero.
- Cobrancas recuperadas seguem a regra `paidAt > dueDate` com tentativa anterior ao pagamento.
- Testes relevantes de backend, frontend e API client passam.
