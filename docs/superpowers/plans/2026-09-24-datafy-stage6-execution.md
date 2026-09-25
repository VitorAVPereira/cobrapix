# Execução da etapa 6 — telas do administrador e das empresas

Plano: `2026-09-23-datafy-whatsapp-tenant-conversations-plan.md`, somente etapa 6.

## Decisões

- Ruling: continuar no checkout `dev`, preservando alterações locais; sem commit, deploy ou envio real. Dependências do frontend instaladas com `npm ci` a partir do lockfile existente (scripts de instalação bloqueados pelo npm; testes e build não dependem deles).
- Ruling (responsável, 24/09): revisão de template concluída por ressincronização. `POST /templates/:id/review` (admin) relê o catálogo do provedor e só libera se categoria, corpo, rodapé, botões e variáveis posicionais baterem com o template local; caso contrário mantém o bloqueio e explica o motivo. Evento de provedor aplicado durante a revisão (mudança de `updatedAt`) retorna 409 e nunca libera.
- Ruling (responsável, 24/09): envios incertos são apenas exibidos, com aviso para não reenviar; nenhuma ação de resolução nesta etapa.
- Ruling (responsável, 24/09): a página `/inbox` antiga virou redirecionamento para `/admin/communications`; os métodos e tipos da inbox antiga foram removidos do cliente de API. As rotas GET antigas do backend continuam existindo, sem uso pela interface.
- Ruling: para o admin escolher contexto (classificação, resposta e template), `GET /communications/admin/conversations/:id/context-options` sugere devedores de todas as empresas com exatamente o mesmo telefone do contato, suas cobranças recentes e as empresas já presentes na conversa. É só sugestão: toda escolha é revalidada pelo backend antes de gravar.
- Ruling: para "exibir o motivo com clareza" quando a fila recusa um envio, a intenção passa a gravar códigos locais estáveis (`SERVICE_WINDOW_CLOSED`, `TEMPLATE_UNAVAILABLE`, `TEMPLATE_PARAMETERS_INVALID`, `RECIPIENT_SUPPRESSED`, `COLLECTION_NO_LONGER_ELIGIBLE`…), nunca texto do provedor. A tela traduz o código.
- Ruling: a empresa continua com o histórico de envios (inclusive e-mail) em uma aba "Envios", ao lado da aba "Conversas".

## Checklist

- [x] Componentes separados: lista/mensagens compartilhadas, visão da empresa e ações administrativas.
- [x] Empresa: conversas e mensagens com contexto da cobrança, data, direção, status e citação; sem editor, resposta ou classificação.
- [x] Admin: empresa/cobrança e método de atribuição por mensagem, filtro de pendentes, classificação com motivo e revisão, contexto e citação na resposta, resultado incerto sem reenvio.
- [x] Janela de atendimento: aberta → texto livre; fechada → somente template aprovado e sem revisão; botão de pagamento exige cobrança; recusa na fila explicada pelo código gravado.
- [x] Paginação por cursor, polling de 15 s só com a página visível, cancelamento da requisição anterior e remontagem (cache limpo) ao trocar usuário/empresa.
- [x] Templates: situação traduzida, qualidade, categoria divergente, revisão pendente com "Concluir revisão"; erros do backend exibidos; nenhuma credencial no frontend.
- [x] Testes de UI: empresa sem controles de envio, admin com classificação, estado vazio, 403/404, paginação, troca de sessão e parada do polling.

## Entregas

- Frontend (`front-cobranca`): `components/features/communications/` com `ConversationMessages`, `CompanyConversations`, `AdminConversationContext` e `format.ts`; `CommunicationsHistory` reorganizado como container; `lib/use-visible-polling.ts`; contratos novos em `lib/api-client.ts` com `AbortSignal`; tela de templates com revisão.
- Backend (`api-cobranca`): `TemplatesService.confirmReview` + rota; `CommunicationsService.listContextOptions` + rota; `reasonCode` em `WhatsappTransportError` e gravação em `lastErrorCode`. Sem migration nova.

## Como validar

```powershell
# api-cobranca
npm test -- --runInBand
npm run test:communications:postgres
npx eslint src
npm run build

# front-cobranca
npx jest --runInBand
npm run lint
npm run build
```

## Verificação

- Frontend: 34 suítes / 113 testes; `npm run lint` sem erros (1 aviso preexistente em `InvoiceTable`); `next build` concluído.
- Testes de UI novos: `CompanyConversations` (sem controles de envio e sem mutações; citação e ausência de IDs externos; 404 fecha a conversa mantendo a lista; cursor; polling a cada 15 s parando com a aba oculta e cancelando a requisição anterior; troca de sessão sem exibir cache), `AdminConversationContext` (classificação com `expectedRevision` e motivo; 409 explicado e tela atualizada; resposta com contexto/citação reutilizando o id na nova tentativa; janela fechada só com templates aprovados e cobrança obrigatória para botão de pagamento; incerto sem ação de reenvio), `CommunicationsHistory` (resposta sem contexto envia só conteúdo e id; 403; empresa não carrega a visão global) e tela de templates (revisão pendente explicada e conclusão pelo provedor).
- Backend: 82 suítes / 513 testes; ESLint e build sem erros; harness PostgreSQL/Redis verde, incluindo opções de contexto (mesmo telefone em duas empresas, nenhuma sugestão para outro contato) e códigos de recusa gravados (`SERVICE_WINDOW_CLOSED`, `COLLECTION_NO_LONGER_ELIGIBLE`).
- Não verificado: navegação manual no aplicativo em execução (exigiria banco e sessão reais); a cobertura é por testes de componente com a API simulada.

## Limitações e pendências

- Etapa 7: consulta de anexos. A tela já indica anexos e seu estado, sem link de download.
- Resolução auditada de envios incertos continua fora do escopo, por decisão do responsável.
- A listagem administrativa continua paginada por página e ordenada pela atividade global da conversa (compatibilidade); a projeção da empresa usa só mensagens autorizadas.
- A busca por texto não foi incluída; os filtros disponíveis (canal, atendimento, pendentes de classificação) consultam sempre a API autorizada.
- Nada foi aplicado na VPS nem publicado na Vercel.
