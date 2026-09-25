# 2. Plano de desenvolvimento — ativação financeira administrativa

Data: 24/09/2026. Situação: proposta de desenvolvimento; nenhuma funcionalidade financeira deste plano foi implementada nesta entrega.

Leitura inicial: [contexto do sistema e vocabulário](../specs/2026-09-24-contexto-sistema-ativacao-financeira.md).

## 1. Objetivo e decisões confirmadas

Permitir que o administrador global ative financeiramente uma empresa sem depender da API de abertura de contas da Efí. A empresa continuará utilizando cadastro de devedores, faturas, emissões, régua e acompanhamento existentes.

O responsável pelo produto confirmou os dois modos de conta e os dois modos de repasse abaixo. A escolha é feita **por empresa**; empresas diferentes podem operar de formas diferentes simultaneamente.

| Configuração | Quem autentica/emite | Quem recebe o pagamento | Como o cliente recebe sua parte |
| --- | --- | --- | --- |
| Conta própria do cliente | Aplicação Efí do cliente, com suas credenciais e certificado | Conta Efí do cliente | Recebimento próprio; a comissão da CifraMais segue a política de tarifas/split existente. |
| Conta CifraMais + split | Aplicação Efí da plataforma | Recebimento e distribuição conforme o split da cobrança | Efí distribui a parte destinada à conta do cliente. |
| Conta CifraMais + repasse manual | Aplicação Efí da plataforma | Conta Efí da plataforma | Administrador transfere posteriormente e registra o repasse conciliado. |

“Conta do admin” significa a **conta bancária da CifraMais configurada no servidor**, não a conta pessoal do usuário que está autenticado no painel.

O caminho automático de abertura será preservado. Ao terminar, ele deverá alimentar a mesma configuração financeira usada pelo caminho administrativo.

### Convenções propostas para esta implementação

Estas escolhas detalham a demanda e devem constar da especificação, sem serem confundidas com funcionalidades já existentes:

- Novas emissões continuam restritas a **PIX e BOLIX**, como determina a política atual; boletos legados continuam consultáveis. BOLIX deve ser testado tanto no pagamento por boleto quanto pelo Pix associado.
- No repasse manual, a transferência é feita no banco pelo administrador. O CifraMais prepara o lote, reserva os valores e registra a confirmação com referência/comprovante. Não se inclui nesta versão um endpoint que envie Pix de saída.
- Repasses manuais serão integrais por saldo elegível de cada cobrança, agrupáveis por empresa e destino. Parcelar arbitrariamente o repasse de uma cobrança fica fora da primeira versão.
- Alterações de conta, destino, tarifa ou tipo de repasse valem para **novas cobranças**. Uma cobrança já emitida conserva a configuração original.
- A ativação não envia uma cobrança ou mensagem imediatamente. Ela permite que os fluxos existentes prossigam conforme suas regras; uma régua já habilitada pode voltar a atuar no próximo ciclo. A tela deve explicar isso antes de confirmar.
- Não haverá conversão automática de split com problema para repasse manual. Essa troca pode causar pagamento em dobro e exige conciliação específica.

## 2. Fluxos de negócio completos

### 2.1 Ativar com conta própria do cliente

1. Administrador abre a empresa em “Clientes”, mesmo que ela nunca tenha iniciado o formulário de abertura de conta.
2. Seleciona “Ativar financeiro” e “Conta Efí do cliente”.
3. Confere razão social, CPF/CNPJ e titularidade da conta. Registra quem verificou, quando, referência da evidência e a autorização do cliente para integrar a conta.
4. Informa ambiente, `clientId`, `clientSecret`, certificado `.p12`, senha quando existir, identificação da conta e os dados necessários aos meios de pagamento habilitados.
5. O sistema salva uma configuração candidata criptografada, sem substituir uma integração ativa.
6. “Validar integração” testa certificado, autenticação, recursos de pagamento, chave Pix, webhooks, identificação do recebedor e configuração de comissão.
7. O painel mostra o resultado de cada verificação, sem expor segredos. HTTP 200 no OAuth não basta para provar titularidade nem todas as permissões de emissão.
8. O administrador revisa tarifas, meios habilitados e efeitos da ativação e confirma.
9. Uma transação publica a versão financeira, registra auditoria e libera a empresa para emitir. Nenhuma chamada é feita à API de abertura de contas.

As credenciais/certificado de uma conta existente são obtidos no ambiente da própria Efí. Separação entre produção e homologação e habilitação da API Cobranças devem ser respeitadas. [Credenciais Pix](https://dev.efipay.com.br/docs/api-pix/credenciais/), [credenciais Cobranças](https://dev.efipay.com.br/docs/api-cobrancas/credenciais/).

### 2.2 Ativar com conta CifraMais e split automático

1. Administrador seleciona “Conta CifraMais” e “Repasse automático por split”.
2. A aplicação carrega a identidade e a saúde da conta central pelo servidor. Não solicita nem copia suas credenciais no cadastro de cada empresa.
3. Administrador informa e verifica a conta beneficiária do cliente, documento, identificador Efí e política de tarifas.
4. Validação confere suporte ao split para cada meio habilitado e coerência entre origem, beneficiário e valores.
5. Confirmação publica a configuração financeira e registra a autorização/evidência utilizada.
6. Ao emitir, a cobrança é autenticada pela plataforma; a parte do cliente é direcionada ao cliente e a remuneração da plataforma permanece com a CifraMais.
7. Após pagamento, o sistema confirma separadamente a situação da cobrança e a efetivação do repasse. Configuração de split aceita não significa repasse liquidado.

O split Pix documentado pela Efí utiliza contas Efí e não permite repasse à própria conta emissora. Na API Cobranças, os beneficiários são identificados por `payee_code`; a configuração de tarifa difere entre repasse fixo e percentual. Não aplicar o mesmo payload aos dois produtos. [Split Pix](https://dev.efipay.com.br/docs/api-pix/split-de-pagamento-pix/), [split Cobranças](https://dev.efipay.com.br/docs/api-cobrancas/split-de-pagamento/).

### 2.3 Ativar com conta CifraMais e repasse manual

1. Administrador seleciona “Conta CifraMais” e “Repasse manual”.
2. Confere destino do cliente, titularidade, tarifas e regra de disponibilidade do valor. O plano inicial pode utilizar a conta Efí do cliente já prevista; outros bancos exigem validação equivalente do destino.
3. Ativação valida a integração emissora central. Não exige certificado ou chaves de API do cliente apenas para que ele receba a transferência manual.
4. Pagamento conciliado cria um direito de recebimento para a empresa. Esse valor fica “Aguardando disponibilidade/conciliação” até haver evidência suficiente de liquidação e valor líquido.
5. Administrador abre “Repasses”, filtra a empresa e seleciona cobranças elegíveis. O servidor calcula o total; o navegador não define o saldo.
6. A criação do lote reserva atomicamente os itens. A tela mostra favorecido, destino, cobranças, tarifas, valor e referência do lote.
7. Administrador inicia a execução, transfere no banco e registra identificação bancária, data, valor e comprovante/referência verificável.
8. Somente após conferência o lote é marcado “Repassado”; a empresa visualiza seu próprio histórico. Dúvida sobre execução mantém o lote reservado para conciliação.

Não usar o saldo total da conta central como saldo de uma empresa: ele pode conter pagamentos de vários clientes, valores indisponíveis e remuneração da plataforma.

### 2.4 Exemplo didático de valores

Considere cobrança de R$ 100,00, remuneração CifraMais de R$ 3,00 e, apenas para simplificar o exemplo, tarifa bancária zero:

| Modo | Resultado econômico esperado |
| --- | --- |
| Conta cliente | Cliente recebe R$ 97,00; CifraMais recebe R$ 3,00 pela política de comissão. |
| Plataforma + split | Divisão automática: R$ 97,00 ao cliente e R$ 3,00 à CifraMais. |
| Plataforma + manual | Plataforma recebe R$ 100,00; registra obrigação de R$ 97,00 e a liquida no repasse manual. |

Não são valores comerciais propostos. A implementação reutiliza a versão de tarifas contratada, registra quem suporta a tarifa bancária e diferencia tarifa estimada de efetiva. Juros, descontos, multas, pagamento parcial e devolução precisam de regra explícita; casos sem regra ficam em conciliação, sem liberar repasse estimado como se fosse definitivo.

## 3. Regras que devem valer em todas as etapas

1. **Ativação não é abertura de conta.** A elegibilidade financeira passa a consultar um perfil financeiro ativo. Não fabricar `requestId`, consentimento ou `EfiOnboarding.ACTIVE` para fingir uma abertura concluída.
2. **Autoridade do backend.** Apenas `PLATFORM_ADMIN` cria/valida/ativa versões, altera destinos e registra repasses. A empresa consulta somente suas informações permitidas. Validar permissões também por HTTP, não apenas esconder botões.
3. **Isolamento por empresa.** Toda consulta e mutação de fatura, cobrança, obrigação e lote verifica `companyId`. Um lote pertence a uma única empresa, moeda e versão de destino.
4. **Nenhum fallback financeiro implícito.** Credencial de cliente inválida não autoriza usar a conta da plataforma. Uma conta/ambiente diferente jamais substitui silenciosamente a origem gravada.
5. **Histórico preservado.** Conta emissora e destino são imutáveis na emissão; credenciais podem ser renovadas para a mesma identidade bancária. Não prender para sempre uma cobrança a um certificado expirado.
6. **Ativação atômica.** Perfil ativo, ponteiro da empresa, compatibilidade necessária e auditoria entram na mesma transação. Falha em qualquer gravação desfaz a publicação inteira.
7. **Sem chamadas bancárias dentro de transação longa.** Operações externas usam estado durável, identificador determinístico, lease e verificação de revisão antes de publicar o resultado.
8. **Revisão protege confirmação.** Alterar CNPJ, conta, certificado, segredo, tarifa aplicável, métodos ou destino invalida a validação candidata. Confirmar revisão antiga retorna conflito.
9. **Segredos ficam no servidor.** Nunca retornar `clientSecret`, certificado, senha, token ou chave de criptografia em GET, log, auditoria, fila ou erro. Não persistir no navegador.
10. **Controles separados.** Pausar abertura de contas não impede ativação manual; pausar novas ativações manuais não interfere nas empresas já ativas; pausar pagamentos bloqueia novas emissões nos três modos. Webhooks, conciliação e auditoria continuam funcionando.
11. **Efeitos externos declarados.** O validador atual configura split e webhook. A nova tela deve informar essas configurações; “validar” não poderá criar uma cobrança pagável nem executar uma transferência para provar que funciona.
12. **Repasse único.** Cobrança com split não entra em lote manual. Um item manual não pode ser reservado em dois lotes concorrentes nem confirmado duas vezes por cliques/retries.
13. **Autorização registrada.** Registrar referência/versionamento da autorização adequada ao modo escolhido. Não marcar o cliente como tendo aceitado um texto no sistema quando o administrador apenas anexou evidência de uma autorização externa.
14. **Conta compartilhada tem saúde compartilhada.** Falha nas credenciais centrais pode afetar várias empresas. Suspender a emissão dependente e mostrar a causa central; não invalidar ou apagar os perfis de todos os clientes.

## 4. Modelo técnico proposto

Os nomes abaixo são propostos. A implementação deve adaptar convenções do repositório mantendo as responsabilidades e invariantes.

### 4.1 Separar três decisões

```text
activationOrigin = AUTOMATIC_OPENING | MANUAL_ADMIN
accountMode      = CUSTOMER_ACCOUNT | PLATFORM_ACCOUNT
payoutMode       = DIRECT_TO_CUSTOMER | EFI_SPLIT | MANUAL

Combinações válidas:
CUSTOMER_ACCOUNT + DIRECT_TO_CUSTOMER
PLATFORM_ACCOUNT + EFI_SPLIT
PLATFORM_ACCOUNT + MANUAL
```

`DIRECT_TO_CUSTOMER` descreve recebimento na conta própria; não elimina a comissão da plataforma prevista no contrato. Abertura automática só gera `CUSTOMER_ACCOUNT`. Restrições de combinação devem existir no serviço e no banco quando expressáveis.

### 4.2 Persistência e referências

| Entidade proposta | Dados/responsabilidade |
| --- | --- |
| `FinancialProfileVersion` | Empresa, número/revisão, origem, modos, ambiente, identidade emissora, versão de destino, métodos, aprovação/autorizações, resultado de validação, estado, autor e datas. Campos financeiros ficam imutáveis após ativação. |
| `Company.activeFinancialProfileId` | Ponteiro para a configuração publicada; a troca usa compare-and-set e verifica que o perfil pertence à empresa. Uma candidata não altera este ponteiro. |
| `EfiAccountIdentity` | Identidade estável da conta bancária e ambiente, titularidade `PLATFORM` ou `COMPANY`, documento, conta e identificadores do provedor. Uma identidade central é compartilhada por referência. |
| `EfiCredentialVersion` | Versão de credenciais/certificado criptografados para uma identidade, fingerprint, validade, versão da chave de criptografia, capacidades e estado. Permite rotação sem mudar a origem das cobranças. |
| `FinancialRecipientVersion` | Documento/titular, conta/destino, identificador Efí quando necessário, evidência de verificação e responsável. Alterar destino cria nova versão. Dados pessoais com acesso restrito. |
| `FinancialValidationAttempt` | Perfil/revisão, passos, lease, tentativas, próximo processamento, resultado seguro e validade da validação. Não contém segredo em JSON ou no job. |
| Extensões de `PaymentCharge` | Referência ao perfil, identidade emissora, destino, modos, ambiente, identificador externo e fotografia da distribuição. Mantém o snapshot de tarifas já existente. |
| `FinancialSettlement` | Conciliação de uma cobrança: valor efetivamente recebido, tarifas, líquido devido, disponibilidade, modo de repasse e situação. Não confundir com `PaymentCharge.status`. |
| `SettlementEntry` | Lançamentos imutáveis de recebimento, tarifa, ajuste, devolução e liquidação de repasse. Cada evento possui chave de deduplicação. Ajustes são novos lançamentos, não edição do histórico. |
| `PayoutBatch` / `PayoutItem` | Lote manual, empresa, destino congelado, itens/valores reservados, estado, referência bancária, evidência, autor e datas. |

Reutilizar `AuditLog`, `PaymentFeeVersion`, histórico de cobrança e criptografia existentes. Evitar duas fontes permanentes de verdade: `GatewayAccount` é adaptado temporariamente para o fluxo atual, com referência à identidade/credencial; a identidade passa a ser a origem comum. Não criar um `GatewayAccount` fictício com os segredos centrais para cada empresa.

Uma cobrança conserva a identidade emissora original e a versão de credencial usada na emissão para auditoria. Consultas posteriores podem utilizar uma credencial válida mais recente **da mesma identidade e ambiente**. Se nenhuma existir, registrar indisponibilidade e solicitar renovação; não trocar de conta.

### 4.3 Estados e concorrência

Perfil candidato: `DRAFT → VALIDATING → READY → ACTIVE`. Falhas de validação levam a `VALIDATION_FAILED`; edição exige nova revisão e validação. Candidatos também podem ser `CANCELED` ou `EXPIRED`. Ao substituir um perfil ativo, o antigo passa a `SUPERSEDED` e continua referenciável pelas cobranças antigas.

Proposta inicial: validação utilizável por 15 minutos, desde que a revisão, a titularidade, a identidade central, a versão de credenciais e a política relevante continuem iguais. Não usar somente horário para decidir validade. Ativação repetida com a mesma chave e conteúdo devolve o mesmo resultado; mesma chave com conteúdo diferente retorna `409`.

Na transação de ativação, bloquear/atualizar condicionalmente a empresa e conferir a revisão. Todos os criadores de cobrança devem capturar o perfil ativo e persistir o contexto sob a mesma disciplina de concorrência. Definir que uma emissão já reclamada conserva sua versão, mesmo que o perfil mude antes da resposta do provedor.

Repasse manual: `DRAFT → RESERVED → IN_PROGRESS → PAID`. Antes de iniciar a transferência, pode-se cancelar e liberar a reserva. Depois de `IN_PROGRESS`, cancelamento exige evidência de que a transferência não ocorreu. Resultado desconhecido vai para `RECONCILIATION_REQUIRED`, mantendo reserva; não volta automaticamente a disponível.

Liquidação do split: estados de acompanhamento `PENDING`, `CONFIRMED`, `DIVERGENT`, `REVERSED`. Ausência de confirmação não significa falha definitiva e não autoriza uma segunda transferência.

### 4.4 Contratos HTTP propostos

Prefixo administrativo com `JwtAuthGuard` e `PlatformAdminGuard`. IDs são opacos; parâmetros e corpo são validados estritamente. As rotas antigas de recuperação da abertura mantêm sua semântica.

| Método/rota nova | Entrada principal | Resultado |
| --- | --- | --- |
| `GET /admin/companies/:companyId/financial-profile` | Empresa autorizada | Perfil atual, candidato e verificações mascaradas. |
| `POST /admin/companies/:companyId/financial-activations` | Modos, ambiente, métodos, destino, autorizações; chave de idempotência | Candidato e revisão; `201`, ou candidato existente em repetição idêntica. |
| `PUT /admin/financial-activations/:id/configuration` | Revisão esperada e campos alteráveis | Nova revisão; invalida validação anterior. |
| `PUT /admin/financial-activations/:id/credentials` | Multipart: `.p12`, senha, credenciais, revisão esperada | Somente fingerprint/validade/indicadores; nunca eco dos segredos. |
| `POST /admin/financial-activations/:id/validate` | Revisão e chave de idempotência | `202`, identificador da tentativa; execução durável. |
| `GET /admin/financial-activations/:id` | ID | Estado, passos e erros seguros para polling. |
| `POST /admin/financial-activations/:id/activate` | Revisão, tentativa válida, confirmação e idempotência | Perfil publicado ou conflito; nunca reexecutar abertura. |
| `POST /admin/financial-activations/:id/cancel` | Revisão e motivo | Candidato cancelado, sem apagar configuração ativa. |
| `POST /admin/efi-accounts/:id/credential-rotations` | Material novo e revisão | Candidato de rotação validado antes da substituição. |
| `GET /financial-profile` | Empresa da sessão | Situação, métodos, modo e destino mascarado; sem credenciais. |
| `GET /admin/settlements` | Empresa, situação, período e cursor | Conciliação e valores de cada empresa. |
| `POST /admin/payout-batches` | Empresa, IDs de saldos elegíveis, destino e idempotência | Reserva atômica e total calculado pelo servidor. |
| `POST /admin/payout-batches/:id/start` | Revisão e confirmação | Marca início da transferência externa; não envia dinheiro. |
| `POST /admin/payout-batches/:id/confirm` | Referência, valor, data, evidência e idempotência | Confirmação conciliada e lançamentos, ou divergência. |
| `POST /admin/payout-batches/:id/cancel` | Motivo/revisão; evidência se já iniciado | Cancelamento apenas quando permitido pela máquina de estados. |
| `GET /financial-settlements` | Empresa da sessão e filtros | Recebimentos e repasses somente daquela empresa. |

Utilizar paginação/cursor e projeções específicas. Erros sugeridos: `FINANCIAL_PROFILE_NOT_READY`, `VALIDATION_STALE`, `ACCOUNT_OWNERSHIP_UNVERIFIED`, `PROVIDER_SCOPE_MISSING`, `CERTIFICATE_INVALID`, `OPENING_RECONCILIATION_REQUIRED`, `PAYOUT_ALREADY_RESERVED`, `PAYOUT_RECONCILIATION_REQUIRED`. Mensagens do provedor devem ser saneadas e convertidas, sem repassar objetos brutos ao navegador.

## 5. Etapas de implementação

Cada etapa termina com testes focados e revisão do diff. Comportamento financeiro novo permanece atrás de liberação específica até a etapa de publicação. Os arquivos existentes estão vinculados; os caminhos de arquivos novos são propostas para o checkout `C:/micro-saas`.

### Etapa 1 — Consolidar contratos e compatibilidade

**Objetivo:** fechar o mapa de dependências sem alterar o comportamento existente.

**Ler:** [onboarding administrativo](C:/micro-saas/api-cobranca/src/efi-onboarding/onboarding-admin.service.ts), [provisionamento](C:/micro-saas/api-cobranca/src/efi-onboarding/onboarding-provisioner.ts), [gateway](C:/micro-saas/api-cobranca/src/payment/efi-gateway.client.ts), [emissão Efí](C:/micro-saas/api-cobranca/src/payment/efi.service.ts), [tarifas](C:/micro-saas/api-cobranca/src/payment-fees/payment-fee.service.ts), [schema](C:/micro-saas/api-cobranca/prisma/schema.prisma).

- [ ] Mapear cada uso de `EfiOnboarding.ACTIVE`, `GatewayAccount`, `getActiveGatewayAccount`, cache OAuth e credenciais de plataforma. Incluir emissão unitária/lote, régua, primeira cobrança, links públicos, consulta, cancelamento, devolução e webhook.
- [ ] Documentar quais chamadas validam leitura, quais comprovam capacidade e quais alteram webhook/split/chave. Não concluir que permissão de leitura comprova emissão.
- [ ] Definir a matriz de métodos por modo, incluindo BOLIX e confirmação de repasse em cada produto. Se um caminho não for suportado, a interface deve explicar e impedir sua habilitação.
- [ ] Definir política versionada de tarifas, disponibilidade, juros/descontos e devolução. Não inventar D+0/D+1 ou valores de tarifas durante a implementação.
- [ ] Confirmar com a Efí que a conta/aplicação da plataforma está habilitada para o modelo comercial escolhido e os recursos necessários. Isso é dependência de liberação real, não dependência para desenvolver com testes simulados.
- [ ] Criar tipos de domínio em `C:/micro-saas/api-cobranca/src/financial-activation/financial-activation.types.ts` e testes de combinações válidas em `financial-activation.types.spec.ts` na mesma pasta.

**Aceite:** os três caminhos têm requisitos e comportamento explícitos; a pessoa implementadora sabe onde a conta é selecionada e onde o repasse será comprovado. Não há chamada nova a `gn.registration.*` no desenho manual.

### Etapa 2 — Schema, migração e contexto de cobrança

**Alterar:** [schema canônico](C:/micro-saas/api-cobranca/prisma/schema.prisma). Criar migrations aditivas em `C:/micro-saas/api-cobranca/prisma/migrations/` e rotina de diagnóstico/backfill em `C:/micro-saas/api-cobranca/src/scripts/backfill-financial-profiles.ts`.

- [ ] Adicionar entidades/índices da seção 4 e integridade entre empresa, perfil, destino, identidade e cobrança. Impedir referência cruzada de empresa também no banco onde possível.
- [ ] Manter identificadores externos associados à identidade emissora e ambiente. Verificar se `efiChargeId`/`gatewayId` são únicos globalmente antes de mudar índices; não assumir essa garantia em múltiplas contas.
- [ ] Introduzir campos inicialmente opcionais para registros antigos. Exigir contexto em toda nova emissão quando o novo fluxo estiver habilitado.
- [ ] Implementar backfill em modo relatório por padrão. Converter conta própria existente apenas quando identidade, ambiente e vínculo estiverem demonstráveis.
- [ ] Não atribuir cobrança antiga à conta atual por suposição. Linhas sem origem comprovada entram em relatório de revisão; preservar o caminho legado restrito até resolver ou bloquear a operação afetada de forma explícita.
- [ ] Usar índices únicos para idempotência de candidatos, tentativas, eventos financeiros e confirmação de lotes. Reservas devem depender de locks/CAS no PostgreSQL, não apenas Redis.
- [ ] Criar testes reais em `C:/micro-saas/api-cobranca/test/financial-activation-postgres.cjs`, seguindo isolamento do [harness de pagamentos](C:/micro-saas/api-cobranca/test/payment-postgres.cjs).

**Testes essenciais:** duas ativações concorrentes publicam uma versão; rollback também remove auditoria/ponteiro; cobrança A não pode apontar perfil B; backfill é idempotente; cobrança sem origem não recebe credencial arbitrária.

**Aceite:** migração preserva dados existentes e deixa rastreável a origem de todas as novas cobranças.

### Etapa 3 — Credenciais, identidade e configuração candidata

**Criar:** `C:/micro-saas/api-cobranca/src/financial-activation/financial-activation.module.ts`, `financial-activation.controller.ts`, `financial-activation.service.ts`, `efi-account-registry.service.ts`, `financial-activation.dto.ts` e respectivos testes na mesma pasta.

**Reutilizar/revisar:** [criptografia](C:/micro-saas/api-cobranca/src/payment/payment-crypto.service.ts), [inspeção de certificado](C:/micro-saas/api-cobranca/src/payment/efi-certificate.ts), [limites HTTP](C:/micro-saas/api-cobranca/src/main.ts), [Nginx](C:/micro-saas/infra/interserver/nginx.conf).

- [ ] Implementar cadastro/edição de candidato com revisão, autorização e DTOs que rejeitam campos incompatíveis com o modo escolhido.
- [ ] Limitar o arquivo de certificado, por exemplo a 1 MiB, usando upload autenticado específico. Limitar também quantidade de arquivos/campos e tamanho dos campos; alinhar proxy e backend apenas na rota necessária.
- [ ] Validar conteúdo PKCS#12, chave privada, senha, validade e fingerprint; não confiar na extensão do arquivo. Não aceitar caminho do filesystem informado pelo navegador.
- [ ] Criptografar material sensível com chaves versionadas existentes e contexto vinculado à identidade. Apagar buffers/temporários conforme o mecanismo utilizado; nunca gravar cópia pública.
- [ ] Registrar titularidade por evidência independente. Certificado parseável e OAuth válido não bastam para concluir que a conta pertence ao CNPJ cadastrado.
- [ ] Importar/registrar a conta da plataforma a partir da configuração privada existente, uma vez, com diagnóstico e rotação controlada. Não criar múltiplas fontes divergentes entre env e banco.
- [ ] Definir a fonte de verdade: após migração verificada, registro de identidade/versão passa a selecionar a credencial; env permanece material de bootstrap ou referência explicitamente versionada, sem fallback automático.
- [ ] Expirar candidatos abandonados e seu material secreto conforme retenção documentada. Preservar credenciais/histórico necessários a contas que ainda possuem cobranças conciliáveis.

**Testes essenciais:** outra empresa/usuário recebe 403/404; arquivo inválido/expirado/grande é recusado; segredos não aparecem em resposta/log/auditoria; modo plataforma rejeita credencial de cliente desnecessária; rotação mantém identidade.

**Aceite:** é possível preparar as três configurações sem ativar ou emitir nada e sem substituir uma integração funcional.

### Etapa 4 — Validação e ativação independentes de abertura

**Criar:** `C:/micro-saas/api-cobranca/src/financial-activation/financial-validation.service.ts`, `financial-validation.worker.ts`, `financial-eligibility.service.ts` e testes correspondentes.

**Alterar:** [cliente do gateway](C:/micro-saas/api-cobranca/src/payment/efi-gateway.client.ts), [saúde](C:/micro-saas/api-cobranca/src/payment/gateway-health.service.ts), [validação de env](C:/micro-saas/api-cobranca/src/config/env.validation.ts), [exemplo env](C:/micro-saas/api-cobranca/.env.example), [env da VPS](C:/micro-saas/infra/interserver/api.env.example).

- [ ] Separar aquisição de conta pela API de abertura da preparação de uma conta existente. Reutilizar operações de pagamento; não chamar o provisionador atual inteiro como atalho.
- [ ] Validar por método e modo: certificado/autenticação, permissões requeridas, chave Pix selecionada ou criação explicitamente autorizada, webhook, capacidades de Cobranças/BOLIX e split quando aplicável.
- [ ] Conta central utiliza validação central cacheada por identidade/revisão, evitando repetir alterações de webhook para cada empresa. Destino e distribuição continuam validados por perfil.
- [ ] Usar IDs determinísticos por tentativa/configuração; checkpoints impedem duplicar chave Pix ou configuração após timeout. Antes de repetir efeito de resultado desconhecido, consultar/conciliar quando houver mecanismo disponível.
- [ ] Persistir trabalho no banco e publicar job com IDs, sem segredos. Uma rotina recupera validações pendentes após indisponibilidade/perda do Redis. Limitar tentativas e não tratar falha permanente de credencial como retry infinito.
- [ ] Implementar confirmação transacional com revisão, prazo e hash dos dados validados. Uma alteração da credencial central também invalida a candidata dependente quando mudar as condições verificadas.
- [ ] Introduzir capacidade de servidor `EFI_OPENING_ENABLED` e liberação administrativa manual separada. Preservar compatibilidade por default explícito; quando abertura estiver desabilitada, suas credenciais deixam de ser requisito para subir a API.
- [ ] Rotas/worker de abertura devem responder ou encerrar de forma clara quando a capacidade estiver desabilitada. Não registrar webhook de abertura ao liberar ativação manual.

**Aceite:** em teste, configurar o mock de `EfiOpeningClient` para falhar se qualquer método for chamado. Os três modos manuais devem validar/ativar sem acioná-lo. Perfil incompleto, revisão antiga e pagamentos globalmente pausados continuam impedindo emissão.

### Etapa 5 — Adaptar abertura existente, manutenção e elegibilidade

**Alterar:** [provisionador](C:/micro-saas/api-cobranca/src/efi-onboarding/onboarding-provisioner.ts), [workflow](C:/micro-saas/api-cobranca/src/efi-onboarding/onboarding-workflow.ts), [eventos](C:/micro-saas/api-cobranca/src/efi-onboarding/onboarding-events.ts), [manutenção](C:/micro-saas/api-cobranca/src/efi-onboarding/onboarding-maintenance.ts), [ciclo de vida](C:/micro-saas/api-cobranca/src/efi-onboarding/onboarding-lifecycle.ts), [billing](C:/micro-saas/api-cobranca/src/billing/billing.service.ts), [faturas](C:/micro-saas/api-cobranca/src/invoices/invoices.service.ts), [worker de mensagens](C:/micro-saas/api-cobranca/src/queue/workers/message.worker.ts).

- [ ] Fazer abertura automática concluída publicar perfil `AUTOMATIC_OPENING + CUSTOMER_ACCOUNT`, preservando os controles de consentimento existentes.
- [ ] Substituir verificações financeiras espalhadas por `FinancialEligibilityService`. Esse serviço considera perfil, métodos, saúde da conta emissora, situação da empresa e liberação global de pagamentos.
- [ ] Manter a possibilidade de salvar rascunhos e consultar histórico quando a emissão estiver bloqueada; não transformar falha de gateway em bloqueio geral de leitura do cliente.
- [ ] Manual ativo deve impedir novo envio de abertura e tornar jobs antigos inofensivos por revisão/origem. Webhook atrasado de abertura não sobrescreve o perfil manual.
- [ ] Pedido de abertura já enviado ou com resultado incerto exige conciliação explícita antes de substituir o processo. Quando a API estiver indisponível, permitir registro de evidência da verificação no painel Efí, sem inventar sucesso/cancelamento bancário.
- [ ] Separar renovação automática via abertura de renovação por upload administrativo. Contas manuais precisam de alerta de validade mesmo sem `simplifiedAccountRequestId`; propor alertas a 30, 15 e 7 dias.
- [ ] Bloquear troca genérica de CNPJ/titularidade após ativação ou encaminhá-la a nova revisão financeira. Não deixar formulário genérico desalinhar a identidade bancária.
- [ ] Suspensão/desconexão bloqueia novas emissões e preserva conciliação possível de cobranças antigas. Exclusão de credenciais e remoção de webhook não podem ser efeito automático de trocar um perfil.

**Aceite:** cliente manual não é redirecionado para abrir conta para poder cobrar; fluxo automático continua passando nos testes; cron/job atrasado não desfaz a escolha administrativa.

### Etapa 6 — Emissão, split, consultas e webhooks por conta correta

**Criar:** `C:/micro-saas/api-cobranca/src/payment/payment-account-resolver.ts`, `payment-distribution-policy.ts` e testes.

**Alterar:** [serviço de pagamento](C:/micro-saas/api-cobranca/src/payment/payment.service.ts), [cobranças persistidas](C:/micro-saas/api-cobranca/src/payment/payment-charge.service.ts), [integração Efí](C:/micro-saas/api-cobranca/src/payment/efi.service.ts), [webhooks](C:/micro-saas/api-cobranca/src/webhooks/webhooks.service.ts), [guard Efí](C:/micro-saas/api-cobranca/src/webhooks/efi-webhook.guard.ts).

- [ ] Selecionar identidade emissora explicitamente pelo perfil no início de uma nova emissão; persistir o contexto antes da chamada externa. Consultas, cancelamento e devolução usam o contexto da cobrança já emitida.
- [ ] Remover fallback implícito para `EFI_PLATFORM_*` em caminhos de conta própria. Cache OAuth/SDK deve ser separado por identidade, ambiente, aplicação e versão de credenciais.
- [ ] Implementar distribuição em centavos/decimais exatos, usando `PaymentFeeVersion`. Evitar ponto flutuante para valores monetários e definir arredondamento que conserve a soma.
- [ ] Conta cliente: preservar a direção atual da comissão. Plataforma com split: inverter origem/destino corretamente. Plataforma manual: não anexar split para o cliente; registrar a obrigação após recebimento.
- [ ] Tratar comissão zero: os atalhos atuais que deixam de criar split não podem fazer a plataforma reter 100% indevidamente. Se a Efí não aceitar uma composição, bloquear com motivo explícito; não emitir com distribuição diferente da contratada.
- [ ] Para PIX CobV, só publicar QR/link quando vínculo de split obrigatório estiver confirmado. Resultado incerto conserva o mesmo identificador e é conciliado, sem criar outra cobrança.
- [ ] Para BOLIX, testar as duas formas de pagamento e impedir dupla baixa se o mesmo instrumento gerar mais de uma notificação. Conferir comportamento de tarifa/split no produto utilizado.
- [ ] Preservar idempotência, reutilização de cobrança e versões de tarifas existentes. Troca de perfil não altera uma cobrança reutilizada.
- [ ] Webhook resolve cobrança por identificador externo, identidade/ambiente e vínculo persistido. Não confiar no `companyId` da URL nem na conta central para deduzir o cliente.
- [ ] Para notificações de Cobranças que exigem consulta de token, definir contexto de conta autenticado/registrado; quando não houver informação suficiente, manter evento em conciliação. Não testar credenciais de todos os clientes nem atribuir ao primeiro resultado.
- [ ] Preservar autenticação dos webhooks e deduplicar eventos. Eventos desconhecidos/ambíguos ficam armazenados para diagnóstico, sem dar baixa em outra empresa.

**Aceite:** duas empresas na mesma conta central permanecem isoladas; cobrança antiga continua consultável após troca de modo; falha de split impede exposição de cobrança que deveria tê-lo.

### Etapa 7 — Conciliação e repasses automáticos/manuais

**Criar:** módulo em `C:/micro-saas/api-cobranca/src/settlements/` com `settlements.module.ts`, `settlements.controller.ts`, `settlements.service.ts`, `settlement-reconciliation.service.ts`, `payout-batches.service.ts` e specs. Criar integração em `C:/micro-saas/api-cobranca/test/settlements-postgres.cjs`.

- [ ] Transformar pagamento verificado em lançamentos financeiros idempotentes, mantendo o significado atual de fatura/cobrança paga. Para conta própria, não criar obrigação artificial de repasse da plataforma.
- [ ] Registrar valor recebido, tarifa efetiva/pendente, remuneração, devido ao cliente e disponibilidade. Cada evidência deve ter referência e fonte; não substituir extrato/conciliação por uma estimativa.
- [ ] No split, acompanhar a efetivação por evidências do produto: dados de repasse, protocolos/extrato ou conferência administrativa quando a API não fornecer prova suficiente. Não considerar apenas a existência da configuração.
- [ ] Não depender exclusivamente de `GET /v2/gn/split/config/:id`: a documentação consultada informa indisponibilidade temporária dessa consulta. Usar a consulta/evidência adequada à cobrança e validar disponibilidade durante a integração. [Referência Efí](https://dev.efipay.com.br/docs/api-pix/split-de-pagamento-pix/).
- [ ] Criar reserva manual em transação com lock/CAS sobre os saldos selecionados; rejeitar itens de outra empresa, destino, ambiente, modo ou já reservados. Soma calculada somente no servidor.
- [ ] Confirmar lote idempotentemente, com referência bancária não reutilizável no mesmo contexto, valor e favorecido conferidos. Se o comprovante indicar outra conta ou valor, manter divergência e não dar baixa.
- [ ] Proteger comprovantes em armazenamento privado autenticado, com política de tipo/tamanho/retenção, backup e consulta por tenant. Pode-se compartilhar primitivas de armazenamento seguro existentes, mas não colocar arquivos financeiros em rotas públicas ou na autorização de anexos de WhatsApp.
- [ ] Eventos de devolução/estorno geram lançamentos compensatórios. Antes do repasse, reduzem/bloqueiam disponibilidade; depois, geram pendência de recuperação/ajuste por empresa, sem apagar o repasse realizado nem retirar dinheiro automaticamente.
- [ ] Concorrência entre devolução e repasse deve usar a mesma disciplina de lock; diferença após transferência vira divergência conciliável. Saldos negativos não viram lotes positivos por truncamento.
- [ ] Candidato novo de destino não altera lote reservado. Lote iniciado nunca é liberado por simples timeout de navegador.
- [ ] Exibir diferença entre “saldo a conciliar”, “disponível para repasse”, “reservado”, “repassado” e “divergência”. Não apresentar esses números como uma conta bancária do cliente.

**Aceite:** duas requisições concorrentes não reservam o mesmo valor; confirmação duplicada não liquida duas vezes; split não entra em lote manual; devolução preserva trilha e saldo correto.

### Etapa 8 — Painel administrativo e visão da empresa

**Alterar:** [clientes admin](<C:/micro-saas/front-cobranca/src/app/(dashboard)/admin/clientes/page.tsx>), [painel Efí](<C:/micro-saas/front-cobranca/src/app/(dashboard)/admin/efi-onboarding/page.tsx>), [ativação do cliente](<C:/micro-saas/front-cobranca/src/app/(dashboard)/onboarding/efi/page.tsx>), [tipos/eligibilidade frontend](C:/micro-saas/front-cobranca/src/lib/efi-onboarding.ts), [cliente HTTP](C:/micro-saas/front-cobranca/src/lib/api-client.ts).

**Criar:** componentes e testes em `C:/micro-saas/front-cobranca/src/components/features/financial-activation/`; tela administrativa de repasses em `C:/micro-saas/front-cobranca/src/app/(dashboard)/admin/repasses/page.tsx` e visão financeira da empresa em `C:/micro-saas/front-cobranca/src/app/(dashboard)/financeiro/page.tsx`.

- [ ] Assistente com quatro passos: modo de cobrança/repasse → dados e autorização → validação → revisão e ativação.
- [ ] Mostrar campos condicionais. Conta cliente pede chaves/certificado; conta plataforma exibe integração central mascarada e pede destino/tipo de repasse.
- [ ] Diferenciar “Recuperar abertura existente” do novo “Ativar financeiro manualmente”. A ação deve existir na lista de empresas sem depender de haver `EfiOnboarding`.
- [ ] Exibir verificações pendentes/falhas individualmente e orientar correção. Tratar 409 de revisão sem perder dados não sensíveis nem confirmar estado antigo.
- [ ] Limpar segredos da memória/formulário após envio e fechamento. Reabrir a tela mostra apenas “credencial cadastrada”, fingerprint e validade; nunca segredo recuperado do servidor.
- [ ] Mostrar conta emissora, destino, tarifas, métodos, modo de repasse e impacto sobre a régua na confirmação.
- [ ] Oferecer histórico de ativações, trocas, autorizações e responsáveis. Consulta de auditoria deve ter redação de dados pessoais/segredos.
- [ ] Em repasses, apresentar elegíveis, reserva, início, confirmação, comprovante e divergência com ações permitidas pelo servidor. O texto do botão manual deve dizer “Registrar repasse realizado”, sem sugerir transferência automática.
- [ ] Cliente visualiza seu modo atual, situação e seus recebimentos/repasses; não pode alterar conta, credenciais, tarifa, destino ou comprovante administrativo.
- [ ] Respostas de pagamento/mensagens devem identificar corretamente empresa credora e recebedor bancário da operação. Não prometer que o banco exibirá o nome do cliente quando a conta emissora for da CifraMais.

**Aceite:** testes de interface cobrem as três configurações, carregamento/erro/conflito, empresa sem onboarding, acesso negado e histórico sem dados de outros clientes.

### Etapa 9 — Testes integrados, operação e publicação manual

**Criar:** runbook `C:/micro-saas/docs/operations/financial-activation.md`. **Revisar:** [infra da VPS](C:/micro-saas/infra/interserver/README.md), empacotamento, limites de upload e documentação de backup/rotação.

- [ ] Validar a matriz abaixo com PostgreSQL/Redis descartáveis e SDK/provedor simulados. Não carregar o banco de produção como banco de testes.
- [ ] Testar abertura automática existente, tarifas, billing e mensagens, pois seus gates financeiros mudaram. Não modificar o transporte Datafy por conveniência desta entrega.
- [ ] Rodar ensaio de migração/backfill e restauração em cópia sanitizada. Medir registros resolvidos, ambíguos e falhas; a rotina não deve “corrigir” ambiguidades por aproximação.
- [ ] Fazer testes externos em homologação com contas/recursos de teste disponíveis, registrando lacunas da simulação. Não chamar homologação de prova de repasse real em produção.
- [ ] Publicar código e migrations aditivas com o novo modo inicialmente desabilitado. Primeiro atualizar backend compatível, depois frontend; confirmar versões da API/imagem.
- [ ] Garantir que arquivos novos estão versionados/incluídos: o empacotador atual usa `git ls-files`, portanto arquivos locais não rastreados podem ficar fora do pacote.
- [ ] Antes da primeira operação real, verificar capacidades/condições da conta central, autorizações do cliente, destino, política de tarifas, backup e possibilidade de conciliação. Execução real é etapa operacional separada deste plano documental.
- [ ] Liberar uma empresa piloto por configuração e acompanhar emissão, recebimento e repasse antes de ampliar. Acompanhar falhas por identidade central e por empresa, sem registrar segredos.
- [ ] Rollback operacional: bloquear novas ativações/emissões afetadas e preservar webhooks, conciliação e histórico. Não desfazer migrations nem devolver ao código antigo incapaz de ler cobranças novas; preferir correção compatível.

**Aceite:** outro desenvolvedor/operador consegue ativar, renovar certificado, diagnosticar falha, conciliar repasse e suspender emissão seguindo o runbook, sem depender da memória da conversa.

## 6. Matriz mínima de testes de aceite

| Cenário | Resultado obrigatório |
| --- | --- |
| Cada uma das três configurações válidas | Ativa e emite com a conta/distribuição esperadas, sem API de abertura. |
| Empresa sem registro de onboarding | Administrador encontra e ativa pelo novo fluxo. |
| Abertura desabilitada/sem suas credenciais | API sobe com pagamentos configurados; manual funciona; abertura é bloqueada claramente. |
| Pagamentos globais pausados | Nenhum modo emite; consulta e conciliação continuam. |
| CNPJ/titular não comprovado | Ativação recusada; OAuth 200 não a libera. |
| Certificado inválido, expirado, senha errada ou ambiente errado | Falha segura e motivo utilizável, sem segredo em resposta/log. |
| Métodos/permissões insuficientes | Método afetado não é liberado silenciosamente. |
| Edição após validação / validação antiga | Confirmação retorna conflito e pede nova validação. |
| Ativação concorrente / falha ao gravar auditoria | Uma publicação ou rollback integral; nunca estado parcial. |
| Redis cai após persistir tentativa | Recuperador retoma com IDs originais; sem operação externa duplicada. |
| Webhook/job de abertura atrasado | Não sobrescreve perfil manual nem recria abertura. |
| Mudança cliente → plataforma ou split → manual | Novas cobranças usam novo modo; antigas conservam conta e repasse. |
| Renovação do certificado da mesma conta | Cobranças antigas continuam consultáveis com credencial válida dessa identidade. |
| Falta de credencial de cliente | Nenhum fallback para conta CifraMais. |
| Comissão zero / centavos / limite de tarifa | Destino e soma corretos, ou bloqueio explícito de composição não suportada. |
| Split obrigatório com resposta incerta | QR/link não é exposto como pronto; não há nova emissão duplicada. |
| BOLIX pago por cada alternativa | Baixa e distribuição corretas, sem duplicidade. |
| Duas empresas na conta central e mesmo devedor | Eventos, obrigações e telas ficam no tenant correto. |
| Webhook duplicado, fora de ordem ou companyId adulterado | Sem baixa indevida, duplicação de saldo ou vazamento. |
| Cobrança paga mas repasse não comprovado | Mostra pago e repasse pendente; não falsifica liquidação. |
| Dois administradores reservam o mesmo saldo | Somente uma reserva é aceita. |
| Confirmação manual repetida / referência reutilizada | Uma liquidação; divergência/conflito quando aplicável. |
| Timeout após transferência possivelmente feita | Reserva mantida até conciliar; não permite pagar novamente. |
| Split selecionado para lote manual | Rejeição, inclusive por chamada direta à API. |
| Troca de destino com lote em andamento | Lote mantém favorecido original. |
| Devolução antes/depois do repasse | Ajuste compensatório correto e histórico intacto. |
| Usuário A consulta saldo/comprovante de B | 403/404; arquivo privado não é lido/servido. |
| Banco restaurado com chaves/arquivos de backup | Segredos e comprovantes recuperáveis; estados e conciliação coerentes. |

### Comandos planejados de verificação

Executar durante a implementação, depois que os arquivos de teste propostos existirem. Esta entrega documental não executou esses testes nem criou os scripts citados abaixo.

```powershell
Set-Location C:/micro-saas/api-cobranca
npm run prisma:generate
npm test -- --runInBand --testPathPatterns='financial-activation|settlements|payment|efi-onboarding|billing'
node test/financial-activation-postgres.cjs
node test/settlements-postgres.cjs
npm test -- --runInBand
npx eslint src
npm run build

Set-Location C:/micro-saas/front-cobranca
npx jest --runInBand
npm run lint
npm run build
```

Resultado esperado: testes focados e de regressão aprovados, migrations aplicáveis em banco descartável, lint/build concluídos e nenhuma requisição bancária real nos testes automatizados. Logs de execução devem identificar commit/estado do checkout e limitações encontradas, sem copiar `.env`.

## 7. Sequência, dependências e revisão final

Ordem recomendada: contratos → persistência → credenciais → validação/ativação → compatibilidade com abertura → emissão/webhooks → repasses → telas → publicação. A interface pode ser preparada com contratos estáveis, mas não deve liberar o fluxo antes de concluir os invariantes do backend.

É uma alteração de **complexidade alta** quando contempla conta central, dois tipos de repasse, histórico e troca de modo. A tela de ativação é uma parte menor; o trabalho principal está em selecionar corretamente a conta e preservar a conciliação do dinheiro. Não estimar como mera inclusão de campos `.env` ou um botão que muda status.

Antes de considerar a demanda concluída, revisar especialmente:

- Nenhum caminho manual depende de permissão de abertura de conta, direta ou indiretamente.
- Conta própria, plataforma com split e plataforma com repasse manual são implementados e testados, sem omitir uma das escolhas confirmadas.
- Toda emissão nova tem origem/destino/modo rastreáveis e toda operação posterior usa esse contexto.
- Valores pagos, disponíveis, reservados, repassados e devolvidos têm fontes e transições verificáveis.
- Trocas de modo, expiração/rotação de certificado, callbacks atrasados e concorrência não movimentam/registram dinheiro duas vezes.
- O pacote publicado contém os arquivos novos e o runbook explica as dependências externas ainda não validadas.

O trabalho estará completo quando um administrador conseguir ativar uma empresa em qualquer uma das três configurações, operar PIX/BOLIX nos caminhos habilitados, acompanhar recebimento e repasse e mudar a configuração para futuras cobranças preservando todo o histórico anterior.

## 8. Decisões do responsável (25/09/2026)

Complementam as seções anteriores e prevalecem sobre elas quando houver conflito.

### 8.1 Situação atual

- Os clientes em negociação usarão **conta própria na Efí** e entregarão certificado e credenciais. Nenhum cliente real foi cadastrado.
- O banco de produção contém somente dados de teste; nada precisa ser preservado além do login do administrador. O backfill da Etapa 2 se reduz a um relatório de verificação.
- A conta Efí da CifraMais está liberada para split e webhooks. A validação real depende apenas de testes em homologação.
- Cada etapa é revisada e aprovada pelo responsável antes do início da seguinte.

### 8.2 Modo conta CifraMais

- Pix CobV e BOLIX são emitidos em nome da CifraMais, amparados por **procuração** do cliente. A procuração é a autorização registrada nesse modo: tipo, referência/documento, vigência e responsável pela conferência.
- O split só alcança contas Efí; no modo split o cliente precisa ter conta Efí.
- Destino do repasse manual: **qualquer banco**, por chave Pix ou agência/conta, com titularidade conferida contra o documento do cliente e evidência registrada. Cada alteração cria nova versão de `FinancialRecipientVersion`. Dados de `OriginalBankAccount` servem apenas como sugestão de preenchimento, nunca como destino verificado.
- Repasse manual somente após **conciliação pelo administrador**; não há prazo automático D+N.

### 8.3 Tarifas e remuneração

- Tarifas continuam configuráveis por cliente em `PaymentFeeVersion` (padrão global com exceção por empresa, versionadas e fotografadas na cobrança).
- A **tarifa Efí é suportada pelo cliente** em todos os modos. No split pela plataforma, a parcela da CifraMais cobre a tarifa Efí debitada da conta emissora.
- A **remuneração CifraMais incide sobre o valor efetivamente pago**, incluindo multa e juros. Na emissão grava-se a estimativa sobre o valor original; na confirmação do pagamento, `effectivePlatformFeeCents`/`effectiveEfiFeeCents`. Repasses usam sempre o valor efetivo.
- No split, a composição é percentual sempre que possível. Quando houver parcela fixa, a diferença causada por multa/juros vira **ajuste na conciliação**, nunca retenção silenciosa.
- `Company.onTimeSplitPercentageBps` e `Company.overdueSplitPercentageBps` não são usados pela emissão e serão removidos (schema, DTO administrativo e tela).

### 8.4 Multa, juros e prazo após vencimento

- Configuração opcional por cobrança: multa (nenhuma, percentual ou fixa), juros (nenhum ou percentual ao mês) e dias aceitando pagamento após o vencimento.
- O padrão da empresa é definido pelo próprio cliente em **Configurações → Cobrança** e começa como “sem multa e sem juros”. O formulário de nova cobrança vem preenchido com esse padrão e pode ser alterado por cobrança; nenhum campo é obrigatório.
- Recorrências guardam a configuração e a copiam para cada fatura gerada. Importação CSV e API/ERP aceitam campos opcionais; campo vazio usa o padrão da empresa e zero explícito significa sem multa/juros.
- Os valores ficam na `Invoice` e são fotografados na `PaymentCharge` na emissão. Alteração após emissão exige substituição da cobrança.
- Mapeamento: Pix CobV `valor.multa`/`valor.juros` e `calendario.validadeAposVencimento`; boleto/BOLIX `configurations.fine`/`configurations.interest` com a mesma política. Hoje `efi.service.ts` envia `validadeAposVencimento: 0`, o que impede o pagamento do Pix após o vencimento. Os campos e limites devem ser conferidos na documentação Efí na Etapa 1, e o comportamento do Pix do BOLIX após o vencimento deve ser testado em homologação.
- O painel alerta multa acima de 2% para devedor pessoa física (limite do CDC).

### 8.5 Pagamento com valor diferente, duplicidade e devolução

- Pagamento parcial não é fluxo normal. Valor recebido diferente do esperado deixa a cobrança **paga com divergência**, bloqueia o repasse e o administrador decide: aceitar como quitação, ou aceitar e emitir cobrança complementar pelo saldo na mesma fatura.
- Pagamento em duplicidade (boleto e Pix do mesmo BOLIX, ou dois pagamentos) vira **crédito a devolver**, fora de qualquer repasse até o administrador devolver ou manter como crédito.
- Pix: devolução pela API Efí, total ou parcial, soma limitada ao valor pago e prazo de até 90 dias. Devoluções MED seguem a mesma regra, com origem marcada.
- Boleto: devolução fora do sistema, registrada com comprovante.
- Nos modos CifraMais, somente `PLATFORM_ADMIN` devolve. No modo conta do cliente o sistema apenas registra as devoluções notificadas pela Efí.
- A tarifa Efí não é estornada. A remuneração CifraMais não é estornada por padrão, com opção por cliente “estornar remuneração em devolução”.
- Devolução antes do repasse reduz o valor a repassar; depois do repasse gera saldo devedor do cliente, compensado em repasses seguintes, sem débito automático.

### 8.6 Fases de entrega

- **Fase A — conta própria do cliente**, completa e publicável: tipos, schema com os três modos previstos, credenciais/certificado, validação, ativação sem API de abertura, elegibilidade, emissão e webhooks pela conta correta, multa/juros e telas administrativas e da empresa para esse modo.
- **Fase B — conta CifraMais**: emissão pela plataforma, procuração, destinos em qualquer banco, split invertido, conciliação, lotes de repasse e devoluções.
- As etapas da seção 5 são executadas na Fase A somente no que se aplica à conta do cliente; a Fase B retoma as partes restantes. A Fase B apenas acrescenta, sem refazer o que a Fase A entregou.
