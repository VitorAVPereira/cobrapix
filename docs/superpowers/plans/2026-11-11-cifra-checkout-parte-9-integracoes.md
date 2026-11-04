# Cifra+ Checkout, Parte 9: integrações (plano)

> **Para execução por agente:** executar por tarefa, com o teste antes da implementação e commits
> por passo lógico (só com pedido do responsável). Testes de banco só em infraestrutura
> descartável; a Efí e o Resend são sempre simulados.

**Objetivo:** o vendedor liga o checkout aos seus sistemas de duas formas:
- **várias regras de webhook**, cada uma com URL, eventos, produtos, segredo e histórico próprios;
- **uma API só de consulta**, com chaves próprias, para buscar pedidos e produtos quando o sistema
  dele perdeu um aviso.

**Especificação:** [Cifra+ Checkout](../specs/2026-10-30-cifra-checkout-design.md), CK-37 e CK-38.
O CK-39 (pixels) pode esperar e fica fora.

**Base:** branch novo a partir do `main`, que já tem a Parte 8 (PR #69).

## Decisões do responsável pelo produto (11/11/2026)

- **Produto da regra:** a regra de um produto dispara quando ele está no pedido, como principal ou
  como order bump. O aviso continua sendo o pedido inteiro, com cada item marcado.
- **Dados da API:** os pedidos trazem o comprador completo (nome, e-mail, CPF e celular), como o
  webhook.
- **Limites:**
  - até 10 regras de webhook por vendedor;
  - até 5 chaves ativas (da spec);
  - 60 requisições por minuto por chave.

## Decisões técnicas (revisar se discordar)

1. **Regra de webhook (`CheckoutWebhookRule`):**
   - **campos:** nome, URL, eventos (vazio = todos), produtos (vazio = todos), segredo cifrado,
     `failingSince`, `disabledAt`, `version`;
   - **exclusão:** marca `deletedAt`, para o histórico continuar com o nome da regra; os avisos na
     fila dessa regra são pulados;
   - **escritas:** com versão esperada (`409 VERSION_CHANGED`).
2. **Um evento, uma entrega por regra:**
   - o `id` do evento é o mesmo em todas as regras e em todas as repetições, para o sistema do
     vendedor descartar duplicados;
   - a entrega passa a ser única por (evento, regra).
3. **Regras que recebem:**
   - o tipo do evento está na lista da regra (ou a lista está vazia);
   - um produto da regra está nos itens do pedido (ou, no `lead.abandoned`, é o produto do lead);
   - uma regra com produtos não recebe evento sem produto;
   - o teste vai só para a regra testada.
4. **Desligamento:**
   - 3 dias seguidos sem sucesso desligam só a regra que falha, com e-mail ao vendedor citando o
     nome da regra;
   - "Religar" é por regra.
5. **Migração da URL única:**
   - a migration cria a primeira regra ("Webhook principal") com a URL, o segredo e o estado de
     falha atuais, e liga o histórico existente a ela;
   - o vendedor não reconfigura nada, e o segredo continua o mesmo;
   - as colunas antigas de `CheckoutSettings` ficam no banco, sem uso;
   - um aviso criado pela API antiga entre a migration e a troca do container (sem regra) é
     entregue pela regra mais antiga da empresa.
6. **Chave da API (`CheckoutApiKey`):**
   - `ckapi_` + 32 bytes aleatórios;
   - guardada só como SHA-256, com um prefixo curto para o vendedor reconhecer;
   - mostrada uma vez;
   - revogada por `revokedAt` (não volta);
   - `lastUsedAt` gravado no máximo uma vez por minuto;
   - criação e revogação na auditoria, sem a chave.
7. **API de consulta (`/checkout/api/v1`, `Authorization: Bearer <chave>`):**
   - `GET orders` (filtros: status, produto, período de atualização; até 100 por página);
   - `GET orders/:id`;
   - `GET products`;
   - `GET products/:id`;
   - **corpo do pedido:** o mesmo dos avisos de webhook, mais `createdAt` e `updatedAt`;
   - **acesso:** pedido ou produto de outra empresa responde 404; chave ausente, inválida ou
     revogada responde 401 (`CHECKOUT_API_KEY_INVALID`); só empresa de checkout.
8. **Limites:**
   - 60 por minuto por chave (contados pelo hash do cabeçalho, sem gravar a chave no Redis);
   - 120 por minuto por IP antes de conferir a chave.
9. **Telas:** em Configurações do checkout:
   - **"Webhooks":** lista de regras, com nova regra, editar, teste, novo segredo, religar, excluir
     e histórico por regra;
   - **"API":** chaves, com criar, revogar e um resumo de uso.

## Modelo de dados (migration aditiva)

- **`CheckoutWebhookRule`:** id, `companyId`, nome, URL, `events String[]`, `productIds String[]`,
  `secretEncrypted`, `failingSince`, `disabledAt`, `deletedAt`, `version`, datas.
- **`CheckoutWebhookDelivery.ruleId`:** opcional, com a unicidade `eventId` trocada por
  (`eventId`, `ruleId`).
- **`CheckoutApiKey`:** id, `companyId`, nome, prefixo, `keyHash` único, `createdByUserId`,
  `lastUsedAt`, `revokedAt`, `createdAt`.
- **Dados:** cópia da URL única para a primeira regra e ligação do histórico.

## Tarefas

1. **Migration e schema:**
   - criar os modelos novos e os dados da primeira regra;
   - testar do zero em banco descartável, sem diferença no `migrate diff`.
2. **Regras no `CheckoutWebhooksService`:**
   - `emit` por regra;
   - `attempt`, falha e desligamento por regra;
   - CRUD, teste, segredo, religar, histórico e reenvio;
   - testes unitários.
3. **Chaves e API:**
   - `CheckoutApiKeysService` e `CheckoutApiKeyGuard`;
   - `CheckoutApiController`;
   - o corpo do pedido compartilhado com o webhook;
   - limites no `ThrottleGuard`;
   - testes unitários.
4. **Fluxo descartável:**
   - regras por produto e evento, inclusive o bump;
   - desligar uma regra só;
   - chave criada, usada, limitada e revogada;
   - isolamento A/B na API.
5. **Telas:**
   - `WebhookRulesPanel` e `ApiKeysPanel`;
   - tipos e chamadas no `api-client`;
   - testes.
6. **Docs:** AGENTS.md, situação na spec, runbook e registro de execução.

## Fora desta parte

- **CK-39:** pixels.
- **API de escrita:** criar ou alterar pedidos, produtos ou reembolsos.
- **Corpo no histórico:** ver o corpo dos avisos (CK-23).

## Registro de execução (11/11/2026, branch `feat/cifra-checkout-parte-9`)

- **Migration** `20261111120000_checkout_integrations`:
  - aplicada do zero no fluxo descartável (62 migrations) e no banco local, sem diferença no
    `migrate diff`;
  - a cópia da URL única foi conferida no banco local com uma URL, um segredo e um aviso de teste:
    a regra "Webhook principal" herdou URL, segredo e falha, e o aviso foi ligado a ela.
- **Backend:**
  - `npm test -- --runInBand` (160 suítes, 1.379 testes);
  - `npm run build`;
  - eslint do checkout e do `ThrottleGuard` sem erros.
- **Fluxo descartável:**
  - `test:e2e:checkout-pix`: 35 testes, 3 novos (regras por evento e produto com o bump,
    desligamento de uma regra só, API com isolamento A/B, limite e revogação);
  - `test:e2e:checkout`: 6 testes.
- **Frontend:**
  - `npx jest --runInBand` (84 suítes, 514 testes);
  - `npm run lint` (só o aviso conhecido do `useReactTable`);
  - `npm run build`.
- **API local:** conferida no servidor local com o banco descartável (regra, versão antiga,
  URL recusada, chave, consulta, 401 sem chave e com login, revogação).
- **Telas:** não conferidas no navegador (o painel estava oculto); cobertas pelos testes de
  componente.

**Desvios do plano:** nenhum. Uma empresa com histórico de avisos e com o webhook já desligado
(sem URL) não ganha regra na migration, então esse histórico antigo não aparece na tela.
