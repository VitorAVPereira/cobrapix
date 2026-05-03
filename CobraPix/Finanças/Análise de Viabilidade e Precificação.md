# Análise de Viabilidade e Precificação - CobraPix

Atualizado em: 29/04/2026

## Resumo executivo

O CobraPix é viável, mas não deve competir como "mais um gerador de Pix com lembrete no WhatsApp". Nesse mercado simples, os preços ficam entre R$49 e R$150 por mês e a escala precisa ser muito alta. A tese mais forte é posicionar o CobraPix como recuperação automática de recebíveis para PMEs com volume recorrente, usando mensalidade SaaS + taxa de sucesso sobre valor recuperado + repasse transparente dos custos financeiros.

A precificação atual de referência, com Starter R$197 + 3%, Growth R$397 + 2% e Enterprise R$597 + 1,5%, está no caminho certo, mas precisa de três ajustes:

1. A porcentagem não deve ser apresentada como "taxa Pix" nem incidir sobre todo pagamento comum. Deve ser "taxa de sucesso" sobre títulos recuperados ou pagos depois da atuação do CobraPix.
2. O plano de maior volume está barato demais para a promessa de produto. R$597 para até 2.000 devedores pode comprimir suporte, onboarding e evolução técnica.
3. Custos de Efí, boleto, Bolix e Meta/WhatsApp precisam ser repassados ou pagos diretamente pelo cliente. Se forem absorvidos, a margem fica frágil e confusa.

## Benchmark de mercado usado

### Infra financeira

- Efí: boleto/Bolix pago custa R$3,45; Pix API e Pix Cobrança custam 1,19%; Pix Automático custa R$3,50 por Pix liquidado. Sem pacote mensal obrigatório.
- Asaas: sem mensalidade; Pix e boleto aparecem como R$1,99 por transação recebida, com promocional de R$0,99 por 3 meses; notificação por WhatsApp custa R$0,55.
- Pagou.ai: Pix D+0 em 1,5%; boleto em R$2,99 + 0,5%.

Leitura: o cliente brasileiro já enxerga Pix e boleto como custo baixo ou transparente. Cobrar 2% a 3% como se fosse custo de pagamento cria atrito, principalmente em faturas de valor alto.

### Automação de cobrança simples

- PagFácilMEI: oferta de fundador a R$49/mês.
- CobraRápido: Basic R$89,90/mês com até 300 cobranças; Pro R$149,90/mês com até 1.500 cobranças.

Leitura: o mercado simples de "lembrete + Pix + painel" é barato. Se o CobraPix for vendido nesse enquadramento, R$197 a R$397 já parece caro.

### Cobrança/recuperação mais robusta

- Receiv: posicionamento mais enterprise, com gestão de mais de 2.500 títulos ativos, multicanalidade, réguas, funil, dashboards, relatórios, IA e módulos de negativação/protesto/meios de pagamento.
- Benchmark interno já considera SaaS + sucesso como referência, com mensalidade em faixa de R$200 a R$1.000+ e taxa sobre recuperação em 5% a 15%.

Leitura: para cobrar mais, o CobraPix precisa vender recuperação de caixa, automação confiável, régua inteligente, conciliação e prova de ROI no dashboard.

### WhatsApp oficial

Desde 01/07/2025, a Meta cobra por template entregue, não por conversa. Para Brasil, referências de abril/2026 indicam cerca de US$0,0068 por mensagem utility e US$0,0625 por mensagem marketing. Com dólar perto de R$5, uma mensagem utility fica por volta de R$0,03 a R$0,04; uma marketing fica perto de R$0,31.

Leitura: o custo local anotado de R$0,34 por disparo parece mais compatível com mensagem marketing ou com uma camada de BSP, não com utility pura. Cobrança transacional deve tentar ficar como utility, com template bem classificado e opt-in/lastro transacional.

## Viabilidade econômica

### Premissas internas

- Custo fixo atual: R$420/mês.
- Imposto estimado: 6%.
- Pró-labore estimado: 28%.
- Caixa líquido aproximado antes de variáveis: 66% da receita.
- Efí e Meta devem ser repassados ou pagos diretamente pelo cliente.

### Break-even por mensalidade pura

| Plano | Mensalidade | Caixa líquido estimado (66%) | Clientes para pagar R$420 fixos |
|---|---:|---:|---:|
| Starter | R$197 | R$130 | 4 |
| Growth | R$397 | R$262 | 2 |
| Scale | R$797 | R$526 | 1 |

Sem considerar CAC, suporte e inadimplência do próprio cliente SaaS, poucos clientes já pagam a operação atual. O problema não é o custo fixo de hoje; o risco está em suporte manual, onboarding pesado, chargebacks operacionais, banimento/qualidade do WhatsApp e vender para clientes pequenos demais.

### Exemplo de cliente saudável

Cliente com 1.000 devedores ativos, ticket médio de R$150 e 10% de recuperação mensal:

- Valor recuperado: R$15.000/mês.
- Plano Growth: R$397/mês.
- Taxa de sucesso recomendada: 2,2%.
- Receita de sucesso: R$330.
- Receita total CobraPix: R$727/mês.
- Caixa líquido aproximado antes de suporte extra: R$480/mês.

Esse perfil paga bem o produto. A venda deve procurar clientes com pelo menos R$10.000/mês de recuperável, não apenas MEIs com poucos recebíveis.

## Precificação recomendada

### Estrutura pública

| Plano | Mensalidade | Limite sugerido | Taxa de sucesso sobre recuperado | Setup |
|---|---:|---:|---:|---:|
| Starter | R$197/mês | até 500 devedores ativos ou 500 cobranças/mês | 2,9% | R$497 |
| Growth | R$397/mês | até 1.500 devedores ativos ou 2.000 cobranças/mês | 2,2% | R$797 |
| Scale | R$797/mês | até 5.000 devedores ativos ou 7.500 cobranças/mês | 1,5% | R$1.497 |
| Enterprise | a partir de R$1.497/mês | volume, unidades e integrações sob contrato | 0,8% a 1,2% ou mínimo mensal | sob proposta |

### Regras de cobrança variáveis

- Pix Efí: repasse do custo vigente, hoje 1,19%, ou pagamento direto pelo cliente.
- Boleto/Bolix: cobrar R$4,90 por título pago ou repassar R$3,45 + taxa de plataforma.
- WhatsApp Meta: cliente paga direto no próprio Gerenciador de Negócios ou CobraPix repassa custo com margem operacional explícita.
- Taxa de sucesso: incidir apenas sobre faturas vencidas recuperadas ou faturas pagas depois de evento da régua CobraPix.
- Cobrança em dia/recorrente sem atraso: não cobrar taxa de sucesso; cobrar apenas mensalidade e custos de pagamento.
- Mínimo por título recuperado: R$1,90 Starter, R$1,50 Growth, R$1,20 Scale.
- Contrato Enterprise: usar mínimo mensal quando o percentual negociado for baixo.

### Como apresentar para o cliente

Evitar:

> "R$397 + 2% por transação Pix"

Usar:

> "R$397/mês + 2,2% apenas sobre o dinheiro recuperado automaticamente pelo CobraPix. Custos de Pix, boleto e WhatsApp são repassados de forma transparente."

Essa linguagem separa valor criado de custo financeiro. O cliente entende que paga quando o sistema recupera caixa.

## Recomendação de posicionamento

### ICP prioritário

1. Escolas, cursos e faculdades menores.
2. Academias, clínicas, odontologia e estética com planos recorrentes.
3. Provedores, assistências, serviços de manutenção e assinaturas locais.
4. Distribuidoras e B2B com carteira grande de boletos vencidos.
5. Lojas com crediário próprio.

### ICP a evitar no início

- MEI muito pequeno que compara tudo com R$49/mês.
- Cliente sem base organizada de devedores.
- Cliente que quer disparo frio ou cobrança agressiva.
- Operação que exige jurídico/negativação/protesto antes do MVP estar robusto.

## Riscos principais

1. Produto ainda não está comercialmente fechado: falta amarrar geração de pagamento, envio com link/PIX/boleto, dashboard real e monetização SaaS.
2. Promessa de WhatsApp oficial conflita com uso atual via Evolution/Baileys. Para vender "menor risco de banimento", precisa migrar para Meta Cloud API ou vender o piloto como WhatsApp conectado por QR, sem prometer canal oficial.
3. Se custos de pagamento e WhatsApp entrarem na receita bruta sem estrutura contábil correta, imposto pode comer margem sobre repasse.
4. Taxa de sucesso precisa ter regra auditável no produto: qual pagamento foi "recuperado pelo CobraPix"?
5. Suporte e onboarding podem virar gargalo. A taxa de setup é importante para não financiar implantação com caixa futuro.

## Veredito

O CobraPix tem viabilidade boa se for vendido como recuperação automatizada de recebíveis para PMEs com volume recorrente. A precificação recomendada deve manter mensalidade acima do mercado simples, mas justificar isso com ROI, dashboard de recuperado e taxa de sucesso sobre caixa efetivamente recuperado.

A decisão crítica é não brigar pelo cliente de R$49. O melhor caminho é capturar clientes que perdem alguns milhares por mês em inadimplência e aceitam pagar R$400 a R$1.500/mês quando o produto prova retorno.
