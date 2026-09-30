# Pagamento público — plano de implementação

> Para execução por agente: usar `superpowers:executing-plans` por tarefa. Não implementar durante a entrevista de planejamento. Acompanhar os passos pelos checkboxes.

**Objetivo:** permitir pagamento pelo link sem login e mostrar somente o status quando a cobrança estiver encerrada.

**Arquitetura:** preservar `/pagar/[signedToken]` fora do layout autenticado e `GET /payments/public/:token`. O token assinado limita a consulta à empresa e à fatura; não autentica um usuário. O backend define se os instrumentos ainda podem ser exibidos.

**Tecnologias:** Next.js App Router, middleware/Auth.js, NestJS, HMAC, Prisma e Jest.

**Especificação:** [contexto e decisões](../specs/2026-09-29-correcoes-testes-producao-design.md).

## Restrições globais

- Aplicam-se as restrições comuns da especificação.
- Manter TTL de 90 dias para o token; não modificar chave ou formato de assinatura sem necessidade. Links existentes válidos continuam funcionando.
- Cobrança vencida pode continuar pagável. Token expirado, instrumento expirado e vencimento são condições diferentes.
- Não gerar pagamento, renovar instrumento, cancelar cobrança ou emitir novo token em um GET público.
- A capacidade de emitir novas cobranças (`canIssue`) não determina, sozinha, se um instrumento já emitido pode ser pago. Pausa de novas emissões ou mudança da conta atual não devem invalidar automaticamente cobranças antigas.
- Não devolver credenciais, documentos completos, outras faturas, contatos internos ou histórico administrativo.

## Pontos de revisão

1. Anônimo, usuário de outra empresa, admin e sessão expirada abrem o mesmo link válido — P1/P3: nenhuma sessão é necessária.
2. Um atacante altera empresa, fatura, assinatura ou adiciona um segmento ao token — P2: rejeição, sem dados da cobrança.
3. A dívida venceu, mas o instrumento continua válido — P2/P3: manter pagamento sem marcar automaticamente como expirado.
4. Um link antigo aponta para fatura com instrumento substituído — P2: nunca exibir o instrumento cancelado; só o instrumento confirmado e vigente dessa fatura.
5. O pagamento foi confirmado depois de a página ser aberta — P3: nova consulta/atualização mostra estado encerrado sem instrumentos; a interface não é prova de liquidação em tempo real.

## P1. Liberar somente a página pública na navegação

**Modificar:** `front-cobranca/src/middleware.ts` e `front-cobranca/src/__tests__/middleware.test.ts`.

**Interface:** reconhecimento estrito da rota `/pagar/<um-segmento-de-token>` antes das regras de login, papel de usuário, sessão invalidada e primeiro acesso. A validade criptográfica permanece responsabilidade do backend.

- [x] Criar testes de regressão para anônimo, admin, usuário da mesma/outra empresa, `authInvalidated` e `mustChangePassword`: `/pagar/<token>` deve seguir para a página, sem redirecionamento para login, admin ou primeiro acesso.
- [x] Incluir controles negativos: `/cobrancas`, `/admin/clientes`, APIs protegidas e nomes parecidos como `/pagar-admin` continuam com a proteção original. Não liberar toda rota que apenas contenha a palavra “pagar”.
- [x] Executar em `front-cobranca`: `npx jest --runInBand src/__tests__/middleware.test.ts`, confirmando falha dos novos casos antes da mudança.
- [x] Implementar a exceção estrita no ponto correto do middleware. Conferir também callbacks de autenticação para garantir que o redirecionamento não ocorre antes da exceção.
- [ ] Reexecutar testes e comprovar em navegador anônimo que a rota chega à página. Commit sugerido: `fix: liberar pagina de pagamento sem sessao`.

**Aceite:** link válido abre sem conta; uma tentativa de abrir o dashboard continua exigindo autenticação.

## P2. Definir resposta pública por estado da cobrança

**Modificar:** `api-cobranca/src/payment/payment-link.service.ts`, `payment-link.service.spec.ts`, `public-payment.controller.ts`; criar `api-cobranca/src/payment/public-payment.controller.spec.ts` se ainda não houver cobertura desse contrato.

**Contrato:** manter os campos públicos atuais e acrescentar `state: 'PAYABLE' | 'PAID' | 'CANCELED' | 'EXPIRED' | 'UNAVAILABLE'` e `canPay: boolean`. Para qualquer estado diferente de `PAYABLE`, `pixCopyPaste`, `boletoLine`, `boletoLink` e `boletoPdf` devem ser `null` na resposta do servidor. Acrescentar `paidAt` apenas se houver dado confirmado e necessário para a tela.

- [x] Remover a restrição de consulta que só encontra `Invoice.status=PENDING`, mantendo obrigatoriamente `invoiceId` e `companyId` extraídos do token verificado.
- [x] Derivar o estado público a partir da fatura e de sua emissão confirmada. Reutilizar o critério de emissão válida do plano financeiro; `PENDING` da fatura não basta para expor um instrumento cuja tentativa ainda esteja incerta.
- [x] Usar o instrumento vigente da fatura, preservando sua conta emissora. Sem instrumento confirmado, retornar `UNAVAILABLE`, sem criar outro. Para vínculo legado incompleto, exigir consistência explícita antes de exibir dados.
- [x] Mapear pagamento e encerramento confirmados para páginas de status. Usar o prazo real de pagamento/baixa da modalidade; não expirar boleto só porque a data de vencimento passou ou porque um campo de Pix está ausente.
- [x] Tornar a verificação do token estrita: exatamente payload e assinatura, formato esperado, finalidade correta, IDs não vazios, expiração finita e rejeição quando `exp <= agora`. Não aceitar campos de consulta que substituam os IDs assinados.
- [x] Testar os estados com dados sintéticos: emissão válida, pago, cancelado, expirado, vencido ainda pagável, rascunho, emissão incerta, instrumento substituído, conta atual alterada, novas emissões pausadas, token malformado/adulterado/expirado e tentativa de trocar empresa. Verificar ausência de instrumentos nos estados encerrados, inclusive na resposta JSON.
- [x] Manter leitura sem cache compartilhado e aplicar `Cache-Control: no-store` no endpoint. Não registrar o token completo em logs de aplicação ou mensagens de erro.
- [x] Executar em `api-cobranca`: `npm test -- --runInBand payment-link public-payment`. Commit sugerido: `fix: limitar dados publicos ao estado pagavel da cobranca`.

**Aceite:** nenhum estado encerrado devolve instrumentos para novo pagamento; adulterar o link não permite consultar outra fatura.

## P3. Renderizar pagamento e encerramento sem navegação interna

**Modificar:** `front-cobranca/src/app/pagar/[signedToken]/page.tsx`, `PaymentPageClient.tsx`; criar `PaymentPageClient.test.tsx` na mesma pasta. Ajustar o tipo público no cliente de API somente se ele for compartilhado.

**Consome:** `state` e `canPay` da P2. **Produz:** tela independente do painel, com informações mínimas e botões apenas quando o backend confirmar pagamento disponível.

- [x] Manter consulta server-side com `cache: 'no-store'` e sem exigir JWT. Não carregar providers, sidebar ou endpoints do dashboard nessa página.
- [x] Renderizar os textos: “Pagamento confirmado”, “Cobrança cancelada”, “Prazo de pagamento encerrado” ou “Pagamento indisponível no momento”. Token inválido/expirado continua com aviso genérico, sem detalhes da fatura.
- [x] Exibir copiar Pix, copiar linha digitável e abrir boleto/PDF somente com `canPay=true` e instrumento presente. URLs externas devem usar protocolo permitido; não renderizar URL arbitrária executável devolvida por um payload inesperado.
- [x] Usar o logotipo sem encaminhar o pagador ao painel. Não incluir menus de navegação do produto. Metadados devem impedir indexação; aplicar política de referrer que não envie o token ao abrir o boleto externo.
- [x] Testar todos os estados, cópia integral de códigos, ausência de ações no encerramento, timeout da API e atualização após mudança de status. A API indisponível não pode ser apresentada como cobrança paga ou cancelada.
- [x] Executar em `front-cobranca`: `npx jest --runInBand --testPathPatterns=PaymentPageClient` e `npm run build`.
- [ ] Validar em navegador real, anônimo e autenticado: link recebido por WhatsApp; expiração; conclusão do pagamento; volta pelo histórico do navegador; celular de 375 px. Na atualização, a página não pode continuar exibindo instrumentos obtidos de um cache antigo.
- [ ] Commit sugerido: `feat: exibir status final no pagamento publico`.

**Aceite:** pessoa com link válido consegue pagar sem cadastro, e pessoa com link de cobrança encerrada vê apenas o status. A consulta não concede acesso a nenhuma outra tela.

## Publicação desta frente

1. P1 pode sair isoladamente, mantendo a resposta atual da API, para corrigir o bloqueio por login.
2. Publicar P2 antes de P3, com campos novos aditivos. Preservar a compatibilidade durante a janela entre backend e frontend.
3. P2/P3 dependem do critério de emissão confirmada da frente financeira, mas não precisam aguardar a resolução externa das duas ocorrências específicas.
4. Validar a URL verdadeira em janela anônima após publicação, sem copiar tokens para o relatório. Registrar apenas resultado, versão e horário.

## Registro de execução (29/09/2026, branch `fix/pagamento-publico`, a partir de `fix/bolix-conciliacao`)

**Causa do login no link:** o `matcher` do middleware incluía `/pagar/...` e, sem
sessão, a regra geral redirecionava para `/login`; um admin era mandado para
`/admin/clientes` e uma sessão invalidada ou em primeiro acesso também era
desviada. Agora `/pagar/<um segmento>` é decidido antes de ler a sessão
(`src/lib/public-routes.ts`); `/pagar`, `/pagar-admin`, `/pagar/x/y` e o painel
continuam protegidos. O `SessionProvider` da raiz não é montado nessa rota.

**Estado público (P2):** consulta pela fatura e empresa assinadas, sem filtro de
status. Só uma emissão `ACTIVE` cujos identificadores coincidem com os da fatura
expõe instrumentos (emissão incerta, legado sem emissão, instrumento de emissão
substituída ou emissão sem instrumento → `UNAVAILABLE`). Boleto/Bolix continua
pagável depois do vencimento até a Efí informar a baixa (`EXPIRED`); o Pix CobV
encerra no fim do último dia de validade em Brasília. Não há consulta à conta
atual, à ativação ou à pausa de emissões. Token: exatamente
`payload.assinatura` em base64url, até 512 caracteres, campos exatos, ids não
vazios, `exp` inteiro e `exp <= agora` rejeitado. Links já enviados continuam
válidos. `Cache-Control: no-store` também nas respostas de erro.

**Página (P3):** estados com os textos do plano; ações só com `canPay`; links só
`https:` com `noreferrer`; código exibido inteiro para cópia manual; botão
"Atualizar situação" e releitura ao voltar pelo histórico (`pageshow`);
`noindex` e `no-referrer` em metadados e cabeçalhos HTTP. API fora do ar ou
lenta (8 s) mostra indisponibilidade, nunca pago/cancelado; 400/404 mostram só
"Link indisponível". Uma resposta sem `state` (API anterior) é tratada como
pagável, preservando a janela de publicação.

**Validação:** `api-cobranca` 831 testes e build; `front-cobranca` 251 testes,
build e ESLint dos arquivos alterados. Conferido por HTTP, sem cookie, contra o
servidor Next (dev e build de produção) com uma API simulada local: painel e
rotas parecidas redirecionam para login; `/pagar/<token>` responde 200 em todos
os estados, instrumentos só no pagável, `Cache-Control: private, no-cache,
no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`.

**Pendente:** validação em navegador real (o navegador embutido recusou
`localhost`): link recebido por WhatsApp, sessão autenticada, voltar pelo
histórico e celular de 375 px, após a publicação. Commits.
