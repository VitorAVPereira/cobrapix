# Execução da etapa 9: testes integrados, operação e publicação (Fase A)

Plano: `2026-09-24-ativacao-financeira-administrativa.md`, etapa 9. Registro anterior: etapa 8. Esta entrega cobre a parte de código e documentação (9.1). A homologação na Efí (9.2) e a publicação com o piloto (9.3) dependem do responsável.

## Entregue

- **Runbook** `docs/operations/financial-activation.md`:
  - pré-requisitos (variáveis e chaves do painel);
  - publicação na ordem backend → migrations → frontend;
  - ativação de cliente, renovação e troca de conta;
  - diagnóstico: tabela dos passos e códigos de validação, códigos de emissão, anomalias de webhook com consulta somente leitura;
  - conciliação, pausa e rollback operacional;
  - backup, restauração e rotação de chaves;
  - lista do que falta validar na Efí.
- **Roteiro de homologação** `docs/operations/financial-homologation-checklist.md`: itens marcados ⚠ onde a Efí real confirma ou corrige uma suposição do código.
- **Correções encontradas ao revisar a operação:**
  - `EFI_PLATFORM_CLIENT_ID`, `EFI_PLATFORM_CLIENT_SECRET` e `EFI_PLATFORM_CERT_PATH` eram obrigatórias em produção, mas nenhum código as usa desde a etapa 6. Deixaram de ser exigidas e ficam para a Fase B. `EFI_PLATFORM_PAYEE_CODE`, `EFI_PLATFORM_ACCOUNT_NUMBER` e `EFI_PLATFORM_CNPJ` continuam obrigatórias.
  - Opcionais deixados em branco no `api.env` (`EFI_OPENING_*`, `EFI_PLATFORM_CLIENT_*`, `PLATFORM_ALERT_EMAIL`) impediam a API de subir; agora contam como ausentes. Obrigatória em branco continua falhando.
  - `api.env.example`:
    - `EFI_OPENING_ENABLED=false` por padrão;
    - `PLATFORM_ALERT_EMAIL` acrescentada;
    - a obsoleta `EFI_PLATFORM_SPLIT_PERCENTAGE` removida;
    - comentários sobre o uso de cada variável.
  - Faltava tela para checar a saúde de um cliente ativado manualmente, porque a tela de aberturas só lista quem tem abertura, e para ver e conciliar emissões incertas. Criados:
    - o painel **Operação** na tela de ativação do cliente: saúde da integração, "Validar integração agora", "Emissões para conciliar" e "Conciliar com a Efí", que só consulta pelo identificador e nunca reenvia;
    - a rota `GET /admin/payment-charges/:companyId/attention`, que lista emissões paradas há mais de 10 minutos ou com modalidade divergente.
- **Documentação:**
  - `infra/interserver/README.md`: certificados na Fase A, atualização de instalação existente e link para o runbook;
  - `AGENTS.md`: variáveis e módulos atuais.

## Matriz de aceite (Fase A)

| Cenário | Onde está coberto |
| --- | --- |
| Conta do cliente ativa e emite pela conta correta, sem API de abertura | `financial-activation-lifecycle/validation-postgres`, `payment-postgres` |
| Empresa sem onboarding é ativada pelo admin | `financial-activation-validation-postgres` (etapa 4) |
| Abertura desligada: API sobe e o manual funciona | `env.validation.spec` e **inicialização do build de produção** com o `api.env.example` novo (abertura e credenciais da plataforma em branco): API no ar, rotas registradas, `/health` 200 |
| Pagamentos pausados | `payment-postgres` (novo): emissão recusada; webhook e conciliação continuam |
| Titular não comprovado, certificado inválido, métodos, edição após validação, concorrência e auditoria, Redis caído | etapas 3–4 (`financial-activation-*-postgres`) |
| Abertura atrasada não sobrescreve o manual | `financial-activation-lifecycle-postgres` (etapa 5) |
| Troca de conta e renovação de certificado | `payment-postgres` e `lifecycle` (etapas 5–6) |
| Falta de credencial: sem fallback | `payment-postgres` (novo): `EFI_CREDENTIALS_UNAVAILABLE` |
| Comissão zero e centavos | `settlements-postgres` (sem remuneração, nada a comprovar); arredondamento inteiro |
| Split obrigatório falha | `payment-postgres` (novo): QR não exposto, cobrança preservada para conciliação e sem reemissão |
| Webhook duplicado, fora de ordem ou com `companyId` adulterado | `efi.service.spec`, `settlements-postgres` e `payment-postgres` (novo: `companyId` na URL não alcança cobrança com perfil) |
| Duas empresas, isolamento e acesso de A a dados de B | `settlements-postgres` (cenários 6 e 8), guards 403 |
| Devolução | `settlements-postgres` |
| Banco restaurado | `backup-restore-postgres` (novo): lançamentos idênticos, credencial do cliente legível só com as chaves originais, regra somente-inclusão preservada |
| BOLIX por cada alternativa, extrato do split | **homologação** (roteiro, itens ⚠) |

As linhas de lotes, reservas e repasses pertencem à Fase B.

## Verificação

- Backend:
  - `npx jest`: 96 suítes / 666 testes;
  - ESLint (`src`) e `nest build` sem erros;
  - `tsc`: os mesmos 12 erros antigos em specs;
  - harnesses PostgreSQL em 38 migrations, todos passam: `payment` (5 cenários novos), `settlements`, `backup-restore` (dados financeiros), `financial-activation`, `-candidates-`, `-validation-`, `-lifecycle-`, `communications`.
- Frontend:
  - `npx jest`: 41 suítes / 150 testes (novo: painel Operação);
  - `tsc` sem erros;
  - lint só com o aviso antigo;
  - `next build` OK.
- **Inicialização em produção:** `node dist/main` com `NODE_ENV=production`, `EFI_OPENING_ENABLED=false` e PostgreSQL/Redis descartáveis. A API sobe e o `/health` responde 200. O status "degraded" vem só da pasta de anexos, que não existe fora da VPS.
- **Não executado:**
  - `infra/efi/test-runtime.cjs`, que exige a imagem Docker de produção: o build da imagem não conseguiu baixar pacotes Debian nesta rede. Rodar localmente antes de publicar (`docker build -t ciframais-efi-local:verification api-cobranca`).
  - Qualquer chamada à Efí real.

## Pendente (responsável)

1. Homologação conforme o roteiro, registrando as diferenças. Os itens ⚠ divergentes viram ajuste de código.
2. PR da branch para a `main`, depois build local da imagem e o `test-runtime`.
3. Publicação na VPS:
   - atualizar o `api.env` existente (seção "Atualizar uma instalação existente" do README);
   - backend e migrations;
   - frontend.
4. Piloto com uma empresa, acompanhando emissão, webhooks e conciliação antes de ampliar.
5. Produção (`EFI_ENV=production`) só depois da homologação aprovada.
