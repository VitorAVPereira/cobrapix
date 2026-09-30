# Runbook: ativação financeira, emissão e conciliação (Fase A)

Para quem opera a CifraMais. Cobre o modo **conta Efí do próprio cliente**: o cliente cria a conta na Efí e entrega certificado e tokens; os pagamentos caem direto na conta dele; a remuneração da CifraMais chega por split. Os modos de conta CifraMais (split invertido e repasse manual) são a Fase B e ficam bloqueados na ativação e na emissão.

Todos os comandos rodam na VPS a partir da pasta extraída do pacote (ver `infra/interserver/README.md`). Nunca copie segredos para tickets, chats ou logs.

## 1. Pré-requisitos

### 1.1 Variáveis em `/opt/ciframais/secrets/api.env`

| Variável | Uso | Obrigatória |
| --- | --- | --- |
| `EFI_OPENING_ENABLED=false` | API de abertura de contas desligada até a Efí liberar. Com `false`, `EFI_OPENING_*` podem ficar vazias. | sim |
| `EFI_PLATFORM_PAYEE_CODE`, `EFI_PLATFORM_ACCOUNT_NUMBER`, `EFI_PLATFORM_CNPJ` | Conta da CifraMais que recebe a remuneração por split (Pix usa conta + CNPJ; BOLIX usa `payee_code`). | sim, em produção |
| `EFI_WEBHOOK_BASE_URL` | Domínio mTLS (`efi.`) para o webhook Pix, configurado na conta do cliente durante a validação. | sim, em produção |
| `EFI_CHARGES_WEBHOOK_BASE_URL` | Domínio da API para o webhook de Cobranças (boleto/BOLIX). | sim, em produção |
| `EFI_WEBHOOK_SECRET` | Token dos webhooks (gerado pelo `setup.sh`). | sim |
| `PAYMENT_ENCRYPTION_KEYS`, `PAYMENT_ACTIVE_KEY_VERSION` | Cifram credenciais e certificados dos clientes no banco. | sim |
| `PLATFORM_ALERT_EMAIL` | Alertas de certificado dos clientes (30/15/7 dias e vencimento). Sem ela, os alertas falham e são tentados de novo no dia seguinte. | recomendada |
| `EFI_PLATFORM_CLIENT_ID/SECRET/CERT_PATH` | Só para a Fase B. Podem ficar vazias. | não |

Uma instalação anterior a esta versão precisa editar o `api.env` à mão: `setup.sh` não sobrescreve o arquivo. Ajuste `EFI_OPENING_ENABLED=false`, confira as variáveis da tabela e acrescente `PLATFORM_ALERT_EMAIL`. O arquivo modelo é `infra/interserver/api.env.example`.

### 1.2 Chaves no painel

No painel, em **Admin → Ativações e saúde**:

- **Novas emissões** (`EFI_PAYMENTS`): pausa ou libera toda emissão nova. Consulta, webhooks e conciliação continuam funcionando com a chave pausada.
- **Ativação financeira manual**: libera validar e ativar pela tela de ativação. Pausada, a tela avisa e bloqueia essas ações.
- **Abertura de contas**: deixar pausada. Com `EFI_OPENING_ENABLED=false`, a API recusa liberar.

### 1.3 Tarifas

Em **Admin → Tarifas** precisa existir uma versão vigente de tarifa, global ou do cliente, para cada meio que o cliente vai usar (Pix e BOLIX). Sem ela, a validação falha em `FEE_VERSIONS`.

## 2. Publicar uma nova versão

1. No Windows, rode `infra/interserver/package.ps1`. O pacote usa `git ls-files` e **recusa** gerar o pacote com arquivo do backend fora de commit.
2. Na VPS, extraia o pacote e rode o build, as migrations e a subida da API:

   ```bash
   sudo bash infra/interserver/compose.sh build api
   sudo bash infra/interserver/compose.sh run --rm --no-deps api npm run prisma:deploy
   sudo bash infra/interserver/compose.sh run --rm --no-deps api npx prisma migrate status --schema=prisma/schema.prisma
   sudo bash infra/interserver/compose.sh up -d --wait --wait-timeout 180 api
   ```

   As migrations só acrescentam estruturas. Não use `migrate dev`, `db push` nem `down -v`.
3. Confira `/health` e a tela **Ativações e saúde**.
4. Só então publique o frontend. O backend novo é compatível com o frontend anterior; o contrário não vale.
5. Relatório de verificação dos perfis financeiros, somente leitura, sem segredos:

   ```bash
   sudo bash infra/interserver/compose.sh run --rm --no-deps api node dist/scripts/report-financial-profiles.js
   ```

## 3. Ativar um cliente (conta própria na Efí)

O que pedir ao cliente:

- conta Efí em nome do CNPJ da empresa;
- Client ID e Client Secret de uma aplicação com os escopos Pix e Cobranças, no ambiente certo (homologação ou produção);
- certificado `.p12` do mesmo ambiente e a senha, se houver;
- chave Pix da conta;
- número da conta, dígito e `payee_code` (identificador de conta no painel Efí);
- contrato ou autorização assinada que permite à CifraMais operar a integração.

Na tela **Admin → Ativação financeira → [cliente]** (também pela lista de clientes):

1. **Iniciar:** escolha "Conta Efí do cliente", o ambiente e os meios de pagamento.
2. **Credenciais:**
   - O titular é sempre o CNPJ da empresa.
   - Preencha conta, dígito, `payee_code`, chave Pix, Client ID e Client Secret, anexe o `.p12` e informe a senha.
   - Os segredos e o arquivo são apagados da tela após o envio.
   - Ao reabrir, a tela mostra só a versão, a conta mascarada, a impressão digital e a validade do certificado.
3. **Autorização e titularidade:** referência do contrato, validade (opcional), confirmação de que a conta é da empresa e referência da evidência (por exemplo, print do painel Efí com o CNPJ titular).
4. **Validar:**
   - A tela lista antes os efeitos na conta do cliente: configura o webhook Pix para a chave e cria um split de validação para a CifraMais.
   - A validação roda em segundo plano, com novas tentativas automáticas.
   - O resultado vale 15 minutos para a ativação.
5. **Ativar:**
   - Confirme os efeitos: a régua de cobrança e a primeira cobrança automática passam a emitir.
   - Confirme a ciência dos passos "não comprováveis sem emitir": emissão e split do BOLIX.
   - A ativação publica o perfil numa única transação. Alterar a configuração depois da validação exige validar de novo.

Depois da ativação, emita uma cobrança de valor baixo e acompanhe a seção 5.

Se o cliente tinha uma **abertura automática em andamento**, encerre-a antes em **Admin → Ativações e saúde → Detalhes → Encerrar abertura para ativação manual**. Informe o resultado conferido na Efí e a referência da evidência. Nada é enviado à Efí.

## 4. Renovar certificado, trocar credenciais ou trocar de conta

- **Mesma conta, certificado ou tokens novos:** faça uma nova preparação na mesma tela, enviando as credenciais novas da mesma conta, e valide e ative.
  - A identidade da conta é mantida e a credencial anterior é aposentada na ativação.
  - Cobranças já emitidas passam a usar a credencial nova da mesma conta.
- **Outra conta Efí:** mesma sequência, com a nova conta.
  - As cobranças novas saem da nova conta.
  - As antigas continuam consultáveis, canceláveis e conciliáveis **na conta que as emitiu**, enquanto aquela credencial estiver ativa. Não revogue a aplicação antiga na Efí antes de liquidar ou cancelar as cobranças em aberto.
- **Alertas:** chegam por e-mail em `PLATFORM_ALERT_EMAIL` a 30, 15 e 7 dias do vencimento do certificado e no vencimento (cron diário às 07:40). Um certificado vencido bloqueia a emissão (`EFI_CERTIFICATE_EXPIRED`).
- **Checagem de saúde:** roda a cada 6 horas. Duas falhas seguidas deixam a conta `UNAVAILABLE` e bloqueiam novas emissões até a próxima checagem bem-sucedida. Para forçar, use **Validar integração agora** no painel **Operação** da tela de ativação do cliente.

## 5. Diagnóstico

### 5.1 Validação da ativação

A tela mostra cada passo com o código do erro. Códigos `EFI_REJECTED_<NOME>` repetem o nome do erro devolvido pela Efí. `EFI_UNAVAILABLE` é falha temporária e tem novas tentativas automáticas.

| Passo / código | Causa provável | O que fazer |
| --- | --- | --- |
| `CERTIFICATE` / `CERTIFICATE_EXPIRED`, `CREDENTIALS_UNREADABLE` | Certificado vencido, senha errada ou `.p12` de outro ambiente | Pedir novo `.p12` do ambiente certo e reenviar as credenciais |
| `FEE_VERSIONS` / `FEE_CONFIGURATION_MISSING` | Sem tarifa vigente para um meio | Criar a versão em Admin → Tarifas |
| `PLATFORM_RECIPIENT` / `PLATFORM_RECIPIENT_INVALID` | `EFI_PLATFORM_*` ausentes, ou conta da CifraMais igual à do cliente | Corrigir o `api.env` e reiniciar a API |
| `PIX_AUTH`, `CHARGES_AUTH` / `EFI_REJECTED_*` | Client ID/Secret errados, escopos faltando ou ambiente trocado | Conferir a aplicação no painel Efí do cliente |
| `PIX_WEBHOOK` / `PIX_KEY_MISSING` | Chave Pix não informada | Reenviar as credenciais com a chave |
| `PIX_WEBHOOK` / `EFI_REJECTED_*` | Chave Pix não pertence à conta, ou o domínio mTLS foi recusado | Conferir a chave no painel Efí e o domínio de `EFI_WEBHOOK_BASE_URL` (`infra/efi`) |
| `PIX_WEBHOOK` / `PIX_WEBHOOK_MISMATCH` | Depois de configurado, a Efí devolveu outra URL de webhook para a chave | Conferir na Efí o webhook da chave; outra integração pode estar sobrescrevendo |
| `CHARGES_WEBHOOK_URL` / `CHARGES_WEBHOOK_URL_INVALID` | `EFI_CHARGES_WEBHOOK_BASE_URL` inválida ou sem HTTPS | Corrigir o `api.env` |
| `PIX_SPLIT` / `EFI_REJECTED_*` | Conta sem permissão de split | Pedir à Efí a liberação do split |
| `REVISION_CONFLICT`, `PROFILE_CHANGED` | Dados alterados por outra sessão | Recarregar a tela e validar de novo |
| `MANUAL_ACTIVATION_PAUSED` | Chave "Ativação financeira manual" pausada | Liberar em Ativações e saúde |

### 5.2 Emissão

| Código | Significado |
| --- | --- |
| `FINANCIAL_PROFILE_NOT_READY` | Cliente sem ativação ativa |
| `PAYMENT_METHOD_NOT_ENABLED` | Meio não habilitado na ativação |
| `EFI_PAYMENTS_PAUSED` | Chave "Novas emissões" pausada |
| `EFI_INTEGRATION_UNHEALTHY` | Duas checagens de saúde seguidas falharam (seção 4) |
| `EFI_CREDENTIALS_UNAVAILABLE`, `EFI_CERTIFICATE_EXPIRED` | Renovar credenciais (seção 4) |
| `FINANCIAL_PROFILE_CHANGED` | A ativação mudou durante a emissão; basta tentar de novo |
| `EFI_ISSUANCE_REJECTED` (422 ou 503) | A Efí **recusou** a criação: nada foi criado e a tentativa fica `FAILED`. `reasonCode` diz o tipo (`EFI_VALIDATION_REJECTED` = dado recusado, com o campo em `field`; `EFI_AUTH_REJECTED` = credencial/permissão). Corrigir o dado e emitir de novo pelo fluxo normal |
| `ISSUANCE_PRECONDITION_FAILED` e outros erros antes do envio | A emissão parou antes de chamar a Efí (configuração local, CPF/CNPJ, recebedor do split). A tentativa fica `FAILED` com o motivo; corrigir e emitir de novo |
| `EFI_SUBMISSION_UNCERTAIN` | A Efí pode ter criado a cobrança (timeout, conexão perdida, erro 5xx, resposta incompleta ou falha local depois do aceite). **Não reenviar**. A tentativa fica `PENDING`, com o diagnóstico, e aparece após 10 minutos em **Operação → Emissões para conciliar** (seção 5.4) |
| `EFI_BILLING_MODE_MISMATCH` | A Efí devolveu boleto sem Pix (ou o inverso). Revisar a modalidade da conta no painel Efí; a cobrança fica preservada para conciliação e seus instrumentos não são distribuídos |
| `FINANCIAL_MODE_NOT_SUPPORTED` | Modo de conta CifraMais (Fase B) |

Nenhum desses casos tem nova tentativa automática. O log da API registra só
`Emissão Efí <REJECTED|UNCERTAIN> <código> etapa=<etapa> provider=<código Efí> campo=<caminho>`,
sem valores, payload, certificado ou dados do pagador.

Dados do pagador no Bolix/boleto: `phone_number` vai no formato da Efí (DDD +
número, sem o 55; o cadastro guarda `+55…` para o WhatsApp). Telefone
estrangeiro ou inválido, e-mail vazio e endereço incompleto são omitidos, pois
são opcionais na Efí; nome e CPF/CNPJ continuam obrigatórios.

### 5.3 Webhooks

- **Pix** chega pelo domínio mTLS e só dá baixa se a chave recebedora for a da conta que emitiu a cobrança.
- **Cobranças** (boleto/BOLIX) chegam com `account=<identidade>` na URL. A notificação é consultada com as credenciais dessa conta e só encontra cobranças emitidas por ela.
- Eventos que não puderam ser aplicados ficam em `PaymentWebhookAnomaly`: motivo, referência e contador, sem o conteúdo do aviso. Consulta somente leitura:

  ```bash
  sudo bash infra/interserver/compose.sh exec -T postgres psql -U postgres -d ciframais -c \
    'SELECT source, "reasonCode", "externalReference", occurrences, "lastSeenAt" FROM "PaymentWebhookAnomaly" ORDER BY "lastSeenAt" DESC LIMIT 50;'
  ```

  | Motivo | Leitura |
  | --- | --- |
  | `UNKNOWN_TXID` | Pix com txid que não é de uma cobrança nossa. Esperado quando o QR do BOLIX é pago (a baixa vem pelo webhook de Cobranças); a confirmar em homologação. |
  | `RECEIVER_MISMATCH` | Pix recebido por outra chave. Investigar: nada foi baixado. |
  | `UNKNOWN_ACCOUNT` | URL de notificação com conta desconhecida (possível URL antiga ou forjada). |
  | `UNKNOWN_CHARGE` | Cobrança que não pertence à conta da URL. |

- Notificações repetidas não geram nada novo: a baixa e os lançamentos são idempotentes.

### 5.4 Emissões para conciliar (Operação, na tela do cliente)

Emitir, pagar e receber o split são eventos diferentes. Esta lista trata só da
**emissão**: `PaymentCharge.PENDING` é uma tentativa ainda não confirmada
localmente, não uma fatura aguardando pagamento. O recebimento do split é
conferido na seção 6.

| Rótulo | Situação | Ação |
| --- | --- | --- |
| Emissão rejeitada | A Efí recusou (ou a emissão parou antes do envio). Mostrada por 30 dias | Corrigir o motivo e emitir a fatura de novo |
| Confirmação da emissão pendente | Há referência da Efí (`txid`/`charge_id`) mas a confirmação local não terminou | "Conciliar com a Efí" |
| Referência da Efí necessária | Bolix/boleto sem `charge_id` gravado (resposta perdida ou emissão antiga) | "Conciliar com a Efí": procura a cobrança pelo `custom_id` (o id da tentativa) na conta emissora original |
| Modalidade diferente da solicitada | Boleto sem Pix quando foi pedido Bolix | Revisar a chave Pix da conta; os instrumentos não são distribuídos |

A conciliação consulta a Efí com a conta e as credenciais da identidade que
emitiu a cobrança, mesmo que o cliente tenha trocado de conta depois. Ela nunca
chama a criação. Resultados:

1. **Encontrada, pagável e compatível** (mesmo `custom_id`, valor e modalidade,
   com linha digitável e link): tentativa `ACTIVE`, fatura com os instrumentos,
   tudo na mesma transação (`ISSUANCE_RECOVERED`). Isso não comprova o split.
2. **Paga / cancelada / vencida na Efí:** aplica a mesma rotina idempotente dos
   webhooks. Uma cobrança já paga nunca volta para ativa ou pendente.
3. **Não existe na Efí** (`PROVIDER_NOT_FOUND`): só é aceito para uma tentativa
   aberta com mais de 30 minutos, sem referência gravada, e quando a Efí
   responde à consulta (listagem por `custom_id` para Bolix/boleto; "cobrança não
   encontrada" para o txid do Pix). A reserva vira `FAILED` e a fatura pode ser
   emitida de novo. Uma consulta que falhou nunca é lida como ausência.
4. **Revisão necessária** (não é sucesso): valor, `custom_id` ou modalidade
   divergentes, duas cobranças com o mesmo `custom_id`, situação desconhecida,
   Pix ativo cujo vínculo de split não aparece na consulta, ou tentativa recente
   demais. Conferir no painel da conta emissora e, se preciso, acionar a Efí.

Cada consulta fica registrada (autor e horário em `AuditLog`; motivo em
`PaymentChargeStatusHistory.sanitizedDetails`), sem payload da Efí. Não há botão
genérico de "tentar novamente": uma tentativa incerta sem prova do resultado
permanece bloqueada até a Efí comprovar a situação.

### 5.5 Diagnóstico somente leitura de uma emissão

Para investigar uma emissão sem expor dados de clientes. Registrar o resultado
em um registro operacional protegido; não commitar exportações de produção.

1. Anotar o fuso da tela (o painel mostra horário de Brasília) e converter para
   UTC antes de procurar nos logs.
2. Tentativas da fatura (substituir o prefixo):

   ```bash
   sudo bash infra/interserver/compose.sh exec -T postgres psql -U postgres -d ciframais -c \
     "SELECT id, \"companyId\", \"invoiceId\", \"billingMethod\", status, \"gatewayStatusRaw\", \"grossAmountCents\", \"issuerIdentityId\", \"issuerCredentialVersionId\", \"financialEnvironment\", (\"efiChargeId\" IS NOT NULL) AS tem_charge_id, (\"efiTxid\" IS NOT NULL) AS tem_txid, (\"createdAt\" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo' AS criada_brt FROM \"PaymentCharge\" WHERE \"invoiceId\" LIKE 'dfcfed91%';"
   ```

3. Histórico da tentativa (diagnóstico sanitizado; registros antigos não têm o
   motivo original):

   ```bash
   sudo bash infra/interserver/compose.sh exec -T postgres psql -U postgres -d ciframais -c \
     "SELECT h.\"previousStatus\", h.status, h.\"providerStatus\", h.\"sanitizedDetails\", h.\"occurredAt\" FROM \"PaymentChargeStatusHistory\" h JOIN \"PaymentCharge\" c ON c.id = h.\"paymentChargeId\" WHERE c.\"invoiceId\" LIKE 'dfcfed91%' ORDER BY h.\"occurredAt\";"
   ```

4. Formato dos dados opcionais do pagador, sem exibi-los:

   ```bash
   sudo bash infra/interserver/compose.sh exec -T postgres psql -U postgres -d ciframais -c \
     "SELECT i.id, length(regexp_replace(d.\"phoneNumber\", '\\D', '', 'g')) AS digitos_telefone, left(regexp_replace(d.\"phoneNumber\", '\\D', '', 'g'), 2) AS prefixo, coalesce(btrim(d.email), '') <> '' AS tem_email FROM \"Invoice\" i JOIN \"Debtor\" d ON d.id = i.\"debtorId\" WHERE i.id LIKE 'dfcfed91%';"
   ```

5. Logs da API no intervalo (UTC). Versões anteriores a esta correção só
   registravam `Falha ambígua da Efí ao criar boleto`, sem o motivo:

   ```bash
   sudo bash infra/interserver/compose.sh logs --since 2026-09-29T18:00:00Z --until 2026-09-29T18:30:00Z api | grep -E "Emissão Efí|Falha ambígua|Erro Efi"
   ```

6. Consultar a Efí pela conta emissora: "Conciliar com a Efí" (seção 5.4). Sem
   referência, a própria conciliação procura pelo `custom_id`. A ausência visual
   no painel da Efí, sozinha, não comprova que a requisição foi recusada.
7. Classificar: rejeição comprovada; emissão existente recuperável; divergência
   de modalidade; ou resultado ainda incerto. Separar fatos de hipóteses e não
   emitir de novo para testar uma hipótese.

## 6. Conciliação (Admin → Conciliação)

Na conta própria o dinheiro não passa pela CifraMais. A conciliação confere a remuneração recebida por split e decide as divergências.

1. **Comprovar a remuneração:**
   - filtre "Aguardando comprovação" e selecione as cobranças cujo split aparece no extrato da conta CifraMais;
   - informe a referência do extrato e o valor recebido.
   
   O servidor recalcula o esperado:
   - se bater, as cobranças ficam **conciliadas**;
   - se não bater, ficam **divergentes** para decisão;
   - uma referência não pode ser reutilizada.
2. **Decidir divergências** (em Detalhes). Cada tipo aceita decisões próprias e exige referência ou motivo:
   - **Pago abaixo:** aceitar como quitação, ou gerar **fatura complementar** do saldo. A fatura nova, ligada à original, fica em rascunho e é emitida pelo fluxo normal.
   - **Pago acima do esperado:** aceitar, ou registrar a devolução feita pelo cliente.
   - **Duplicidade** (crédito a devolver): registrar a devolução feita pelo cliente, ou manter como crédito.
   - **Comprovação com valor diferente, ou remuneração alterada depois da comprovação:** aceitar a diferença, ou registrar o acerto.
   - **Estorno de remuneração devido:** registrar o estorno pago ao cliente, ou dispensar.
3. **Opção "Estornar remuneração em devolução"** (com o cliente filtrado): desligada por padrão. Ligada, cada devolução gera o estorno proporcional como valor devido ao cliente.
4. **Visão do cliente:** o cliente vê seus recebimentos em **Financeiro**, sem as comprovações nem as decisões.

Os lançamentos financeiros nunca são editados. Correções entram como novos lançamentos, e toda decisão fica na auditoria (histórico na tela de ativação do cliente).

## 7. Suspender emissão e rollback operacional

- **Problema geral:** pause **Novas emissões**. Nada novo é emitido; webhooks, consultas, cancelamentos e conciliação continuam.
- **Um cliente:** pause a ativação manual se o problema for de ativação. Para a emissão de um cliente só, pause a chave global ou troque as credenciais (seção 4), porque uma credencial aposentada bloqueia a emissão daquela conta.
- **Não** desfaça migrations nem volte para uma imagem anterior à etapa 6: ela não sabe ler o contexto das cobranças novas. Prefira corrigir e publicar de novo, compatível.
- Cobranças emitidas continuam presas à conta que as emitiu. Trocar a ativação não move cobranças antigas.

## 8. Backup, restauração e rotação de chaves

- **Backup:** `sudo bash infra/interserver/backup.sh` (dump, anexos e SHA256).
  - As credenciais e os certificados dos clientes ficam **no banco, cifrados** com `PAYMENT_ENCRYPTION_KEYS`.
  - Guarde uma cópia protegida do `api.env` com o backup. Sem ela, nenhuma credencial é recuperável.
- **Restauração:** restaure banco, anexos e `api.env` do mesmo momento. Em seguida:
  - rode o relatório da seção 2;
  - use **Validar integração agora** (painel Operação) para cada cliente ativo antes de liberar as emissões.
- **Rotação de chaves:**
  1. Acrescente a nova versão em `PAYMENT_ENCRYPTION_KEYS` e aponte `PAYMENT_ACTIVE_KEY_VERSION` para ela, mantendo as antigas.
  2. Reinicie a API.
  3. Rode a rotação, primeiro sem aplicar e depois aplicando:

     ```bash
     sudo bash infra/interserver/compose.sh run --rm --no-deps api node dist/scripts/rotate-payment-keys.js
     sudo bash infra/interserver/compose.sh run --rm --no-deps api node dist/scripts/rotate-payment-keys.js --apply
     ```

     A rotação cobre contas, aberturas e versões de credencial.
  4. Remova a chave antiga só depois de um backup novo.

## 9. Ainda não validado com a Efí real (homologação)

Até a homologação, trate estes pontos como hipóteses. O roteiro de testes está em [financial-homologation-checklist.md](financial-homologation-checklist.md).

- Unidade dos juros mensais no boleto (assumido 100 = 1% ao mês) e limites de juros e de `days_to_write_off`. Com prazo 0, o campo não é enviado.
- Qual webhook confirma o Pix do BOLIX, se há dupla notificação, e se o Pix do BOLIX pago após o vencimento cobra multa e juros.
- Se a notificação de Cobranças traz o valor pago (`value`).
- Como o split aparece no extrato da CifraMais (linha por cobrança ou agrupada), que define a prática de comprovação.
- Split com parcela fixa quando há multa e juros.
- Devoluções Pix (total e parcial) e boleto devolvido.
