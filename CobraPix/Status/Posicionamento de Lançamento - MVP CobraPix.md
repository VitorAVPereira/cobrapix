Data: 30-04-2026

Fontes:

- [[Informações Iniciais/Contexto - Negócio]]
- [[Informações Iniciais/Contexto - Tech]]
- [[Status/Desenvolvimento dia 28-04-2026]]

## Leitura executiva

O CobraPix já tem base suficiente para um **piloto técnico controlado**, mas ainda não deve ser vendido como a plataforma completa descrita na promessa comercial original.

O melhor posicionamento de lançamento é:

> CobraPix é uma plataforma de cobrança automatizada para empresas com alto volume de inadimplência, que organiza devedores, gera cobranças, configura réguas de comunicação e reduz o trabalho manual da equipe usando WhatsApp e meios de pagamento digitais, em implantação assistida.

O produto pode ser vendido agora como **MVP de cobrança assistida e automação progressiva**, não como operação financeira totalmente autônoma "zero touch".

## Tese de lançamento

Para reduzir risco comercial, jurídico e reputacional, o lançamento deve ser feito com linguagem de **piloto, implantação assistida e ganho operacional**, evitando promessas absolutas como:

- recuperação garantida;
- piloto automático completo;
- zero esforço manual;
- canal oficial Meta Cloud API, enquanto o produto usar Evolution API/Baileys;
- split, subconta white-label e cash-out automático como diferenciais já disponíveis em produção;
- dashboard financeiro completo com métricas reais, enquanto houver dados mockados ou parciais.

O CobraPix deve vender o que já é defensável:

- centralização de cobranças;
- cadastro e organização de empresas, devedores, faturas e recorrências;
- configuração de régua de cobrança;
- templates de mensagens;
- geração de meios de pagamento via Efí em fluxo assistido ou semiautomatizado;
- envio de mensagens por WhatsApp conectado;
- implantação acompanhada para validar conversão antes de escalar.

## Matriz promessa vs MVP

| Prometido hoje                                                                        | Já existe                                                                                                                                             | Falta para cumprir                                                                                                                                                                     | Como vender sem gerar risco                                                                                                                                                                         |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recuperar faturas vencidas e a vencer no piloto automático via WhatsApp.              | Backend com empresas, devedores, faturas, cobranças, recorrência, templates, filas e WhatsApp. Régua de cobrança já encaminhada.                      | Fechar ciclo automático completo: selecionar fatura, gerar cobrança Efí, obter link/PIX/boleto, inserir no template, enviar, receber webhook, atualizar status e refletir em métricas. | Vender como "automação assistida de cobrança por WhatsApp", com piloto acompanhado e validação operacional antes de escalar. Evitar "piloto automático" até o ciclo estar comprovado ponta a ponta. |
| Cobrança humanizada, profissional e sem esforço manual da equipe.                     | Templates de mensagem e estrutura para régua. Fluxos de cobrança e recorrência existem no backend e no front.                                         | Falta garantir jornadas completas, estados operacionais claros, reenvio, tratamento de falhas, edição/aprovação de mensagens e redução real de intervenção manual.                     | Vender como "reduz trabalho manual e padroniza a cobrança". Usar "sem esforço manual" apenas para etapas comprovadas em produção.                                                                   |
| Uso de WhatsApp oficial com menor risco de banimento via Meta Cloud API.              | O contexto técnico planeja Meta Cloud API e webhook `/webhooks/meta`. O status atual indica WhatsApp via Evolution API com QR code/status/desconexão. | Migrar ou implementar efetivamente Meta Cloud API, templates oficiais, opt-in, categorias de mensagem e webhooks oficiais.                                                             | Não vender como "canal oficial Meta" enquanto o MVP usar Evolution. Posicionar como "WhatsApp conectado em ambiente controlado" e tratar risco operacional no contrato/piloto.                      |
| PIX, boleto e Bolix como métodos de pagamento aceitos.                                | Integração Efí para PIX CobV, boleto/Bolix, split e webhooks está avançada. Backend tem rotas de criação de pagamentos e batch.                       | Expor ações claras no front, amarrar geração de pagamento à cobrança enviada e validar fluxo em homologação/produção com empresa teste.                                                | Vender como "meios de pagamento digitais integrados via Efí em implantação assistida". Evitar prometer disponibilidade irrestrita até testar cada método por cliente.                               |
| Split de pagamentos atômico, com taxa CobraPix separada automaticamente.              | Serviço Efí tem implementação avançada para split. Schema contempla entidades financeiras.                                                            | Validar split ponta a ponta em ambiente real, conciliar webhooks, registrar taxas por fatura, lidar com erro, estorno, expiração e idempotência.                                       | Vender como "preparado para split Efí" ou "split disponível em piloto validado por cliente". Não usar como pilar central de venda até conciliação estar robusta.                                    |
| Cash-out automático para conta bancária do cliente.                                   | Existem dados bancários e estrutura financeira parcial.                                                                                               | Criar rotina de transferência/saque, agenda, logs, conciliação, falhas, autorização e regras por cliente.                                                                              | Não vender no lançamento. Oferecer "repasse conforme configuração Efí/rotina operacional do piloto" até existir cash-out automático auditável.                                                      |
| Dashboard completo com recuperado no mês, taxa de sucesso e métricas reais.           | Há UI de dashboard, mas o status aponta métricas mockadas na home.                                                                                    | Calcular recuperado, pendente, taxa de recuperação, cobranças ativas e performance por período a partir do banco e dos webhooks.                                                       | Vender como "painel operacional em evolução". Em demo, separar claramente dados demonstrativos de dados reais do piloto.                                                                            |
| Onboarding financeiro sem fricção, com subconta white-label criada em minutos.        | Cadastro manual de conta Efí e estrutura de GatewayAccount.                                                                                           | Automatizar criação de subconta, credenciamento, validação documental, status de aprovação e fallback operacional.                                                                     | Vender como "onboarding assistido". Cobrar setup pelo acompanhamento, não pela promessa de criação instantânea 100% automática.                                                                     |
| Modelo SaaS com mensalidade, taxa de sucesso, setup e planos por volume.              | Schema tem Plan e Subscription. Contexto de negócio define pricing e taxa de sucesso.                                                                 | Implementar cobrança da mensalidade, limites por plano, trial, inadimplência do cliente, medição de sucesso e faturamento da taxa.                                                     | No MVP, vender contrato piloto com setup + mensalidade fixa. Deixar taxa de sucesso como cláusula opcional ou manualmente conciliada.                                                               |
| Hierarquia de exceção por devedor para métodos de pagamento.                          | Contexto técnico indica Company.allowedPaymentMethods e Debtor.overridePaymentMethods. Status aponta configuração global e por devedor.               | Validar aplicação em todos os fluxos de geração de cobrança, upload, recorrência e reemissão.                                                                                          | Pode ser vendido como diferencial operacional, com linguagem simples: "métodos por empresa e exceções por cliente".                                                                                 |
| Upload em massa de devedores/cobranças.                                               | O contexto técnico prevê CSV parser assíncrono. Status indica CRUD/fluxos e backend forte, mas não crava upload como pronto comercialmente.           | Confirmar UI final, validação de linhas, erros por linha, reprocessamento, deduplicação e histórico de importação.                                                                     | Vender como "importação assistida de base". Para piloto, a equipe CobraPix pode validar o CSV antes de subir.                                                                                       |
| Robustez de produção com filas, Redis, workers, rate limiting e isolamento de tenant. | BullMQ/Redis para envio de mensagens já existe. Prisma com isolamento por companyId é citado. Builds e testes passaram.                               | Testes end-to-end, observabilidade, retry, idempotência completa, validação de webhooks, logs de auditoria e bateria real com Redis/Evolution/Efí.                                     | Vender apenas em piloto controlado, com volume limitado, monitoramento próximo e SLA conservador.                                                                                                   |

## Posicionamento recomendado para a primeira oferta

### Nome da oferta

**Piloto CobraPix - Cobrança automatizada assistida**

### Promessa comercial segura

> Em até poucos dias, o CobraPix ajuda sua empresa a organizar cobranças em aberto, padronizar mensagens de cobrança e iniciar uma régua de recuperação via WhatsApp, com meios de pagamento digitais e acompanhamento do time CobraPix durante o piloto.

### Cliente ideal do piloto

- Empresa com base ativa de devedores recorrentes.
- Alto volume de cobranças manuais por WhatsApp, planilha ou sistema interno.
- Dor clara de inadimplência, mas disposição para começar com implantação assistida.
- Aceita operar com volume controlado no primeiro ciclo.
- Tem alguém responsável por aprovar mensagens, validar pagamentos e acompanhar resultados.

### O que incluir no piloto

- Setup e parametrização da empresa.
- Cadastro/importação inicial de devedores e cobranças.
- Configuração de métodos de pagamento aceitos.
- Configuração de templates e régua inicial.
- Envio controlado de cobranças por WhatsApp.
- Geração de cobranças via Efí quando aplicável.
- Acompanhamento semanal dos resultados.
- Relatório manual ou semiautomatizado de recuperado, pendente e próximos ajustes.

### O que não prometer ainda

- Recuperação garantida de valores.
- Operação 100% autônoma.
- Meta Cloud API oficial, se o cliente estiver usando Evolution API.
- Cash-out automático.
- Split financeiro plenamente produtizado para todos os clientes.
- Dashboard 100% real-time e auditável.
- Onboarding financeiro instantâneo white-label.
- Taxa de sucesso calculada e cobrada automaticamente sem revisão.

## Narrativa comercial

### Frase curta

> CobraPix automatiza a rotina de cobrança por WhatsApp para empresas que perdem dinheiro com inadimplência e processos manuais.

### Frase honesta para MVP

> No piloto, conectamos sua base de cobranças, configuramos uma régua de mensagens e rodamos a operação com acompanhamento próximo, para medir quanto dinheiro volta para o caixa antes de escalar.

### Valor principal

O valor inicial não deve ser "tecnologia financeira autônoma completa". O valor inicial deve ser:

- tirar cobranças da planilha;
- reduzir esquecimento e retrabalho;
- padronizar abordagem;
- dar cadência à régua de cobrança;
- testar conversão por mensagem e método de pagamento;
- gerar aprendizado com dados reais.

## Riscos de comunicação

| Tema sensível | Risco se prometer demais | Formulação segura |
|---|---|---|
| WhatsApp oficial | Cliente contratar esperando Meta Cloud API e descobrir Evolution/QR. | "WhatsApp conectado para piloto controlado. Canal oficial Meta previsto no roadmap ou disponível conforme escopo contratado." |
| Recuperação automática | Cliente esperar dinheiro recuperado sem operação, validação ou acompanhamento. | "Automação da régua e redução de tarefas manuais, com acompanhamento durante implantação." |
| Split e taxa de sucesso | Cobrança de taxa sem conciliação robusta pode gerar disputa financeira. | "Modelo de taxa de sucesso pode ser aplicado após validação de conciliação no piloto." |
| Dashboard | Dados mockados ou incompletos quebram confiança. | "Painel operacional em evolução; resultados do piloto serão apresentados com base nos pagamentos confirmados." |
| Cash-out | Prometer saque automático sem rotina pronta cria risco financeiro e jurídico. | "Repasse e liquidação seguem a configuração financeira validada no onboarding." |
| Onboarding instantâneo | Credenciamento financeiro e WhatsApp podem depender de terceiros. | "Implantação assistida sujeita à aprovação dos provedores envolvidos." |

## Roadmap mínimo para destravar venda mais agressiva

1. Fechar o fluxo automático cobrança -> pagamento -> link -> mensagem -> webhook -> status.
2. Implementar dashboard com dados reais por período.
3. Criar ações operacionais no front: gerar pagamento, reenviar cobrança, consultar status e marcar exceção.
4. Validar Efí em homologação/produção com empresa teste.
5. Definir oficialmente a estratégia WhatsApp do lançamento: Evolution para piloto controlado ou Meta Cloud API antes de venda pública.
6. Implementar conciliação mínima para taxa de sucesso.
7. Definir contrato do piloto com limites de volume, responsabilidades do cliente e escopo do suporte.

## Recomendação final

Lançar agora é possível, desde que o lançamento seja tratado como **piloto comercial controlado** e não como lançamento público da promessa completa.

O CobraPix deve vender resultado operacional inicial: organizar cobranças, ativar uma régua, enviar mensagens e medir recuperação. A promessa maior - recuperação automática em escala, canal oficial, split completo, cash-out e dashboard financeiro robusto - deve ficar como visão de produto e roadmap, não como entrega garantida do MVP atual.
