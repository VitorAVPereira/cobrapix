# Recorrências: cadastro em Recorrentes e periodicidades (23/10/2026)

## Pedido

A única forma de criar uma cobrança recorrente era marcar "Cobrança recorrente mensal" no
formulário de Cobranças, e toda recorrência era mensal. Pedido: cadastrar recorrências na tela
Recorrentes, tirar a opção de Cobranças (deixando um atalho), perguntar "avulsa ou recorrente" em
Clientes → Nova cobrança e permitir outras periodicidades além de mensal.

## Decisões do responsável pelo produto

- Periodicidades: **Semanal, Quinzenal, Mensal, Bimestral, Trimestral, Semestral e Anual**.
- **Quinzenal = a cada 14 dias** (mesmo dia da semana, de duas em duas semanas).
- A periodicidade **não muda** depois de criada; para trocar, pausa-se a recorrência e cria-se outra.
- Em Clientes, "Recorrente" abre o formulário na própria tela, com o cliente escolhido.
- Corrigir também os gaps encontrados (abaixo).

## Como ficou

- **Recorrentes → Nova recorrência:** cliente, forma de pagamento, valor, periodicidade, primeiro
  vencimento (a partir de hoje), dados do aluno (segmento Educação), multa/juros/prazo e "Enviar
  cobrança agora". A lista mostra "Mensal · dia 10" ou "Semanal · segunda-feira".
- **Cobranças:** sem a checkbox; o link "Adicionar cobrança recorrente" abre Recorrentes com o
  formulário (`/devedores-recorrentes?nova=1&cliente=<id>`). O cliente é buscado pelo id, sem CPF ou
  nome no endereço.
- **Clientes → Nova cobrança:** escolha Avulsa (formulário de sempre) ou Recorrente.
- **Edição:** valor, forma de pagamento e multa/juros como antes; o dia só existe nas periodicidades
  por mês. Um novo dia vale a partir do mês do próximo vencimento ainda não gerado.
- **Resumo "Valor por mês das ativas":** cada recorrência entra pelo valor equivalente a um mês
  (semanal × 52/12, quinzenal × 26/12, bimestral ÷ 2, trimestral ÷ 3, semestral ÷ 6, anual ÷ 12).

## Regras de geração

- Periodicidades por mês guardam o dia (`dueDay`); dia 29–31 cai no último dia dos meses curtos e
  volta ao dia original depois. Semanais somam 7 ou 14 dias.
- Chave do período (`Invoice.recurrencePeriod`, única por recorrência): `AAAA-MM` nas por mês (igual
  às faturas já existentes) e `AAAA-MM-DD` nas semanais.
- Antecedência da geração: 30 dias, nunca mais que um intervalo (semanal 7, quinzenal 14).
- Na criação, a primeira ocorrência é sempre gerada e recebe a emissão.
- Pedidos antigos só com `due_day` continuam criando recorrência mensal (frontend antigo durante a
  publicação).

## Gaps corrigidos

- **Reativar não cobra o período pausado:** a agenda recomeça na primeira ocorrência a partir de
  hoje. Antes, ativar gerava faturas já vencidas de todo o período pausado.
- **Dados do aluno em todas as faturas:** ficam na recorrência e são copiados para cada fatura. A
  migration preenche as recorrências existentes com os dados da fatura mais antiga que os tenha;
  faturas não são alteradas.
- **Um aviso da régua por recorrência por dia:** o intervalo mínimo de 23 h passa a valer para todas
  as faturas da mesma recorrência; a fatura que esperou sai numa rodada seguinte, sem ser pulada.
- **Edição do dia sem fatura extra:** antes, mudar o dia recalculava a partir de hoje e podia gerar
  uma fatura a mais no mês corrente.
- **Emissão na primeira fatura:** a emissão ia para a última fatura gerada.

## Pendências

- Os dados do aluno de uma recorrência não são editáveis em Recorrentes (só na criação).

## Publicação

Migration aditiva (`20261023120000_recurring_invoice_frequency`). Publicar o backend antes do
frontend: o frontend novo envia `frequency` e `first_due_date`, que o backend antigo recusa.
