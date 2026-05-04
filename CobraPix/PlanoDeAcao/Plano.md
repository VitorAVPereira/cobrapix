## Com base na exploração profunda que fiz, aqui está a reavaliação completa das Fases 4-8:

Fase 4: API — Paginação e Tratamento de Erro
4.1-4.2 Paginação server-side — Válido e crítico
O plano está correto. O InvoiceTable (components/features/InvoiceTable.tsx:431) usa getPaginationRowModel() (client-side) com pageSize fixo de 10. Para 1000 devedores, todos são carregados em memória e filtrados/fatiados no browser.
Ajuste: Adicionar paginação também em /devedores-recorrentes (atualmente também carrega tudo).
4.3 ExceptionFilter global — Válido e crítico
Confirmado: BillingController, InvoicesController e PaymentController todos expõem error.message diretamente nas responses HTTP em caso de erro inesperado. Ex:
billing.controller.ts:76 — error instanceof Error ? error.message : '...'
invoices.controller.ts:82 — mesma coisa
payment.controller.ts:231 — idem
Ajustes:

- Mapear erros do Prisma: P2002 (unique constraint) → 409 Conflict, P2025 (not found) → 404
- Não vazar stack traces em produção
- Logar com detalhes internamente, retornar mensagem genérica para o cliente
  4.4 Rate limiting HTTP — Válido
  rate-limiter-flexible já está instalado.
  Ajustes:
- Adicionar também em POST /whatsapp/meta (configuração) e POST /billing/run (trigger manual), pois disparam chamadas externas

---

Fase 5: Correções de Negócio
5.1 Multi-tenant fix — Válido e crítico
Confirmado em efi.service.ts:783-785:
// fallback cross-company: busca QUALQUER gateway account ativa
return this.prisma.gatewayAccount.findFirst({
where: { provider: 'EFI', status: 'ACTIVE' },
});
Se o notificationToken não bater com nenhuma invoice, o sistema retorna a primeira conta ativa que encontrar, ignorando companyId. No handleChargesWebhook, isso pode fazer o webhook processar pagamentos na empresa errada.
Sem ajustes — o plano original cobre exatamente o problema.
5.2 Paralelizar pagamentos — Válido
Confirmado em billing.service.ts:435-501 — loop for...of sequencial.
Ajuste: Em vez de chunk manual, usar o endpoint POST /payments/create-batch que já existe no PaymentController. Ele já é transacional e usa Promise.all internamente.
5.3 Limpeza Evolution — Válido
Referências a "EVOLUTION" encontradas em 6 arquivos:
Arquivo O que tem
webhooks.controller.ts:70 @Post('evolution') ativo
webhooks.service.ts:97 Valida EVOLUTION_API_KEY
env.validation.ts:16-17 EVOLUTION_API_URL, EVOLUTION_API_KEY (optional)
health/indicators/evolution.indicator.ts Enganoso: classe chama-se EvolutionHealthIndicator mas faz check da Meta Cloud
health/health.module.ts:5 Importa EvolutionHealthIndicator
health/health.service.ts:3,16,25 Usa EvolutionHealthIndicator
Ajuste: Renomear EvolutionHealthIndicator → MetaHealthIndicator (o nome atual é misleading, já que ele verifica Meta, não Evolution).
NOVO 5.4: Corrigir regeneração de PIX/Boleto expirados
Problema encontrado: Se um PIX expira mas o campo efiTxid ainda existe no banco, o sistema reutiliza o PIX expirado em vez de gerar um novo. O pixExpiresAt nunca é verificado para decidir se deve regenerar.
Em efi.service.ts, os métodos buildExistingPixResult e buildExistingBoletoResult verificam se efiTxid/efiChargeId existem no banco — se sim, retornam os dados existentes sem checar expiração.
Ação: Em ensureInvoicePayment e nos métodos do EfiService, verificar pixExpiresAt < now() antes de reutilizar dados de pagamento. Se expirado, limpar efiTxid/efiChargeId e gerar novo.
NOVO 5.5: Melhorar fluxo de aprovação de templates
Problema encontrado:

1. metaRejectedReason nunca é exibido na UI — se a Meta rejeitar um template, o usuário só vê "REJECTED" sem saber o motivo
2. metaStatus é mostrado como texto cru, sem cor — não dá para distinguir visualmente LOCAL de PENDING de APPROVED
3. lastMetaSyncAt nunca é exibido — o usuário não sabe quando o status foi atualizado
4. Não há polling após submissão — o usuário precisa recarregar a página para ver se foi aprovado
   Arquivos: templates/page.tsx:571-572

---

Fase 6: Frontend — Cache e UX
6.1 TanStack Query — Válido e prioritário
Zero cache entre páginas. Toda navegação refetcha tudo. Padrão useState + useEffect repetido em todas as páginas.
Ajuste: Adicionar useWhatsappUsage() com staleTime: 30s aos hooks planejados.
6.2 Loading skeletons + error boundaries — Válido
Nenhum error.tsx (Next.js Error Boundary) existe no projeto. Todas as páginas usam estado imperativo.
Ajustes:

- Adicionar botão "Tentar novamente" nos estados de erro (atualmente zero páginas têm retry)
- 4 das 7 páginas não usam o padrão active flag para evitar setState em componente desmontado (potenciais memory leaks)
  NOVO 6.3: Tela de gestão de opt-in
  Problema encontrado: Não existe visão consolidada de quais devedores têm opt-in ativo. O opt-in só é editável:
- No modal de configurações do devedor (um por um)
- No formulário de criação manual
- Via CSV import
  Para 1000 devedores, o lojista não consegue responder "quantos autorizaram WhatsApp?" ou "quem ainda não autorizou?".
  Ação:
- Coluna de opt-in no InvoiceTable (ícone check/x)
- Filtro por status de opt-in
- Badge na dashboard: "X de Y devedores com opt-in"
  NOVO 6.4: Status de template com cores na UI
  Relacionado ao 5.5 acima. Badges coloridos:
- LOCAL: cinza
- PENDING/IN_REVIEW: amarelo
- APPROVED: verde
- REJECTED: vermelho + tooltip com metaRejectedReason

---

Fase 7: Observabilidade
7.1 Structured logging — Válido
Ajuste: Incluir eventos de limite de mensagens nos logs estruturados (quando tier muda, quando atinge 80%, quando esgota).
7.2 Health checks — Válido
Ajuste: O EvolutionHealthIndicator deve ser renomeado para MetaHealthIndicator (já coberto no 5.3).
7.3 Queue stats — REMOVER da Fase 7
Já implementado na Fase 3 revisada:

- GET /queue/stats — counts + últimos 50 jobs falhos
- POST /queue/retry/:jobId — reprocessa job falho
- POST /queue/clean-failed — limpa fila de falhas
  Está em queue.controller.ts.
  NOVO 7.4: Alertas de limite de mensagens
  Quando uma empresa atinge 80%+ do limite diário, logar warning. Quando atinge 100%, logar alerta. Futuramente: notificar via webhook/email.
  NOVO 7.5: Widget de mensagens no dashboard de admin
  Se houver um painel de admin multi-tenant (não apenas visão da própria empresa), mostrar:
- Quantas empresas estão com WhatsApp conectado
- Quantas atingiram limite diário
- Quantas têm tier baixo (TIER50, TIER250)

---

Fase 8: CI/CD + Testes
8.1 GitHub Actions — Válido
8.2 Testes críticos — Válido
Ajuste: Adicionar à lista de prioridade:

- MessagingLimitService — canSend/trackSend cycle, verificar bloqueio quando limite atinge, verificar fallback DB quando Redis falha
- WebhooksService.handleMetaWebhook — testar dispatch para messaging_limit, account_update

---

Resumo das mudanças sugeridas
Itens existentes que precisam de ajuste

# Original Ajuste

4.1-4.2 + paginação em devedores-recorrentes
4.3 + mapeamento de erros Prisma (P2002/P2025)
4.4 + rate limit em POST /whatsapp/meta e /billing/run
5.2 usar create-batch existente em vez de chunk manual
5.3 + renomear EvolutionHealthIndicator → MetaHealthIndicator
6.1 + useWhatsappUsage hook
6.2 + retry buttons nos error states
7.2 + renomear/fixar EvolutionHealthIndicator
7.3 REMOVER (já feito na Fase 3)
8.2 + testes de MessagingLimitService + webhook dispatch
Novos itens

# Item Prioridade Esforço

5.4 Corrigir regeneração de PIX/Boleto expirados Alta 2-3h
5.5 Melhorar UX de aprovação de templates (rejection reason, cores) Média 1-2h
6.3 Tela/filtro de gestão de opt-in Média 2-3h
6.4 Status badges coloridos nos templates Média 1h
7.4 Alertas de limite de mensagens (80%/100%) Média 1h
7.5 Dashboard admin multi-tenant de uso de WhatsApp Baixa 2h
Estimativa revisada
Dia Fase Itens Tempo
3 Paginação Backend + Frontend server-side 4-5h
3 ExceptionFilter Global filter + throttle 2h
3-4 Negócio Multi-tenant fix, paralelizar Efí, limpar Evolution, PIX expiry fix 5-6h
4-5 Frontend TanStack Query, skeletons, error boundaries, opt-in view, template UX 6-8h
5-6 Observabilidade Structured logging, health expand, alerts 3-4h
6-7 CI/CD + Testes GitHub Actions + 7 suites críticas 5-6h
Total revisado: ~25-31h (+4-6h vs original)

---

Quer que eu detalhe algum dos novos itens ou podemos prosseguir com a implementação?
