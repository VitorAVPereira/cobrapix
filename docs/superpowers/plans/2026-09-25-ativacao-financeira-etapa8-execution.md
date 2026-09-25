# Execução da etapa 8: painel administrativo e visão da empresa (Fase A)

Plano: `2026-09-24-ativacao-financeira-administrativa.md`, etapa 8. Registros anteriores: `2026-09-25-ativacao-financeira-telas-execution.md` (assistente de ativação antecipado) e etapa 7.

## Escopo

Já entregue antes, na antecipação feita após a etapa 4:

- o assistente de ativação em cinco passos (início, credenciais, autorização/titularidade, validação, revisão e ativação);
- campos condicionais da conta do cliente (os modos CifraMais aparecem desabilitados);
- limpeza dos segredos após envio;
- verificações individuais da validação;
- tratamento de conflito de revisão;
- confirmação dos efeitos, inclusive a régua;
- o acesso pela lista de empresas sem depender de `EfiOnboarding`.

Esta etapa completa o restante da Fase A. Ficam para a Fase B:

- campos de destino e de tipo de repasse;
- telas de lotes com "Registrar repasse realizado";
- identificação da CifraMais como recebedora nas mensagens.

Na conta própria, o recebedor bancário é a própria empresa, então as mensagens de pagamento atuais já estão corretas.

## Decisões

- **Tela administrativa `/admin/conciliacao`** (menu "Conciliação" e atalho por cliente na lista de clientes). A rota `/admin/repasses` do plano fica para a Fase B, quando houver repasse.
  - A tela mostra o resumo:
    - recebido pelos clientes;
    - tarifa Efí (com a parte ainda estimada);
    - remuneração a comprovar, rotulada "saldo a conciliar";
    - remuneração comprovada;
    - devoluções, estornos e duplicidades;
    - cobranças divergentes.
  - Não aparece "disponível para repasse". O texto deixa claro que nada ali transfere dinheiro.
  - Lista com filtro por situação. Só as cobranças que aguardam comprovação podem ser selecionadas. A comprovação informa referência do extrato, valor em reais e observação; a tela mostra o total esperado como prévia, e o servidor recalcula.
  - Em conflito (409), a tela recarrega e mostra a mensagem do servidor.
  - O detalhe mostra lançamentos (com "estimada" quando for o caso), evidência e divergências. Cada divergência oferece só as decisões permitidas e pede o campo que a decisão exige: referência, motivo ou vencimento da fatura complementar. As já decididas aparecem como registro.
  - Com uma empresa filtrada, aparece a opção "Estornar remuneração em devolução".
- **Histórico** na tela de ativação do cliente (`GET /admin/companies/:id/financial-history`):
  - versões da ativação, com origem, conta mascarada, versão e validade da credencial, autorização, quem ativou, substituição e cancelamento;
  - eventos de auditoria financeiros **da própria empresa**.
  
  Os detalhes dos eventos passam por uma lista de campos permitidos. O que não está na lista é descartado, não mascarado: não aparecem documentos, segredos, ids de outras conciliações nem payload.
- **Visão da empresa `/financeiro`** (menu "Financeiro", `GET /financial/receipts`, empresa sempre da sessão). É só leitura.
  - Conta de recebimento: modo, conta mascarada, meios e desde quando está ativa.
  - Totais: recebido, tarifa Efí, remuneração CifraMais, devolvido e líquido.
  - Recebimentos por cobrança, com situação "Recebido", "Em análise pela CifraMais", "Devolvido" ou "Devolvido parcialmente". Não expõe evidência, referência de extrato nem decisão administrativa.
  - Sem ativação, explica que a equipe está configurando a conta.
- **Painel de aberturas** (`/admin/efi-onboarding`):
  - A ação existente passa a se chamar "Recuperar abertura existente".
  - A nova ação "Encerrar abertura para ativação manual" (já existente no backend desde a etapa 5) aparece para aberturas em andamento. Pede o resultado conferido na Efí e a referência da evidência, e nada é enviado à Efí.
  - "Ativar financeiro manualmente" continua na tela de ativação financeira.

## Verificação

- **Backend**
  - Testes novos:
    - redação do histórico;
    - rota do histórico exigindo PLATFORM_ADMIN;
    - recebimentos da empresa da sessão, com paginação limitada;
    - `test/settlements-postgres.cjs`, cenário 8: recebimentos e histórico restritos à empresa, sem dados de evidência para a empresa e sem ids de outro cliente no histórico.
  - `npx jest`: 96 suítes / 662 testes.
  - ESLint e `nest build` sem erros; o `tsc` mostra os mesmos 12 erros antigos em arquivos de teste.
  - Testes com PostgreSQL passam.
- **Frontend**
  - Testes novos:
    - conciliação: resumo sem saldo de repasse, seleção limitada e envio em centavos, conflito com recarga, decisão com campos por tipo, acesso negado sem dados;
    - visão da empresa: somente leitura, conta mascarada, situação em análise, ativação pendente;
    - histórico;
    - encerramento de abertura.
  - `npx jest`: 40 suítes / 149 testes.
  - `tsc` sem erros; lint só com o aviso antigo; `next build` com `/admin/conciliacao` e `/financeiro`.
- **Não verificado:** conferência visual no navegador. As telas seguem os padrões das existentes, mas não foram abertas com a API real.

## Pendente

- Etapa 9: testes integrados, homologação e publicação manual.
- Fase B:
  - modos de conta CifraMais no assistente (destino e tipo de repasse, integração central mascarada);
  - telas de lotes de repasse;
  - mensagens com o recebedor CifraMais.
