# Interface e ativação manual — plano de implementação

> Para execução por agente: usar `superpowers:executing-plans` por tarefa. Acompanhar os passos pelos checkboxes. Não alterar credenciais nem emitir cobranças para testar ajustes visuais.

**Objetivo:** corrigir o recorte do menu de clientes, conter textos longos no Inbox e impedir autoativação no modo manual.

**Arquitetura:** corrigir o posicionamento do menu fora do contêiner que recorta a tabela; tratar quebra de texto somente na apresentação; utilizar a capacidade de abertura informada pelo backend para navegação e manter o bloqueio também no servidor.

**Tecnologias:** React/Next.js, Tailwind, React DOM, Testing Library/Jest e guards/serviços NestJS existentes.

**Especificação:** [contexto e decisões](../specs/2026-09-29-correcoes-testes-producao-design.md).

## Restrições globais

- Não aumentar indiscriminadamente a largura de todo o painel para esconder o problema do menu.
- Não inserir espaços, quebras de linha ou caracteres invisíveis em código de barras, Pix ou conteúdo persistido.
- Não remover a ativação manual administrativa, a elegibilidade financeira ou a possibilidade de preparar rascunhos.
- `EFI_OPENING_ENABLED=false` é a configuração esperada durante a fase manual. Falha de consulta dessa capacidade não autoriza mostrar o formulário.
- Correções visuais simples exigem verificação em navegador; teste que apenas confere uma classe CSS não comprova ausência de recorte.

## Pontos de revisão

1. Menu da última linha, junto à borda inferior, após rolagem — U1: todas as ações visíveis e alcançáveis.
2. Zoom de 200%, celular e teclado — U1: menu dentro da janela, foco previsível e fechamento por Escape.
3. Código sem espaços com milhares de caracteres e citação do mesmo texto — U2: sem expansão horizontal e cópia intacta.
4. Frontend novo com flag ausente/verdadeira na VPS — U3: identificar configuração efetiva em vez de duplicar uma correção já existente.
5. Usuário abre URL antiga ou chama diretamente o endpoint — U3: nenhum fluxo de autoativação quando a capacidade estiver desligada.

## U1. Corrigir o menu de ações na tela Clientes

**Modificar:** `front-cobranca/src/app/(dashboard)/clientes/page.tsx` e `__tests__/page.test.tsx`.

**Criar:** `front-cobranca/src/components/features/debtors/DebtorActionsMenu.tsx` e `__tests__/DebtorActionsMenu.test.tsx` para isolar posicionamento e interação, sem reescrever o cadastro.

**Interface proposta:** componente com `open: boolean`, `anchor: HTMLButtonElement | null`, `onClose(): void` e lista de ações `{ id, label, disabled?, onSelect(): void }`. Os callbacks da página continuam executando as mesmas ações sobre o devedor selecionado.

- [ ] Reproduzir e registrar o recorte no menu da última linha dentro do contêiner com `overflow-x-auto`. Conferir também coluna da direita, tabela com uma linha e rolagem horizontal.
- [ ] Renderizar o menu fora do contêiner que recorta, por portal para o documento, ancorado ao botão. Usar largura de 224 px limitada à largura disponível, margem mínima de 8 px da janela e abertura acima quando não houver espaço abaixo.
- [ ] Reposicionar ou fechar ao rolar/redimensionar; impedir que um menu permaneça associado a uma linha removida, filtrada ou paginada. Limitar altura com rolagem interna quando a própria janela for pequena.
- [ ] Preservar largura utilizável da tabela e botão sem encolhimento. Se o layout pai impedir redução da coluna flexível, aplicar `min-w-0` no ponto responsável; não aplicar overflow global que esconda conteúdo necessário.
- [ ] Manter nomes acessíveis, `aria-expanded`, foco inicial e navegação de menu por teclado. Escape e clique externo fecham; devolução de foco não deve roubar o foco de um modal aberto pela ação.
- [ ] Testar escolha de ação para o cliente correto, fechamento, troca de linha, paginação e teclado. Rodar `npx jest --runInBand --testPathPatterns='DebtorActionsMenu|clientes'` em `front-cobranca`.
- [ ] Verificar em navegador real nas larguras 375, 768, 1024 e 1366 px e zoom 200%. Conferir limites visuais, não apenas presença no DOM. Todas as ações da última linha devem ser clicáveis.
- [ ] Commit sugerido: `fix: impedir recorte do menu de clientes`.

**Aceite:** menu completo e utilizável em todas as posições da tabela, sem alargar a página além da janela.

## U2. Conter textos longos no Inbox

**Modificar:** `front-cobranca/src/components/features/communications/ConversationMessages.tsx`; conferir `AdminConversationContext.tsx`, `MessageAttachment.tsx` e o layout flexível em `src/app/(dashboard)/layout.tsx` apenas onde necessário.

**Consome:** conteúdo original recebido da API. **Produz:** exatamente o mesmo texto, com quebra visual dentro da bolha, tanto no admin quanto na empresa.

- [ ] Usar exemplos sintéticos de linha digitável, Pix copia e cola, URL longa, texto multilinha e sequência de 2.000 caracteres sem espaços, incluindo resposta citada e nome longo de anexo.
- [ ] Aplicar `overflow-wrap: anywhere`, preservação de quebras existentes e limites de largura nos blocos de conteúdo e citação. Garantir `min-width: 0` nos contêineres flexíveis que estejam impedindo o ajuste.
- [ ] Tratar previews e detalhes administrativos que mostram o mesmo conteúdo. Restringir imagens/vídeos à largura do contêiner sem deformar o conteúdo.
- [ ] Não usar truncamento para esconder código de pagamento completo e não modificar `message.content` nem a string copiada. O código copiado deve ser idêntico byte a byte ao recebido.
- [ ] Verificar em navegador real, no admin e no usuário, nas larguras 375 e 1366 px. Conferir que não surge rolagem horizontal na página e que mensagens curtas continuam legíveis.
- [ ] Executar testes existentes dos componentes afetados. Acrescentar teste de cópia/conteúdo somente se esse comportamento for alterado; não criar testes que apenas repitam classes CSS.
- [ ] Commit sugerido: `fix: quebrar textos longos no inbox sem alterar codigos`.

**Aceite:** texto e citações permanecem dentro da bolha, e códigos continuam utilizáveis após copiar.

## U3. Fechar todo o fluxo de autoativação no modo manual

**Consultar/modificar conforme as lacunas encontradas:**

- Backend: `api-cobranca/src/config/account-opening.ts`, `src/financial-activation/company-financial-profile.service.ts`, `src/efi-onboarding/efi-onboarding.controller.ts`, `efi-onboarding.service.ts`, `efi-opening-capability.spec.ts` e testes de perfil financeiro.
- Frontend: `front-cobranca/src/components/ui/Sidebar.tsx`, `src/components/features/FinancialActivation.tsx`, `src/app/(dashboard)/onboarding/efi/page.tsx`, `src/app/(dashboard)/configuracoes/conecte-seu-banco/page.tsx`, `src/middleware.ts` e testes correspondentes.
- Operação: `docs/operations/financial-activation.md` e `infra/interserver/api.env.example`, somente se precisarem esclarecer a configuração.

**Contrato existente a preservar:** resposta do perfil financeiro com `openingEnabled` e `canIssue`. No modo manual, `openingEnabled=false` não implica `canIssue=false`: cliente manualmente ativado continua emitindo.

- [ ] Conferir a flag efetiva da API e a resposta do perfil na versão publicada, sem exibir o conteúdo completo de `api.env`. O helper atual considera a abertura habilitada se a variável não for exatamente `false`; registrar esse comportamento na orientação operacional.
- [ ] Se `EFI_OPENING_ENABLED` estiver incorreta na VPS, planejar correção controlada da variável e recriação da API. Se estiver correta, verificar frontend publicado, resposta/cache e testes antes de modificar código. Menu, banner e página já possuem condicionais; não criar outra flag divergente.
- [ ] Criar ou ampliar testes de usuário pendente e usuário manualmente ativo com `openingEnabled=false`: não há item no menu, “Continuar ativação” nem formulário de abertura. Em carregamento/erro, não apresentar temporariamente o formulário.
- [ ] Na URL direta `/onboarding/efi` e no caminho legado `/configuracoes/conecte-seu-banco`, mostrar somente estado informativo e retorno às cobranças, sem ações de abertura. Usuário pendente vê aviso da equipe; ativo vê sua condição ativa, sem pendência falsa.
- [ ] Testar chamadas diretas de salvar rascunho de abertura, enviar e repetir abertura com a capacidade desligada. Se algum caminho ainda gravar ou acionar a Efí, aplicar o guard central correspondente. Preservar rascunhos de cobrança, que são outra função.
- [ ] Verificar que ativação manual administrativa, consulta de pagamentos, conciliação, mensagens e emissão por perfil ativo seguem disponíveis. Não apagar processos/histórico antigos de abertura.
- [ ] Em `api-cobranca`, executar `npm test -- --runInBand efi-opening-capability company-financial-profile`. Em `front-cobranca`, executar `npx jest --runInBand --testPathPatterns='Sidebar|FinancialActivation|onboarding/efi|middleware'`.
- [ ] Atualizar orientação de operação e fazer commit apenas das mudanças necessárias. Se o problema for exclusivamente configuração/publicação, registrar essa causa e os testes de confirmação, sem inventar uma correção funcional.

**Aceite:** não há caminho de autoativação para o usuário durante a fase manual, inclusive por chamada direta; clientes ativos continuam emitindo normalmente.

## Validação final desta frente

- [ ] `npm run build` e lint dos arquivos frontend alterados; testes backend se U3 exigir mudanças no servidor.
- [ ] Registrar verificações visuais e funcionais das U1/U2, com dados sintéticos.
- [ ] Depois de publicado, conferir uma empresa pendente e uma manualmente ativa. O estado informativo não deve prometer emissão enquanto o perfil financeiro estiver indisponível.
