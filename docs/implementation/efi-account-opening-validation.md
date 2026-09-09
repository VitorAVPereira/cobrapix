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
