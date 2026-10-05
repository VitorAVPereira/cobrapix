# Plano: paginação e filtros no Inbox WhatsApp e nos Templates

## Contexto

Duas demandas do responsável pelo produto, ambas nas telas da empresa e do admin:

1. **Inbox WhatsApp:** paginação e filtro por cliente.
2. **Templates de WhatsApp:** paginação e filtro.

A exploração mostrou que todas as listas já têm paginação, mas em formatos diferentes:

| Tela | Hoje | Componente |
| --- | --- | --- |
| Inbox da empresa | Cursor assinado, botão "Carregar mais conversas" (25), filtro só de canal | `front-cobranca/src/components/features/communications/CompanyConversations.tsx` |
| Inbox do admin (Atendimento central) | Offset, "Anterior / Página N / Próxima" sem total de páginas (25), filtros de canal, status e "sem classificação". O backend já aceita `companyId`, mas a tela não oferece | `AdminInbox` em `front-cobranca/src/components/features/CommunicationsHistory.tsx:139` |
| Templates da empresa | Cursor, "Carregar mais templates" (25), sem filtro | `front-cobranca/src/components/features/templates/CompanyWhatsappTemplates.tsx` |
| Templates do admin | Cursor, "Carregar mais templates" (25), filtros Situação e Formato | `front-cobranca/src/components/features/templates/WhatsappCatalog.tsx` |

O que falta é um formato único de paginação, com total e páginas numeradas, e os filtros de busca.

**Decisões confirmadas com o responsável (05/10/2026):**

- **Filtro por cliente no inbox:**
  - Na tela da empresa, a busca é por devedor (nome, telefone, CPF/CNPJ ou e-mail), só entre os devedores da própria empresa.
  - No admin, há um seletor de empresa e a mesma busca por devedor ou telefone em todas as empresas.
- **Paginação nas 4 telas:** "Anterior / Página X de Y · N itens / Próxima", com **10 por página**.
- **Templates:** só **busca por nome** nas duas telas. Os filtros Situação e Formato do admin continuam como estão.

**Critério de pronto:**
- As 4 telas mostram 10 itens por página, com página atual, total de páginas e total de itens.
- O inbox filtra por devedor (e por empresa, no admin).
- As telas de templates filtram por nome.
- Nenhuma busca, filtro ou cursor revela dados de outra empresa.
- Testes A/B em PostgreSQL descartável cobrem esse isolamento.

## Abordagem geral

- **Manter o mecanismo de paginação de cada endpoint e só acrescentar `total` e `search`.**
  - O cursor assinado do inbox da empresa foi uma decisão de segurança: ele fica vinculado a usuário, empresa e filtros (plano 2026-09-23, linha 139).
  - Os templates também usam cursor, e o seletor da régua (`getAllTemplates`) depende dele.
  - O inbox do admin já é offset e já devolve `total`.
  - Tudo é aditivo: sem migration, sem quebra de contrato, e os valores padrão de `limit`/`pageSize` no backend não mudam. O frontend passa a pedir 10.
- **Páginas numeradas sobre cursor:** o frontend guarda uma pilha com os cursores das páginas já visitadas.
  ```ts
  const [cursors, setCursors] = useState<string[]>([]); // cursores das páginas 2..n
  const cursor = cursors.at(-1);
  const page = cursors.length + 1;
  // Próxima: setCursors(c => [...c, nextCursor]); Anterior: setCursors(c => c.slice(0, -1));
  // Mudou busca/filtro: setCursors([])
  ```
  - Total de páginas: `Math.max(1, Math.ceil(total / 10))`.
  - "Próxima" fica habilitada quando houver `nextCursor` (cursor) ou quando `page * 10 < total` (offset).
- **Componente novo e compartilhado:** `front-cobranca/src/components/ui/ListPagination.tsx`. Hoje não existe paginação compartilhada, e são 4 telas consumidoras.
  - Props: `page`, `pageSize`, `total`, `hasNext`, `onPrevious`, `onNext` e o rótulo no singular e no plural (ex.: conversa/conversas).
  - Mostra "Anterior · Página X de Y · N conversas · Próxima" e desabilita os botões nos limites.
- **Campo de busca:** um formulário com `<input type="search">` e botão "Buscar". A busca é aplicada só ao enviar, então não precisa de debounce e evita consultas a cada tecla, o que importa porque o inbox faz polling.
  - O texto digitado e o termo aplicado ficam em estados separados.
  - Busca vazia limpa o filtro.
  - Aplicar busca ou filtro volta para a página 1.
- **Validação do `search` nos DTOs:** `@IsOptional() @Transform(trim) @IsString() @MaxLength(100)`. Depois do trim, string vazia conta como "sem busca".
- **Ordem de execução:** salvar este plano em `docs/superpowers/plans/2026-10-05-paginacao-filtros-inbox-templates.md` (commit `docs:`). Em seguida, Demanda 1 e depois Demanda 2, cada uma com o backend antes do frontend e um commit por etapa.

---

## Demanda 1: Inbox WhatsApp

### Etapa 1.1: Backend, busca de conversas (empresa e admin)

**Novo** `api-cobranca/src/communications/conversation-search.ts`:
- Normaliza o termo uma única vez, para uso nas duas visões.
- Usa os mesmos critérios da busca de devedores que já existe em `invoices.service.ts:670-679`: nome e e-mail sem diferenciar maiúsculas; documento com `normalizeDebtorDocument` de `common/debtor-document`; telefone só com dígitos.
- Escapa `%`, `_` e `\` antes de montar o `LIKE`.
- Calcula o hash exato do telefone para achar conversas sem devedor, por exemplo entradas ainda sem classificação.
  - Reusa `normalizeWhatsAppNumberForTransport` (`common/whatsapp-number.ts:54`) e `messageRecipient({ type: 'PHONE', value }).hash` (`communications/message-context.ts:27`).
  - O hash é `null` quando o termo não é um telefone válido (try/catch).

**Inbox da empresa:** `communications-tenant.service.ts:47` (`listConversations`) e `dto/conversation-query.dto.ts:21`.
- Acrescentar `search` ao `CompanyConversationsQueryDto` e ao `ConversationPageQuery`.
- Extrair o `WHERE` atual para um fragmento `Prisma.sql` usado tanto na página quanto na contagem. Com busca, ele recebe:
  ```sql
  AND ( EXISTS (SELECT 1 FROM "CommunicationMessage" sm
                JOIN "Debtor" d ON d."id" = sm."debtorId" AND d."companyId" = sm."companyId"
                WHERE sm."conversationId" = m."conversationId"
                  AND sm."companyId" = ${companyId} AND sm."retentionExpiresAt" > now()
                  AND (d."name" ILIKE ${like} OR d."email" ILIKE ${like}
                       [OR d."document" LIKE ${doc}] [OR d."phoneNumber" LIKE ${phone}]))
        [OR c."recipientHash" = ${hash}] )
  ```
  - O devedor fica sempre preso ao `companyId` da sessão. O `recipientHash` só alcança conversas que já estão na projeção da empresa, por causa do `WHERE` externo.
- O escopo do cursor passa a incluir a busca: `filters: { channel, search: term ?? null }`. Um cursor emitido para uma busca é recusado com 400 em outra.
- Contar o total com `SELECT count(DISTINCT m."conversationId")::int` usando o mesmo fragmento, em `Promise.all` com a consulta da página.
- A resposta ganha `total`: `{ items, nextCursor, total }`.

**Inbox do admin:** `communications.service.ts:116` (`listAdminConversations`) e `AdminConversationsQueryDto`.
- Acrescentar `search` ao DTO.
- Trocar o `AND` montado por spread por um array `and: Prisma.CommunicationConversationWhereInput[]`. Com busca, ele recebe:
  ```ts
  { OR: [
      { messages: { some: { ...(companyId ? { companyId } : {}), debtor: { OR: [nome, e-mail, documento, telefone] } } } },
      ...(hash ? [{ recipientHash: hash }] : []),
  ] }
  ```
  - Com uma empresa selecionada, o devedor precisa ser dessa empresa (mesmo `some`). Assim, um homônimo de outra empresa não traz a conversa.
- `total`, `page` e `pageSize` já existem.

### Etapa 1.2: Frontend, componente de paginação e inbox da empresa

- Criar `ListPagination.tsx` (descrito acima).
- `api-client.ts:1813` (`listCompanyConversations`): acrescentar `search?` aos parâmetros e mudar o retorno para `CursorPage<CompanyConversation> & { total: number }`.
- `CompanyConversations.tsx`:
  - Usar duas constantes: `LIST_PAGE_SIZE = 10` para a lista e `MESSAGE_PAGE_SIZE = 25` para as mensagens, que não mudam.
  - Trocar o acúmulo de páginas (`pagedList`, `loadMoreConversations`, botão "Carregar mais conversas") pela pilha de cursores. O polling passa a atualizar a **página atual** com o cursor dela.
  - Acrescentar o formulário de busca com placeholder "Buscar por nome, telefone, CPF/CNPJ ou e-mail do cliente". Ao aplicar busca ou trocar o canal, voltar para a página 1 e fechar a conversa aberta, como já acontece hoje ao trocar o canal.
  - Estados vazios separados:
    - Sem busca: "Nenhuma conversa com mensagens da sua empresa."
    - Com busca: "Nenhuma conversa encontrada para esta busca."
    - Erro continua aparecendo como alerta.

### Etapa 1.3: Frontend, inbox do admin

- `api-client.ts:1833` (`listAdminConversations`): acrescentar `search?`. O `companyId` já está tipado.
- `AdminInbox` em `CommunicationsHistory.tsx`:
  - Criar `INBOX_PAGE_SIZE = 10`. A constante `PAGE_SIZE = 25` da linha 29 é compartilhada com o histórico de envios, que fica como está.
  - Seletor "Empresa": "Todas" mais a lista de `api.getAdminClients()` (`api-client.ts:2192`, padrão de `admin/payment-fees/page.tsx:116-133`), carregada uma vez e ordenada por `corporateName`. Se a lista de empresas falhar, mostrar um alerta e manter o inbox funcionando.
  - Campo de busca "Buscar por cliente ou telefone".
  - Qualquer filtro volta para a página 1.
  - Trocar os botões das linhas 348-364 por `ListPagination` (`hasNext = page * 10 < total`).
  - Mostrar "Nenhuma conversa encontrada para estes filtros." quando houver filtro ativo.

---

## Demanda 2: Templates de WhatsApp

### Etapa 2.1: Backend, busca por nome e total

Arquivos: `api-cobranca/src/templates/dto/template-mapping.dto.ts:34` e `template-catalog-query.service.ts`.

- `CatalogPageQueryDto` ganha `search`. O `AdminCatalogQueryDto` herda.
- `CatalogPage<T>` (linha 21, usado só nesse arquivo) ganha `total: number`.
- **`adminCatalog`** (linha 86):
  - Filtrar por `{ OR: [{ metaTemplateName: { contains, mode: 'insensitive' } }, { name: { contains, mode: 'insensitive' } }] }`.
  - Esse filtro precisa entrar dentro de `AND: [...]`. **Cuidado:** o filtro `UNAVAILABLE` já usa a chave `OR`, e um spread de outro `OR` sobrescreveria a situação.
  - Total com `globalMessageTemplate.count({ where })` em `Promise.all`.
- **`companyCatalog`** (linha 251):
  - Filtrar antes, no próprio `findMany` das liberações, com `template: { metaTemplateName: { contains, mode: 'insensitive' } }`. O nome mostrado à empresa é o `metaTemplateName` (`template-policy.service.ts:117`). Assim a política só roda para os candidatos.
  - Ordenar por `[{ template: { metaTemplateName: 'asc' } }, { templateId: 'asc' }]` em vez do UUID, para que as páginas numeradas fiquem em ordem alfabética, como no admin.
  - `total = available.length`, contado depois da política, porque só entram os templates utilizáveis agora.
  - Quem já chama a função sem busca (`communications.service.ts:431` com `{ limit: 100 }` e a régua via `getAllTemplates`) continua compatível; só a ordem passa a ser alfabética.

### Etapa 2.2: Frontend, templates da empresa

- `api-client.ts:1996` (`getTemplates`): acrescentar `search?` e mudar o retorno para `CatalogPage<CompanyWhatsappTemplate> & { total: number }`. `getAllTemplates` não muda.
- `CompanyWhatsappTemplates.tsx`:
  - Formulário "Buscar template por nome", 10 por página, pilha de cursores e `ListPagination` no lugar de "Carregar mais templates". A seleção padrão passa a ser o primeiro item da página atual.
  - Reestruturar os retornos antecipados (linhas 106-118) para que a busca continue visível quando não houver resultado.
  - Mensagens:
    - "Nenhum template liberado para sua empresa." só aparece sem busca.
    - Com busca: "Nenhum template encontrado com esse nome."
- `front-cobranca/src/components/features/templates/types.ts:111`: acrescentar `search?` em `AdminCatalogQuery` e criar `CountedCatalogPage<T> = CatalogPage<T> & { total: number }`. O `CatalogPage` também é usado pelas pendências, que não devolvem total.

### Etapa 2.3: Frontend, catálogo do admin

- `api-client.ts:2061` (`getAdminWhatsappTemplates`): acrescentar `search?`.
- `WhatsappCatalog.tsx`:
  - Campo de busca ao lado de Situação e Formato, `limit: 10`, pilha de cursores e `ListPagination` no lugar de "Carregar mais templates" (linhas 261-268).
  - Trocar filtro ou busca volta para a página 1. Quando o `refreshKey` muda depois de salvar um mapeamento, ou depois de sincronizar, recarregar a **página atual**.
  - Manter o contador de requisições (`request`) que descarta respostas antigas.
- `CompanyTemplateGrants` fica fora do escopo e continua como está.

---

## Testes

**Backend** (`cd api-cobranca`):
- `src/communications/communications-access.spec.ts`:
  - Os DTOs da empresa e do admin aceitam `search`, fazem trim e recusam mais de 100 caracteres.
  - O DTO da empresa continua recusando `companyId`.
- `src/communications/communications-tenant.service.spec.ts`: um cursor emitido com `search=ana` é recusado com `search=bia` (400).
- `test/tenant-conversations-postgres.cjs`, rodado por `npm run test:communications:postgres` (Postgres descartável), com a fixture A/B:
  - A buscando nome, telefone ou CPF de um devedor de B recebe lista vazia e `total: 0`.
  - A buscando o próprio devedor recebe só a conversa dele.
  - O `total` bate com a soma das páginas.
  - Um termo `%` não devolve tudo.
  - Admin com `companyId=A` e o nome de um devedor de B não traz a conversa.
  - Admin buscando por telefone acha uma conversa sem classificação pelo hash.
- `test/template-access.e2e-spec.ts`, rodado por `npm run test:e2e:templates`:
  - A empresa buscando o nome de um template liberado só para outra empresa recebe lista vazia.
  - A busca da empresa vem em ordem alfabética e com `total` correto.
  - Admin com `status=UNAVAILABLE` e `search` combinados respeita os dois filtros (protege contra a sobrescrita do `OR`).
- Rodar também `npm test -- --runInBand`, `npx eslint "src/**/*.ts" "test/**/*.ts"` e `npm run build`.

**Frontend** (`cd front-cobranca`, `npx jest --runInBand`):
- `communications/__tests__/CompanyConversations.test.tsx`:
  - A busca envia `search` e volta para a página 1.
  - "Próxima" usa o `nextCursor` e "Anterior" volta ao cursor anterior.
  - O polling atualiza a página atual com o mesmo cursor.
  - O texto "Página 2 de 3 · 25 conversas" aparece.
  - Busca sem resultado mostra a mensagem própria.
  - Ajustar o teste atual "loads more conversations with the server cursor only" (linha 130).
- `__tests__/CommunicationsHistory.test.tsx`: o seletor de empresa e a busca do admin enviam `companyId`/`search` com `pageSize: 10`, e a paginação mostra o total de páginas.
- `templates/__tests__/CompanyWhatsappTemplates.test.tsx` e `WhatsappCatalog.test.tsx` (linhas 105-136):
  - Busca, paginação e volta à página 1 ao trocar o filtro.
  - Estado vazio com busca mantém o campo visível.
  - O `refreshKey` recarrega a página atual.
- `lib/__tests__/api-client-templates.test.ts`: `search` aparece na query e é omitido quando vazio.
- `app/(dashboard)/configuracoes/templates/__tests__/page.test.tsx:48`: ajustar `{ limit: 25 }` para `{ limit: 10 }`.
- Rodar também `npm run lint` e `npm run build`.

**Verificação manual:**
- Subir backend (3001) e frontend (3000) com o seed de desenvolvimento.
- No navegador do app, conferir as 4 telas:
  - Paginação: avançar, voltar, texto do total.
  - Busca: com resultado, sem resultado, limpar.
  - Polling do inbox sem pular de página.
  - Largura de celular.

## Publicação (só quando pedido)

- Nada de migration. As respostas só ganham campos novos.
- **Backend antes do frontend:** com `forbidNonWhitelisted`, o backend antigo recusaria `search` com 400. Um frontend antigo com backend novo continua funcionando, porque ignora `total`.

## Riscos e gaps observados (não alterar sem pedido)

```text
Gap encontrado: termos de busca (nome, telefone, CPF) vão na query string do GET e podem aparecer no access log do Nginx.
Impacto: dado pessoal em log (AGENTS 4.5). A busca de devedores (/invoices/debtors?search=) já faz o mesmo.
Proposta: seguir o precedente agora; avaliar log_format do Nginx sem query string em /communications e /invoices.
Situação: não alterarei; envolve infraestrutura.
```

```text
Gap encontrado: companyCatalog trata cursor desconhecido como início da lista (template-catalog-query.service.ts:270-272).
Impacto: se um template for revogado entre dois cliques, a "página 2" mostra os primeiros itens.
Proposta: responder 400 a cursor desconhecido e o frontend voltar à página 1.
Situação: não alterarei; muda o contrato.
```

- O inbox do admin ordena por `updatedAt` com offset. Com polling, conversas mudam de página entre cliques. É o comportamento de hoje e fica como está.
- O filtro `supported` do admin olha só `supportReason`, mas a tela calcula `supported` também pelo parser (`template-catalog-query.service.ts:103-107` contra `:389`). É anterior a esta demanda e fica registrado.
- Na lista do inbox do admin, cada conversa mostra só o telefone. A busca por nome devolve conversas identificadas pelo telefone. Sugestão futura: mostrar devedor e empresa na linha.
- Desempenho: o polling de 15 s do inbox da empresa passa a fazer também um `COUNT`. A busca usa `EXISTS` com `ILIKE` sobre os devedores da empresa (índice `companyId`). Aceitável sem índice novo; vale observar em produção.

## Fora do escopo

- Listas de modelos de e-mail.
- "Disponibilidade por empresa" (`CompanyTemplateGrants`).
- Seletores de template da régua.
- Histórico de envios.
- Filtros de template além da busca por nome.
