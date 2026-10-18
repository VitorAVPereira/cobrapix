# Plano: tela de Cobranças

Especificação: `docs/superpowers/specs/2026-10-18-cobrancas-tela-design.md`.

## Tarefa 1: listagem no backend

- [ ] `GET /invoices`: `status=OVERDUE`, `billingType=PIX|BOLETO|CREDIT_CARD` e
  `sort=createdAt_desc|dueDate_asc|dueDate_desc|amount_desc|amount_asc`.
- [ ] Busca com CPF/CNPJ e WhatsApp normalizados.
- [ ] Testes de unidade, incluindo isolamento por empresa. Commit.

## Tarefa 2: importação com revisão no backend

- [ ] Análise por CPF/CNPJ com consultas em lote; validação de planilha incoerente.
- [ ] `POST /invoices/import/preview` e `POST /invoices/import` com `decisions`.
- [ ] O perfil de cobrança não muda; o opt-in segue a regra da spec.
- [ ] 409 `IMPORT_CHANGED` e `IMPORT_NEEDS_REVIEW`.
- [ ] Testes de unidade e e2e em PostgreSQL descartável. Commit.

## Tarefa 3: lista e filtros no frontend

- [ ] Cabeçalho e cartão de filtros no estilo de Clientes.
- [ ] Filtros e paginação no endereço da página.
- [ ] Tabela compacta a partir de `lg`, ordenação e 20, 50 ou 100 por página.
- [ ] Testes. Commit.

## Tarefa 4: nova cobrança

- [ ] Seletor de cliente com busca no servidor; "Cadastrar novo cliente" → `/clientes?novo=1`.
- [ ] Clientes abre o cadastro com `?novo=1`.
- [ ] Testes. Commit.

## Tarefa 5: importação com revisão no frontend

- [ ] Análise, modais de revisão (Cadastro × Planilha, WhatsApp em uso, documento duplicado),
  "Aplicar a todos os próximos" e andamento.
- [ ] Envio com `decisions`; tratar 409; resumo do que foi importado e do que ficou de fora.
- [ ] Testes. Commit.

## Tarefa 6: verificação e fechamento

- [ ] Navegador com dados de exemplo (mais de 1.000 cobranças), celular e desktop.
- [ ] Checks completos; registro na spec. Commit.
