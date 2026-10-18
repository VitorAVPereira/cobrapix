# Tela de Cobranças: design, volume, nova cobrança e importação com revisão

**Data:** 18/10/2026. **Branch:** `feat/cobrancas-visual`.

**Público:** usuário da empresa (`COMPANY_ADMIN`), em `/cobrancas`.

## Pedido

1. Melhorar o design da tela.
2. Pensar em mais de 1.000 cobranças por mês, sem limite, mantendo a navegação fácil.
3. **Nova cobrança manual:** só com clientes já cadastrados em Clientes. Um botão leva à tela de
   Clientes para cadastrar um cliente novo.
4. **Importação por CSV:** procurar o cliente pelo CPF/CNPJ. Se existir, vincular a ele; se não,
   cadastrar.
5. **Filtro** no estilo da tela de Clientes.

## Decisões confirmadas (18/10/2026)

1. **Cliente existente com dados diferentes:** um modal mostra Cadastro × Planilha, campo a campo
   (nome, WhatsApp, e-mail), e o usuário escolhe qual valor manter.
   - O perfil de cobrança do cliente nunca muda pela importação. Hoje ele volta para o padrão.
2. **Conflitos** usam o mesmo modal:
   - **CPF/CNPJ novo, mas o WhatsApp já é de outro cliente:** informar outro WhatsApp ali mesmo, ou
     não importar as cobranças desse cliente. Vincular ao dono do WhatsApp não é oferecido, porque
     o boleto sairia no documento de outra pessoa.
   - **Dois ou mais clientes com o mesmo CPF/CNPJ:** escolher a qual vincular (e então comparar
     Cadastro × Planilha), ou não importar.
3. **Volume:** o modal tem "Aplicar esta escolha a todos os próximos clientes" e mostra o andamento
   ("Cliente 3 de 120").
4. **Filtros:** busca, Situação e Forma de pagamento.
5. **Lista:** tabela compacta a partir de telas médias, ordenável, com 20, 50 ou 100 por página. Os
   filtros ficam no endereço da página. No celular continuam os cartões.

## Decisões técnicas

- **Situação:**
  - Todas;
  - Em aberto (`PENDING`, inclusive vencidas; é o que o link "Ver cobranças em aberto" de Clientes
    já usa);
  - Vencidas (`PENDING` com vencimento antes de hoje, no horário de São Paulo);
  - Pagas;
  - Canceladas.
- **Forma de pagamento:** Pix, Boleto (`BOLETO` e `BOLIX`) e Cartão, pela forma da fatura.
- **Ordenação:**
  - mais recentes (padrão atual);
  - vencimento (mais próximo ou mais distante);
  - valor (maior ou menor).
- **Busca:** CPF/CNPJ e WhatsApp também são encontrados digitados com pontos, traços ou parênteses.
- **Nova cobrança:**
  - escolha do cliente por busca no servidor (nome, CPF/CNPJ, WhatsApp ou e-mail), que funciona
    com qualquer quantidade de clientes;
  - "Cadastrar novo cliente" abre Clientes com o formulário de cadastro aberto (`/clientes?novo=1`);
  - a fatura é criada por `POST /invoices/debtors/:debtorId/invoices`, que já existe.
- **Importação em duas etapas:**
  1. `POST /invoices/import/preview` valida as linhas e devolve a análise por CPF/CNPJ.
  2. `POST /invoices/import` recebe `{ rows, decisions }`.
  - Na segunda etapa, o servidor refaz a análise dentro da transação. Se algum cadastro mudou
    desde a revisão, responde 409 `IMPORT_CHANGED` e a tela pede para revisar de novo.
  - Uma decisão que falta ou que não confere responde 409 `IMPORT_NEEDS_REVIEW`.
  - Um envio no formato antigo (só o array de linhas) importa se não houver nada para revisar; se
    houver, responde `IMPORT_NEEDS_REVIEW`.
- **Planilha incoerente:** o mesmo CPF/CNPJ com nome, WhatsApp ou e-mail diferentes em linhas
  diferentes, ou o mesmo WhatsApp em documentos diferentes, é erro de validação da linha, como hoje.
- **Autorização de WhatsApp (opt-in) da planilha:** vale quando o WhatsApp que fica no cadastro é o
  da planilha. A planilha só concede, nunca retira.

## Fora do escopo (registrado como gap)

- A tela de Clientes carrega só os 20 primeiros clientes, sem paginação.

## Registro de execução (18/10/2026)

- **Backend:**
  - `GET /invoices` com `status=OVERDUE`, `billingType` e `sort` (desempate por id, para páginas
    estáveis);
  - busca por documento e WhatsApp formatados; números dentro de um nome não viram busca por
    documento;
  - `GET /invoices/debtors/search` (até 8 clientes, sem totais) para o seletor da nova cobrança;
  - importação: `POST /invoices/import/preview` e `POST /invoices/import` com `decisions`, gravação
    em lote (`createManyAndReturn`) numa transação de até 60 s;
  - regras puras em `invoices/invoice-import.ts`.
- **Frontend:**
  - página `/cobrancas` refeita: cabeçalho, cartão de filtros no estilo de Clientes, filtros e
    paginação no endereço, tabela a partir de `lg`, 20, 50 ou 100 por página;
  - estados de erro com "Tentar de novo" e de lista vazia com "Limpar filtros";
  - nova cobrança com `ClientPicker`; Clientes abre o cadastro com `?novo=1`;
  - importação com `ImportReview` e `ImportSummary`.
- **Testes:**
  - backend: 133 suítes e 1.087 testes; e2e `npm run test:e2e:invoice-import` (3 testes em
    PostgreSQL descartável, incluindo 1.200 linhas de uma vez);
  - frontend: 61 suítes e 384 testes; builds ok.
- **Navegador**, com PostgreSQL e Redis descartáveis, 300 clientes e 1.300 cobranças:
  - Vencidas + Boleto (com BOLIX) ordenadas por valor;
  - busca por WhatsApp formatado;
  - 100 por página até a última (1.201–1.300 de 1.300);
  - nova cobrança pelo seletor;
  - `/clientes?novo=1`;
  - importação com os três casos de revisão: dados diferentes, WhatsApp em uso com outro número
    recusado e outro aceito, cliente novo. As escolhas foram conferidas no banco;
  - celular sem rolagem horizontal.
- **Defeitos encontrados na verificação e corrigidos:**
  - a busca "Carla Alves 33" trazia clientes com "33" no CPF ou no WhatsApp;
  - os erros do modal de nova cobrança ficavam escondidos atrás do fundo escuro;
  - o formulário pedia o valor antes de avisar que faltava o cliente.
