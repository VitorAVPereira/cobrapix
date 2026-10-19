# Tela de Baixas para grande volume (18/10/2026)

## Pedido

Deixar menores os itens de cada baixa para exibir mais na tela. Como em todas as telas, considerar
operações com mais de 1.000 cobranças por mês, sem limite fixo, com navegação fácil.

## Gaps encontrados

- A API devolvia só as **100 baixas mais recentes**, sem paginação nem filtro: com o volume esperado,
  as anteriores ficavam inacessíveis.
- Cada baixa precisava ser marcada como lida uma a uma.
- A situação misturava leitura e e-mail: ao marcar como lida, "Falhou" virava "Lido" e a falha do
  aviso sumia da tela.
- Textos sem acento e dados técnicos (o identificador interno da fatura, `PIX`/`BOLIX` em caixa alta).

## Decisões do responsável pelo produto

- Marcação em lote: **seleção por linha** e **"Marcar todas como lidas"** para todas as baixas do
  filtro atual, com confirmação mostrando a quantidade.
- A tela abre com **todas as baixas, mais recentes primeiro**; as não lidas ficam destacadas e há o
  filtro "Não lidas".

## Como ficou

- Tabela compacta (uma linha por baixa) a partir de telas grandes e cartões curtos no celular,
  paginação de 20, 50 ou 100 e filtros guardados no endereço:
  - busca por cliente, CPF/CNPJ (com ou sem pontuação), e-mail ou aluno;
  - situação: não lidas, lidas, e-mail não enviado;
  - forma de pagamento: Pix, Boleto (inclui BOLIX) e Cartão;
  - data do pagamento no horário de Brasília: hoje, 7 e 30 dias, este mês, este ano ou datas escolhidas.
- Leitura e aviso por e-mail aparecem separados. O aviso é derivado de `sentAt` e `errorMessage`
  (enviado, não enviado, sem envio), que a leitura não apaga.
- "Marcar todas" vale só para as baixas que existiam quando a lista foi carregada (`asOf`): um
  pagamento que chega durante a confirmação continua como novo.

## API

- `GET /payment-notifications`: aceita `page`, `pageSize` (20, 50 ou 100), `search`, `state`
  (`unread`, `read`, `email_failed`), `billingType`, `period`, `startDate` e `endDate`. Responde também
  `total`, `page`, `pageSize`, `filteredUnread` e `asOf`, e cada item traz `debtorDocument`.
  Sem parâmetros, devolve a primeira página de 20 (antes eram as 100 mais recentes).
- `POST /payment-notifications/read`: `{ ids }` (até 100) ou os filtros com `asOf`; responde `{ count }`.
  Os dois juntos, ou nenhum, respondem 400 `INVALID_READ_TARGET`. Baixas já lidas mantêm a data de leitura.
- `POST /payment-notifications/:id/read` continua existindo para o frontend publicado hoje.

## Publicação

Sem migration nem variável nova. O frontend antigo continua funcionando com o backend novo, mas passa
a ver só as 20 baixas mais recentes. Publique backend e frontend em sequência.
