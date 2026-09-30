# Correções dos testes de produção — contexto, decisões e roteiro

Data: 29/09/2026. Base inspecionada: `main`, commit `75f052e`.

Documento de planejamento. Nenhuma correção, emissão, migração ou alteração da VPS foi executada durante sua elaboração. As observações de código abaixo não substituem a consulta dos registros das duas cobranças na produção.

## 1. Contexto para quem chega ao projeto

A CifraMais permite que empresas cadastrem devedores, preparem faturas, emitam cobranças e acompanhem pagamentos e comunicações. Existem três públicos diferentes:

| Público | Acesso esperado |
| --- | --- |
| Administrador CifraMais | Ativação financeira manual, integrações centrais, catálogo de templates, empresas, operação e conciliação |
| Usuário de uma empresa | Seus clientes, cobranças, régua, estatísticas e conversas atribuídas à própria empresa |
| Pessoa que vai pagar | Somente a página da cobrança identificada por um link válido; sem conta ou login |

O frontend Next.js está na Vercel. A API NestJS, PostgreSQL, Redis e Nginx estão na VPS InterServer. O Prisma pertence exclusivamente ao backend. A referência de desenvolvimento é a raiz `C:\micro-saas`; os caminhos técnicos nos planos são relativos a essa raiz.

Nesta versão, a ativação financeira utilizável é a **conta Efí do próprio cliente**, configurada pelo administrador com as credenciais e o certificado do cliente. O pagamento entra nessa conta e a remuneração da plataforma utiliza split. Embora existam tipos e preparações para modos com a conta CifraMais, o runbook atual os descreve como Fase B, bloqueada. Este trabalho não habilita essa fase.

O WhatsApp utiliza um canal central via **Datafy**, compartilhado entre as empresas. Os templates são criados na Meta, importados via Datafy, mapeados pelo administrador e liberados por empresa. Não existe integração direta do backend com a Meta. E-mail usa a conta central do Resend, mantendo atribuição das mensagens à empresa.

### Fluxo resumido

1. O administrador ativa a integração financeira da empresa.
2. A empresa prepara uma fatura em rascunho.
3. A emissão reserva uma tentativa local e solicita o pagamento à conta Efí emissora.
4. A confirmação local disponibiliza boleto/Pix/link. Uma situação incerta exige conciliação, não outra emissão.
5. Uma intenção de comunicação é preparada, validada e processada pela fila.
6. Datafy aceita ou rejeita o envio; os webhooks informam os estados posteriores.
7. O pagador abre o link público. O pagamento e a remuneração por split são acompanhados separadamente.

**Enfileirar, emitir, enviar, entregar e pagar são eventos diferentes.** Um pagamento pode existir enquanto sua mensagem está retida. Reenviar uma mensagem não deve criar um novo pagamento.

## 2. Decisões confirmadas com o responsável pelo produto

| Tema | Decisão |
| --- | --- |
| Cota WhatsApp por empresa | Remover a regra de cota individual; a capacidade passa a ser compartilhada pelo canal central |
| Dashboard da empresa | Retirar limites, saldo de capacidade, qualidade e indicadores operacionais do canal; manter estatísticas das mensagens da própria empresa |
| E-mail | Mesma separação de visibilidade: capacidade da conta no admin e resultados da empresa no seu dashboard; não inventar uma cota por empresa |
| Ativação financeira | Desativar toda a autoativação enquanto o modo for manual: menu, botão e formulário acessado diretamente por URL |
| Aviso de ativação | Empresa pendente vê que a equipe está configurando a conta; empresa ativa não recebe orientação para ativar novamente |
| Pagamento público | Qualquer pessoa com link válido pode abrir a cobrança, sem login e sem acesso ao restante do sistema |
| Cobrança encerrada | Link ainda válido mostra o status, sem instrumentos para novo pagamento; vencimento, sozinho, não significa encerramento |
| Clientes | O defeito relatado é o menu dos três pontos cortado pelo contêiner da tabela |
| Inbox | Textos longos, especialmente códigos, devem quebrar visualmente sem alterar seu conteúdo |
| Conferência Efí | As cobranças de R$ 5,00 e R$ 3,00 ainda não foram conferidas na conta emissora |

Premissas de implementação: manter a validade atual de 90 dias dos links assinados; não adicionar login, senha ou OTP à página pública; não retomar automaticamente mensagens retidas por template; não alterar tarifas, split ou habilitar novos modos financeiros.

## 3. Como interpretar os registros de Bolix

Os dois registros informados são:

| Fatura, prefixo | Valor | Exibição informada |
| --- | --- | --- |
| `dfcfed91` | R$ 5,00 | `PENDING` desde 29/09/2026, 15:12:27 |
| `06c5f13e` | R$ 3,00 | `PENDING` desde 29/09/2026, 15:10:38 |

Esses prefixos não substituem os identificadores completos. Registrar também o fuso da tela antes de procurar os mesmos eventos em logs UTC.

Na lista **Emissões para conciliar**, `PENDING` é o estado de uma tentativa de emissão local ainda não finalizada. O endpoint seleciona tentativas `DRAFT/PENDING` antigas há pelo menos dez minutos e divergências de modalidade. Não significa simplesmente que o pagador ainda não pagou. Uma fatura `Invoice.PENDING`, uma emissão `PaymentCharge.PENDING` e o estado externo da Efí não devem receber a mesma interpretação na interface.

No código inspecionado, qualquer exceção da chamada de emissão é transformada em `EFI_SUBMISSION_UNCERTAIN`. Assim, uma resposta de rejeição e uma perda de comunicação podem aparecer com a mesma mensagem. Isso explica a falta de diagnóstico específico, **mas não comprova a causa destas duas ocorrências**.

O comportamento conservador tem uma finalidade válida: se a Efí criou a cobrança, mas a resposta se perdeu, repetir a emissão pode duplicá-la. A correção precisa melhorar a classificação e a recuperação, preservando essa proteção.

O texto `version: 1 · credentialVersion: 1 · unverifiedStepsAcknowledged: ["BOLIX_ISSUANCE", "BOLIX_SPLIT"]` pertence à auditoria da ativação:

- `version`: versão da preparação/perfil financeiro ativado.
- `credentialVersion`: versão das credenciais usadas na validação.
- `unverifiedStepsAcknowledged`: ciência de que emissão real e split do Bolix ainda não foram comprovados pela validação sem emissão.

Essa ciência não é um erro devolvido pela Efí, nem uma comprovação de que o Bolix ou seu split funcionaram. A documentação da Efí apresenta a resposta Bolix com boleto e Pix, e disponibiliza consulta da cobrança existente pelo identificador. Isso fundamenta conferir a modalidade e recuperar os dados por consulta. [Documentação oficial de boleto/Bolix](https://dev.efipay.com.br/docs/api-cobrancas/boleto/).

Não há evidência suficiente para atribuir o problema ao valor de R$ 3,00 ou R$ 5,00, a permissões, ao split ou à configuração da conta. Essas são hipóteses a verificar, sem modificar valores ou configurações para mascarar a causa.

## 4. Evidências no código e limites do diagnóstico

| Ponto | Evidência | O que falta comprovar |
| --- | --- | --- |
| Bolix sem motivo claro | `api-cobranca/src/payment/efi.service.ts`, método `runIssuanceRequest`, transforma toda exceção em confirmação incerta | Erro original e existência das duas cobranças na Efí |
| Conciliação incompleta | `reconcileCharge` retorna revisão necessária para emissão sem ID externo e para alguns estados de cobrança existente ainda pagável | Quais referências sobreviveram nas ocorrências reais |
| Login no pagamento | `front-cobranca/src/middleware.ts` protege `/pagar/...`; já existe página separada do painel e endpoint público | Reproduzir depois em navegador anônimo e conferir publicação correta |
| Encerramento no link | `payment-link.service.ts` só consulta faturas `PENDING` | Implementar a resposta de status para faturas encerradas |
| Cota individual | `messaging-limit.service.ts` reserva capacidade central e também verifica o tier da empresa | Capacidade e unidade atualmente expostas pelo Datafy para a conta real |
| Autoativação visível | Sidebar, banner e página já têm condicionais para `openingEnabled=false` | Valor efetivo de `EFI_OPENING_ENABLED`, resposta da API e versão publicada; não presumir ausência de implementação |
| Menu recortado | Menu absoluto dentro do contêiner com rolagem da tabela | Reprodução visual, incluindo última linha e borda inferior |
| Inbox | Texto com `whitespace-pre-wrap`, sem tratamento suficiente de sequências sem espaços | Validar bolhas, citações e anexos em larguras diferentes |

A documentação Datafy indicada pelo usuário não pôde ser carregada pela ferramenta de pesquisa nesta investigação. A semântica atual da capacidade deve ser conferida na documentação acessível e na resposta da conta antes de modificar o cálculo. Não equiparar automaticamente “mensagens por dia”, “destinatários únicos em 24 horas” e limites por segundo.

## 5. Planos de implementação

Cada frente pode ser revisada e publicada separadamente. Todos os planos incluem arquivos, contratos, testes e critérios de conclusão.

| Ordem sugerida | Entrega | Plano |
| --- | --- | --- |
| 1 | Diagnóstico das ocorrências, classificação dos erros e recuperação segura de Bolix | [01 — Bolix e conciliação](../plans/2026-09-29-01-bolix-conciliacao.md) |
| 2 | Link público independente de sessão e estados de encerramento | [02 — Pagamento público](../plans/2026-09-29-02-pagamento-publico.md) |
| 3 | Remoção da cota por empresa, métricas isoladas e rastreio do envio | [03 — Canal central e estatísticas](../plans/2026-09-29-03-canal-central-estatisticas.md) |
| 4 | Menu de clientes, texto do Inbox e retirada completa da autoativação | [04 — Interface e ativação manual](../plans/2026-09-29-04-interface-ativacao-manual.md) |

O diagnóstico financeiro é prioritário. A liberação da rota pública e os ajustes visuais não dependem de a Efí responder sobre as duas cobranças. A parte de status do pagamento público deve consumir o mesmo critério de emissão confirmada estabelecido no plano financeiro.

## 6. Restrições comuns

1. Preservar isolamento por empresa, conta emissora original, auditoria e idempotência.
2. Não emitir novamente, excluir reservas ou marcar uma cobrança como paga apenas para tirar uma pendência da tela.
3. Recuperar uma emissão não comprova o recebimento do split; a conciliação financeira continua separada.
4. Datafy permanece o único transporte WhatsApp. Manter opt-in, supressão do destinatário, regras de template, janela de atendimento e ritmo de envio.
5. A autorização de leitura de um link de pagamento vale somente para aquela cobrança. Não pode gerar sessão ou liberar uma API administrativa.
6. Preservar estatísticas históricas por empresa; retirar cotas não autoriza apagar histórico de mensagens.
7. Testes que escrevem em banco e Redis devem usar infraestrutura descartável local. Não usar Neon compartilhado ou VPS de produção para testes automatizados.
8. Nenhum segredo, certificado, token de pagamento ou payload com dados pessoais deve ser adicionado a logs, fixtures ou documentos de diagnóstico.
9. Não incluir upgrade geral de dependências, Actions, migração de hospedagem, novo gateway ou implantação da Fase B.

## 7. Publicação e conclusão do conjunto

- [ ] Registrar o commit de cada entrega, resultado dos testes e eventuais dependências externas ainda abertas.
- [ ] Antes do deploy, preservar a imagem anterior e fazer backup verificável de PostgreSQL, segredos e anexos, com cópia fora da VPS. Não apagar filas ou volumes.
- [ ] Publicar o backend compatível antes do frontend. Se algum contrato precisar ser substituído, manter o antigo durante a transição e publicar consumidores antes de removê-lo.
- [ ] Se a implementação exigir migration adicional, ela deve ser aditiva, revisada e testada em cópia descartável; usar `prisma migrate deploy` na VPS, nunca `migrate dev`, `db push` ou `down -v`.
- [ ] Validar API saudável, configuração Nginx e domínio público. Um `/health` saudável, isoladamente, não comprova emissão, split ou entrega de mensagem.
- [ ] Fazer a conferência somente leitura das duas emissões já existentes antes de um novo teste financeiro controlado.
- [ ] Testar um fluxo completo com destinatário do operador: emitir uma vez, obter instrumentos, abrir em janela anônima, observar intenção de envio e eventos Datafy. Se for necessário pagar para testar baixa/split, tratar isso como uma ação financeira real e autorizada pelo operador.
- [ ] Com pagamento ou cancelamento confirmado, reabrir o mesmo link e comprovar ausência dos controles de pagamento. Verificar o estado real da Efí, pois esconder um botão local não cancela um boleto já emitido.
- [ ] Validar que uma empresa não vê métricas, conversas ou detalhes de outra; admin continua vendo a operação central.
- [ ] Rollback de aplicação usa a imagem anterior e o deploy anterior da Vercel, preservando os dados. Não restaurar um banco antigo sobre pagamentos recebidos após o backup; conciliar esses eventos antes de qualquer recuperação de dados.

O conjunto estará concluído quando os seis problemas relatados tiverem evidência de correção e o destino das duas emissões pendentes estiver documentado. Se a Efí ainda precisar localizar uma emissão sem identificador, manter essa ocorrência explicitamente aberta, mesmo que as melhorias de código já tenham sido publicadas.
