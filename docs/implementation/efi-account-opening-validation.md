# Efí account opening — validation record

## Baseline (2026-09-09)

Worktree `C:/micro-saas/.worktrees/efi-account-opening`, branch `codex/efi-account-opening`, based on `dev` commit `3fec618`.
Existing `codex/centralized-communication-channels` worktree preserved.

| Check | Result |
| --- | --- |
| Backend dependency installation | `npm ci --ignore-scripts` passed; Prisma generated separately |
| Frontend dependency installation | `npm ci` failed: pre-existing lock omitted node-cron and @types/node-cron; repaired with npm install |
| Backend tests | 28 suites, 155 tests passed |
| Frontend tests | 23 suites, 64 tests passed |
| Backend lint without auto-fix | 33 pre-existing errors |
| Frontend lint | zero errors, three warnings |
| Backend build | passed |
| Frontend build | passed; existing middleware convention warning |

Tests use provider doubles. No real financial API submission, production deployment, database migration, tenant deletion or notification was performed.

## Release gates

Production rollout still requires approved legal text, server secrets, Efí account-opening entitlement, homologation of the full workflow and six split variants, externally verified mTLS, identified backup and reviewed legacy cleanup. New account opening must remain paused until these gates are met.

## Local verification — 2026-09-11

- Frontend: 24 suites / 63 tests passed before the latest administrative pause controls.
- Production backend TypeScript check passed, including the corrected `src` build root.
- Provisioning/disconnect fencing, concurrent certificate renewal, auditable manual ownership verification and locked invoice status have regression tests.
- `node infra/efi/test-database.cjs`: all 27 migrations applied to an isolated PostgreSQL 16 container. Verified immutable fees, default draft invoices, concurrent issuance exclusion, cross-tenant rejection, global template preferences, and actual retention/anonymization.
- Docker image build succeeded. Initial runtime checks found and corrected an output-path mismatch (`dist/src/main.js` versus `dist/main.js`). The corrected image passed full Nest bootstrap with PostgreSQL/Redis, four unauthenticated-route checks, and direct spoofed-header rejection.
- The local mTLS fixture uses its own certificate authority. Passing it verifies Nginx and the Nest trust boundary; it does not replace external homologation with Efí's real certificate chain.

Manual recovery of an unknown request identifier requires the administrator to verify its owner in the Efí portal, enter the matching CNPJ and attest to that check. The credential endpoint does not provide the owner's CNPJ; this is recorded as an administrative attestation, not automatic provider identity verification.

- `node infra/efi/test-mtls.cjs`: six checks passed against Nginx and the compiled Nest guard (missing/untrusted client certificate rejected, trusted opening/Pix callbacks accepted, public-host spoof rejected, other dedicated-host routes rejected).
- Full backend regression after catalog integration and lifecycle fixes: 50 suites / 291 tests passed. Frontend production TypeScript check passed.

## Fechamento local — 12/09/2026

Decisão vigente do usuário: Bolix por padrão, Pix disponível e Boleto tradicional somente histórico. O bloqueio está no backend, DTOs, cadastro administrativo e escolhas do frontend. Não foi presumido nenhum valor de tarifa contratado.

| Verificação final | Resultado |
| --- | --- |
| Backend Jest | 60 suítes, 343 testes aprovados |
| Backend build | aprovado na construção da imagem atual |
| Backend ESLint | zero erros |
| Frontend Jest | 31 suítes, 89 testes aprovados |
| Frontend build | aprovado; aviso de migração futura de middleware para proxy |
| Frontend ESLint | zero erros; aviso conhecido do compilador React/TanStack Table |
| PostgreSQL 16 | 28 migrações, constraints, concorrência, retenção, seed e inventário aprovados |
| Runtime Docker | grafo Nest completo, PostgreSQL/Redis, autorização e fluxo HTTP do cliente aprovados |
| mTLS Nginx/Nest | seis cenários locais aprovados |
| Backup | seleção de expiração e pipeline de sucesso/falha aprovados com ferramentas simuladas, sem acesso AWS |
| Compose e shell | configuração validada sem resolver segredos; sintaxe Bash aprovada |

Imagem testada: `ciframais-efi-local:verification`, digest `sha256:8c9c3fefceefb1187750a9a131171e09b4beb026b76372d8064ebc2164a842c0`.

### Tarefa 7

Telas de onboarding, rascunho/retomada, consentimento, recusa/timeline, concluir depois, aviso persistente e bloqueios financeiros concluídos. Painel administrativo inclui saúde/pausas, fallback validado, certificados, tarifas/alertas, catálogo global e atendimento central. Taxas antigas e formulários de segredos por cliente removidos da interface. Corrigidos o acesso às novas rotas administrativas, o loop na troca da senha inicial do administrador e a perda de campos durante atualização periódica. Testes cobrem esses casos, o isolamento de acesso e o bloqueio quando a consulta de ativação falha.

### Tarefa 8 — entrega de engenharia local

Imagem de produção com usuário não-root, Compose com Redis privado, Nginx/mTLS e limites de memória/logs concluídos. Scripts executáveis de teste de banco, runtime e mTLS; seed mínimo sem senha padrão nem ativação automática; inventário de tenants somente leitura; backup cifrado, timer diário e expiração restrita ao prefixo próprio. O runtime testa login temporário, troca de senha e invalidação do token, retomada de rascunho com dados criptografados, revisão obsoleta, ausência de consentimento, isolamento admin/cliente e emissão bloqueada sem criar reserva.

[Procedimento operacional](../../infra/efi/ROLLOUT.md) contém preparação de Lightsail, segredos, seed, backup/restauração, inventário de corte, homologação, smoke, primeira semana e reversão. Testes Docker usam rede isolada, credenciais sintéticas e CA local; nenhum envio real ou operação bancária foi realizado.

### Gates para produção ainda não executados

- Provisionamento AWS/DNS/Vercel e instalação dos segredos reais.
- Aprovação jurídica e substituição das versões de texto de homologação.
- Homologação real Efí/Meta/Resend, liquidação/split nas quatro combinações Pix/Bolix e certificado cliente oficial Efí.
- Backup identificado, ensaio de restauração e revisão/execução da exclusão dos tenants de teste.
- Contração do legado: remover referências no código/schema e somente depois os campos antigos, junto do corte. Não há DROP prematuro na cadeia aditiva.
- Smoke controlado, ativação administrativa e monitoramento da primeira semana.

Esses gates não são declarados aprovados pelos testes locais. A entrega não foi publicada, não alterou o Neon e não excluiu tenants. As cópias de segurança exigem instalação do timer e monitoramento no host para cumprir a retenção operacional.
