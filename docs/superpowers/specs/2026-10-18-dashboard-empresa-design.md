# Dashboard da empresa: visual, períodos e gráficos

**Data:** 18/10/2026. **Branch:** `feat/dashboard-visual`.

**Público:** usuário da empresa (`COMPANY_ADMIN`), na tela inicial `/`.

## Pedido

Primeira tela da melhoria visual das telas de usuário. Para o Dashboard:

- trocar o ícone;
- tirar o título "Cockpit Analítico";
- melhorar os filtros de período;
- adicionar gráficos e melhorar os dados;
- melhorar o design;
- remover textos técnicos como "Confirmadas por webhook Efí" e "Aceitas pelo WhatsApp (não inclui
  as que estão na fila)".

## Decisões confirmadas (18/10/2026)

1. **Blocos e gráficos:**
   - recebimentos por dia (por mês em períodos longos);
   - carteira em aberto (a vencer × vencidas);
   - vencidas por faixa de atraso;
   - recebido por forma de pagamento.
2. **Formas de pagamento:** Pix, Boleto e Cartão. O BOLIX conta como Boleto.
3. **Período:**
   - atalhos Hoje, 7 dias, 30 dias, Este mês, Este ano e Personalizado (intervalo de datas);
   - todos os blocos seguem o período, inclusive WhatsApp e e-mail;
   - os indicadores mostram a variação contra o período anterior.
4. **Gráficos com Recharts.** É uma dependência nova do frontend.
5. **Fuso:** dias e períodos contados no horário de São Paulo, não no relógio do servidor.

## Decisões técnicas (para validar)

- **Título:** "Visão geral", com o intervalo de datas do período logo abaixo. O ícone do menu passa
  de documento (`FileText`) para painel (`LayoutDashboard`).
- **Recebido:** soma do valor original das faturas pagas no período, igual ao "Total Recuperado"
  de hoje. Juros e multa pagos não entram.
- **Taxa de recebimento:** das faturas com vencimento no período (pendentes ou pagas), quanto do
  valor já foi pago. Substitui a "Taxa de Recuperação" de hoje, que misturava o pago no período
  com todo o saldo em aberto.
- **Em aberto, vencidas e faixas de atraso** são uma foto de agora, e não dependem do período. A
  tela diz isso.
- **Forma do recebimento:** a forma da cobrança paga da fatura. Sem cobrança registrada (faturas
  antigas), vale a forma da fatura.
- **Período anterior:** mesmo número de dias, logo antes. Em "Este mês" e "Este ano", são os mesmos
  dias no mês ou no ano anterior.
- **Agrupamento:** por dia até 62 dias; acima disso, por mês. Intervalo personalizado de no máximo
  366 dias, sem datas futuras.
- **Fuso:** São Paulo está em UTC−3 fixo desde o fim do horário de verão (2019). Os vencimentos
  são datas (gravadas em UTC), então a comparação usa a data.

## API

`GET /billing/dashboard?period=today|7d|30d|month|year|custom&startDate=AAAA-MM-DD&endDate=AAAA-MM-DD`

- **Acesso:** JWT da empresa; o `companyId` vem do token.
- **Erros:** período personalizado incompleto, invertido, com data futura ou maior que 366 dias
  responde 400 com código estável `INVALID_DASHBOARD_PERIOD`.
- **Compatibilidade:** `GET /billing/metrics`, `/whatsapp/stats` e `/email/stats` continuam iguais,
  para o frontend publicado.

Resposta:

```ts
{
  period: {
    key, startDate, endDate, previousStartDate, previousEndDate,
    granularity: 'day' | 'month',
  };
  received: { amount, count, previousAmount, previousCount };
  collectionRate: { dueAmount, paidAmount, rate: number | null, previousRate: number | null };
  open: { amount, count, upcomingAmount, upcomingCount, overdueAmount, overdueCount };
  overdueAging: { range: '1-15' | '16-30' | '31-60' | '60+', amount, count }[];
  receivedSeries: { date: 'AAAA-MM-DD' | 'AAAA-MM', amount, count }[];  // sem buracos
  receivedByMethod: { method: 'PIX' | 'BOLETO' | 'CARD', amount, count }[];
  whatsapp: { sent, delivered, read, failed, replies };
  email: { sent, delivered, opened, clicked };
}
```

## Tela

1. **Cabeçalho:** "Visão geral", o intervalo e os botões de período. "Personalizado" abre dois
   campos de data com "Aplicar".
2. **Quatro indicadores:**
   - Recebido (com variação);
   - Taxa de recebimento (com variação em pontos percentuais);
   - Em aberto;
   - Vencidas.
3. **Gráficos:**
   - recebimentos no tempo, em largura dupla;
   - carteira em aberto, em rosca;
   - vencidas por atraso;
   - recebido por forma;
   - comunicação: WhatsApp e e-mail no período, sem textos técnicos.
4. **Estados:**
   - carregando: esqueleto;
   - erro: aviso com "Tentar de novo";
   - sem dados: mensagem em cada gráfico.

   Um pedido antigo que chega depois de trocar o período é descartado.

## Fora do escopo

- As demais telas de usuário (próximas etapas).
- Remover `GET /billing/metrics`: pode sair depois que o frontend novo estiver publicado.
