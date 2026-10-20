# Régua de cobrança com templates automáticos (20/10/2026)

Simplifica a régua e os templates. Substitui a escolha de template por etapa descrita em
[templates por forma de pagamento](../plans/2026-09-30-templates-emissao-por-forma-de-pagamento.md)
e os padrões por finalidade de cobrança de
[catálogo Meta com liberação por empresa](2026-09-27-whatsapp-meta-catalog-company-grants-design.md).

## Pedido

Novos usuários acharam a régua e os templates complexos (feedback em reuniões com possíveis
clientes). O usuário passa a decidir só **quando** e **por qual canal** cobrar; a mensagem é
escolhida pelo sistema, pelo **momento da cobrança** e pela **forma de pagamento**.

## Decisões do responsável pelo produto (20/10/2026)

1. **18 templates WhatsApp globais**: 6 momentos (Emissão, Lembrete, Vence hoje, Primeiro atraso,
   Atraso recorrente, Atraso crítico) × 3 formas (Pix, Bolix, Cartão). O admin CifraMais escolhe os
   18 uma vez; valem para todas as empresas, sem liberação por empresa.
2. **Template sob medida**: a empresa pede pelo **formulário de suporte** no sistema um template
   para uma etapa específica da régua. O pedido fica registrado, chega por e-mail ao admin e aparece
   numa lista no painel. O admin liga o template aprovado àquela etapa.
3. As escolhas de template feitas hoje pelas empresas **passam ao automático**; os campos antigos
   ficam no banco só como histórico.
4. O **e-mail** também segue o momento. Saudação, instruções e assinatura continuam personalizáveis.
5. Boleto sem Pix existe só em ambientes de teste: não ganha template (se aparecer, fica pendente).
6. **Emissão**: só há mensagem de emissão quando o usuário pede no **cadastro da fatura**
   ("Enviar cobrança agora", com os canais). A emissão sai da régua.
7. **Atraso recorrente**: fatura recorrente (gerada em Recorrentes) vencida usa sempre esse template.
8. **Primeiro atraso e Atraso crítico** (fatura avulsa): a primeira mensagem de atraso que o cliente
   **realmente recebeu** usa Primeiro atraso; as seguintes usam Atraso crítico, que se repete.
9. **Intervalo mínimo de 24 h** entre duas mensagens da mesma fatura. A mensagem que não cumpre o
   intervalo espera a próxima rodada. Lembrete com data anterior ao cadastro é ignorado. Se a espera
   alcançar a data da próxima etapa, só a mais recente é enviada.

## Regras de envio

### Momento

Calculado **na hora do envio**, pelo estado real da fatura (dia em São Paulo):

| Situação no dia do envio | Template |
| --- | --- |
| Mensagem pedida no cadastro | Emissão |
| Antes do vencimento | Lembrete |
| No dia do vencimento | Vence hoje |
| Vencida e fatura recorrente | Atraso recorrente |
| Vencida, avulsa, sem atraso recebido antes | Primeiro atraso |
| Vencida, avulsa, com atraso já recebido | Atraso crítico |

"Atraso recebido" é uma tentativa de envio feita depois do vencimento que não falhou nem ficou
retida. O momento usa o dia real: um lembrete adiado pelas 24 h que sai no vencimento usa
"Vence hoje", e o texto nunca fica errado.

### Contatos e intervalo

- As etapas do mesmo dia (WhatsApp e e-mail) formam **um contato** e saem juntas.
- Em cada rodada (09:00 e 17:00), entre os contatos com data até hoje ainda não enviados, só o **mais
  recente** é considerado; os anteriores ficam registrados como pulados e não saem mais.
- Contato antes do vencimento com data anterior ao dia do cadastro da fatura é ignorado.
- Se a última mensagem da fatura (emissão ou contato) foi há menos de 24 h, o contato espera.

Exemplo: cadastro e emissão em 20/10 às 15h, vencimento em 23/10, lembrete em 21/10. O lembrete sai
na rodada das 17h de 21/10. Se só pudesse sair em 23/10 e houver contato no vencimento, sai só o do
vencimento.

### Qual template

1. Sob medida da etapa para a forma de pagamento, quando o admin ligou um.
2. Global de (momento, forma de pagamento).
3. Nenhum: a mensagem fica **pendente** para o admin (fluxo atual). Nunca se troca por outro.

Templates de Cartão só podem usar o link de pagamento (sem Pix e sem boleto). Os padrões por empresa
de ativação financeira e de pagamentos a colaboradores não mudam.

## Telas

- **Admin → Templates**: grade "Templates da régua" (6 × 3) para escolher os 18; aba "Solicitações"
  com os pedidos das empresas e o atalho para ligar o template sob medida.
- **Configurações → Templates** (empresa): grade compacta dos 18; ao selecionar, a prévia de como a
  cobrança chega ao cliente no WhatsApp (como na landing). Botão "Solicitar template personalizado".
- **Configurações → Régua de Cobrança**: perfis e etapas por dia com caixas de WhatsApp e e-mail; o
  momento aparece sozinho, com "Ver mensagem". Sem escolha de template e sem "Contato inicial".
- **Cadastro da fatura e importação**: "Enviar cobrança agora", com os canais.

## Publicação em fases

1. Fase 1: os 18 templates globais e a tela do admin (não muda envios).
2. O admin escolhe os 18 em produção; o preflight confere.
3. Fase 2: novas regras de envio no backend.
4. Fases 3 e 4: telas da empresa, pedido ao suporte, nova régua e opção no cadastro.

Mudanças visíveis ao cliente final (registrar nas notas de publicação): etapas atrasadas não saem
mais em sequência (só a mais recente), a emissão depende do pedido no cadastro e há intervalo
mínimo de 24 h entre mensagens.
