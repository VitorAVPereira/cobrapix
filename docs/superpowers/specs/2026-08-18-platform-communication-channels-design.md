# Canais de comunicação centralizados do Cifra+

**Data:** 2026-08-18  
**Status:** aprovado para planejamento

## Objetivo

Centralizar no Cifra+ toda a operação de WhatsApp e e-mail usada nas
cobranças. Empresas clientes deixam de possuir credenciais, remetentes,
templates ou inbox próprios. Elas continuam responsáveis somente por seus
devedores, cobranças, réguas, datas, horários e canais habilitados.

O Cifra+ passa a operar:

- um número principal de WhatsApp e uma lista ordenada de números de backup;
- failover automático e ordenado entre os números de WhatsApp;
- uma única conta e remetente de e-mail;
- templates globais de WhatsApp e e-mail;
- um inbox global de WhatsApp acessível apenas ao administrador da plataforma.

Não há clientes utilizando a estrutura antiga. Dados de configuração e
histórico de conversas legados podem ser descartados durante a migração.

## Estado atual

Credenciais da Meta Cloud API e do Resend são armazenadas em `Company`. O
worker de cobrança seleciona o remetente a partir do `companyId`, os templates
são criados por empresa e o webhook da Meta identifica a empresa pelo
`phone_number_id` receptor. O inbox também é particionado por empresa e fica
disponível ao usuário do cliente.

Essa associação entre tenant e infraestrutura de comunicação será removida.
O `companyId` continuará acompanhando jobs, tentativas e mensagens apenas para
identificar a origem comercial da cobrança, produzir o conteúdo e manter
métricas e auditoria.

## Responsabilidades

### Empresas clientes

Empresas clientes poderão:

- cadastrar e administrar devedores e cobranças;
- configurar etapas, dias, horários e ativação das réguas;
- escolher se uma etapa utiliza WhatsApp ou e-mail;
- consultar o estado dos seus próprios envios e cobranças.

Empresas clientes não poderão:

- visualizar ou alterar credenciais da Meta ou do Resend;
- escolher o número ou remetente usado;
- criar, editar ou publicar templates;
- acessar conversas ou mensagens recebidas no WhatsApp;
- acessar páginas ou APIs administrativas de canais.

### Administrador da plataforma

Usuários `PLATFORM_ADMIN` poderão:

- cadastrar, testar, ordenar, ativar e desativar números de WhatsApp;
- consultar saúde, limite, cooldown, último erro e último envio de cada número;
- configurar e testar a única conta de e-mail do Cifra+;
- administrar e publicar templates globais;
- acessar o inbox global e seu contexto de cobrança;
- consultar a auditoria de alterações dos canais.

## Modelo de dados

Os nomes definitivos poderão ser ajustados no plano sem alterar as fronteiras
abaixo.

### Remetentes de WhatsApp da plataforma

Um modelo global representará cada número de WhatsApp. Ele não terá
`companyId` e armazenará:

- identificador e nome administrativo;
- `phoneNumberId`, WABA, número comercial e idioma padrão;
- token de acesso criptografado;
- prioridade única usada no failover;
- ativação manual;
- estado operacional derivado;
- tier/limite conhecido e instante de renovação, quando disponível;
- `cooldownUntil`, último teste saudável, último erro e último envio;
- datas de criação e atualização.

O segredo global do aplicativo Meta e o token de verificação do webhook também
serão configuração da plataforma. A chave raiz usada para criptografar
segredos continuará fora do banco, em variável de ambiente.

### Configuração global de e-mail

Um registro singleton armazenará:

- API key do Resend criptografada;
- segredo do webhook criptografado;
- nome e endereço do remetente;
- estado de ativação e resultado do último teste;
- datas de criação e atualização.

Não haverá failover de e-mail nesta etapa.

### Templates globais

Templates deixam de ter proprietário empresa. O catálogo global terá templates
separados por canal e finalidade, com slug único e variáveis permitidas.

Templates de WhatsApp armazenarão também nome oficial Meta, idioma, categoria,
estado de aprovação, motivo de rejeição e data da última sincronização. Como os
números de backup podem pertencer a WABAs diferentes, cada template terá uma
implantação por WABA único presente nos remetentes cadastrados. A implantação
guarda o ID/nome remoto e o estado de aprovação naquele WABA.
Templates de e-mail armazenarão assunto e corpo. A conta global do Resend será
usada quando houver sincronização remota.

Etapas de régua não aceitarão mais uma escolha livre de template pelo cliente.
Elas guardarão o canal e os dados de agendamento; o backend resolverá o
template global compatível com a finalidade da etapa. Cada etapa terá uma
finalidade interna derivada de canal e posição relativa ao vencimento por um
catálogo versionado do backend. Existirá exatamente um template global ativo
por combinação de canal e finalidade.

### Tentativas e mensagens

Jobs e tentativas continuarão contendo `companyId`, `invoiceId`, `debtorId` e
`ruleStepId`. Tentativas de WhatsApp registrarão ainda o remetente global
tentado, o `messageId`, o resultado e o erro classificado. Isso permite medir
uso e falhas por número sem perder métricas por cliente.

O inbox terá uma conversa global por telefone do destinatário. Mensagens
armazenarão, quando aplicável:

- direção e conteúdo;
- ID externo e estado de entrega;
- empresa, cobrança e devedor relacionados;
- remetente global utilizado;
- datas de envio, recebimento e leitura.

Quando o mesmo telefone existir em mais de uma empresa, haverá uma única
conversa central. Cada mensagem enviada exibirá seu próprio contexto. Uma
mensagem recebida sem referência explícita será apresentada junto do contexto
da cobrança ativa mais recente, sem alterar automaticamente dados de nenhum
tenant.

Uma lista global de supressão de WhatsApp armazenará telefones que solicitaram
opt-out, com origem, data e mensagem relacionada. O worker consultará essa
lista antes de qualquer envio, independentemente da empresa da cobrança.

## Fluxo de envio por WhatsApp

1. A régua cria um job com cobrança, empresa, devedor, canal e finalidade do
   template. O job não contém um número previamente escolhido.
2. No início de cada tentativa, o worker consulta os remetentes habilitados na
   ordem administrativa vigente.
3. Remetentes em cooldown, desativados, com limite esgotado ou cujo WABA não
   tenha o template aprovado são ignorados.
4. O worker tenta o primeiro remetente elegível e persiste a tentativa antes de
   chamar a Meta.
5. Em sucesso, associa o `messageId` à tentativa, cobrança e conversa global.
6. Em falha elegível para failover, registra o erro, atualiza a saúde do
   remetente e tenta o próximo.
7. Se todos os remetentes falharem, o job falha e segue a política de retry da
   fila. A tentativa de cobrança não é marcada como enviada.

A seleção ocorre no worker, não no enfileiramento. Reordenação, desativação e
recuperação de um número afetam imediatamente jobs ainda pendentes e retries.

## Política de failover

Failover ocorre apenas em falhas atribuíveis ao remetente, incluindo:

- credencial ou número inválido/desativado;
- WABA ou número indisponível;
- limite ou rate limit do remetente atingido;
- resposta explícita da Meta indicando indisponibilidade do remetente.

Falhas de conteúdo, destinatário, template não aprovado ou payload inválido
não avançam para outro número, pois a troca repetiria o mesmo erro.

Falhas ambíguas de transporte, nas quais a Meta pode ter aceitado a mensagem
sem devolver resposta, também não disparam failover imediato. O job registra o
estado indeterminado e segue uma política de retry cautelosa para reduzir o
risco de cobrança duplicada.

Números com limite esgotado ficam inelegíveis até a janela informada pela Meta.
Outras falhas de remetente aplicam cooldown técnico. Ao fim do cooldown, o
número volta a ser candidato somente depois de um teste saudável. O principal
reassume automaticamente sua prioridade depois dessa recuperação, evitando
alternância contínua.

Limites da Meta e velocidade de envio são medidos por remetente global. A
proteção por telefone de destino é preservada para impedir excesso de mensagens
ao mesmo devedor.

## Webhooks e inbox central

O webhook da Meta resolve o remetente global pelo `phone_number_id`.

- Estados de entrega são correlacionados pelo `messageId` e atualizam a
  tentativa e a mensagem já associadas à empresa e cobrança.
- Mensagens recebidas criam ou atualizam a conversa global do telefone.
- Opt-out recebido inclui o telefone na supressão global do Cifra+. Isso
  bloqueia novos WhatsApps para esse telefone em todas as empresas, sem
  escolher silenciosamente um tenant, e fica auditado.
- Eventos de limite e conta atualizam a saúde do remetente global afetado.

O webhook do Resend usa o segredo global. Eventos são correlacionados pelo ID
externo do e-mail enviado e, por essa relação, continuam alimentando métricas
da empresa e da cobrança corretas.

O inbox central será exposto somente a `PLATFORM_ADMIN`. Ele mostrará o
histórico por telefone, contexto de empresa/cobrança, estado do pagamento,
remetente usado, mensagens não lidas e ferramentas de resposta compatíveis com
a janela de atendimento da Meta.

## APIs e painel administrativo

Será criada uma área administrativa de canais, protegida por
`JwtAuthGuard`, `PlatformAdminGuard`, validação estrita de DTOs e throttling.

### Canais

O painel `/admin/canais` oferecerá:

- lista ordenada de números WhatsApp;
- cadastro e edição de metadados e token;
- alteração de prioridade sem prioridades duplicadas;
- ativação, desativação, teste de conexão e teste de envio;
- saúde, limite, cooldown e último erro sem exposição de segredos;
- configuração e teste da conta global de e-mail;
- URLs necessárias para configurar webhooks.

### Templates

O painel administrativo de templates oferecerá criação, edição, validação,
publicação e consulta de aprovação. Somente variáveis conhecidas serão aceitas.
Templates usados por etapas ativas não poderão ser removidos sem substituição.
Publicar ou atualizar um template sincronizará uma implantação em cada WABA
único dos remetentes cadastrados e testados, inclusive backups ainda
desativados, e o painel mostrará o estado por WABA. Um remetente só poderá ser
ativado depois que todos os templates globais ativos estiverem aprovados em
seu WABA.

### Atendimento

O painel `/admin/atendimento` substituirá o inbox dos clientes. As consultas
serão paginadas e permitirão busca por telefone, devedor, empresa e cobrança.

## Segurança e auditoria

- Todas as APIs administrativas exigirão papel `PLATFORM_ADMIN`.
- Segredos serão criptografados em repouso e nunca retornados em texto plano.
- Atualizações de segredo serão opcionais: valor ausente mantém o atual.
- Logs técnicos e auditoria nunca incluirão tokens, API keys ou secrets.
- Alterações de canal, prioridade, ativação e templates produzirão `AuditLog`.
- Testes de envio usarão destinatário informado explicitamente pelo
  administrador e serão identificados como teste.
- Limites informados para um WABA tornam temporariamente inelegíveis todos os
  remetentes daquele WABA; limites específicos de telefone afetam apenas o
  remetente correspondente.
- Nenhum envio será considerado bem-sucedido sem ID confirmado do provedor.
- Sem canal saudável, o sistema falha fechado, preserva o job e registra uma
  mensagem operacional clara.

## Remoção do legado

A implementação removerá, e não apenas esconderá:

- campos Meta, status WhatsApp e campos Resend de `Company`;
- DTOs e respostas administrativas que configuram canais por cliente;
- endpoints de conectar, consultar ou desconectar WhatsApp por empresa;
- resolução de credenciais e limites a partir de `companyId`;
- sincronização de templates usando credenciais de empresa;
- modelos de conversa, interação e uso particionados pelo número da empresa;
- páginas de inbox, conexão WhatsApp e templates para usuários clientes;
- campos de Meta/Resend do cadastro administrativo de clientes;
- seleção manual de template na tela de régua;
- métodos e tipos correspondentes no cliente de API;
- referências residuais ao caminho Evolution ou à propriedade de canal pelo
  tenant, caso ainda existam no código executável.

O histórico legado de conversas e as credenciais antigas serão descartados na
migração. A migração será única e não manterá modo híbrido.

## Tratamento de erros

Erros do provedor serão normalizados em uma classificação interna:

- `SENDER_UNAVAILABLE`: habilita failover e cooldown;
- `SENDER_LIMIT`: habilita failover até renovação do limite;
- `RECIPIENT_INVALID`: falha permanente da mensagem;
- `TEMPLATE_INVALID`: falha permanente até correção/publicação;
- `PAYLOAD_INVALID`: falha permanente e alerta operacional;
- `DELIVERY_UNKNOWN`: sem failover imediato;
- `TRANSIENT_PROVIDER`: retry pela fila conforme segurança contra duplicidade.

O frontend exibirá mensagens amigáveis e ações possíveis. Detalhes técnicos
ficarão no estado do canal e nos logs operacionais, sem expor segredos.

## Migração e ativação

1. Criar os modelos globais e adaptar serviços, workers e webhooks.
2. Criar APIs e telas administrativas e remover acessos do cliente.
3. Remover modelos, campos e código legados na mesma migração de banco.
4. Cadastrar e testar ao menos um remetente WhatsApp, a conta de e-mail e os
   templates globais.
5. Habilitar os workers somente depois de os testes de conexão passarem.

Não haverá compatibilidade com configurações antigas. Ambientes sem canais
globais configurados continuarão funcionando para administração e cobrança,
mas jobs de comunicação falharão de forma recuperável até a configuração.

## Estratégia de testes

A implementação seguirá TDD e cobrirá:

- ordenação, ativação, cooldown, recuperação e esgotamento dos remetentes;
- classificação de erros e decisão entre failover, retry e falha permanente;
- ausência de duplicidade de prioridade e atualização transacional da ordem;
- persistência do remetente e contexto em cada tentativa;
- status da Meta correlacionado por `messageId`;
- inbound global, telefones presentes em múltiplas empresas e opt-out seguro;
- supressão global impedindo novos envios para qualquer empresa;
- limites por remetente e proteção por destinatário;
- uso exclusivo da configuração global do Resend;
- webhook Resend global mantendo atribuição por empresa/cobrança;
- resolução automática e validação de templates globais;
- implantação e aprovação de cada template em todos os WABAs cadastrados e
  testados;
- autorização `PLATFORM_ADMIN` e não exposição de segredos;
- interfaces de canais, templates e atendimento;
- ausência de links, páginas e chamadas legadas para usuários clientes;
- migração Prisma, geração do client, testes unitários, lint e builds de backend
  e frontend.

## Fora de escopo

- múltiplas contas ou failover de e-mail;
- balanceamento normal de carga entre números de WhatsApp;
- inbox ou atendimento acessível às empresas clientes;
- preservação do histórico de conversas legado;
- escolha de template por empresa ou por usuário cliente;
- modo híbrido com remetentes pertencentes a empresas;
- retomada do fluxo de primeiro acesso e recuperação de senha, que permanece
  pausado até a conclusão desta mudança arquitetural.

## Critérios de aceite

- Nenhuma credencial de WhatsApp ou Resend pertence a `Company`.
- Apenas administradores da plataforma configuram canais e templates.
- Todo WhatsApp usa o primeiro remetente global saudável por prioridade.
- O remetente escolhido possui o template aprovado em seu próprio WABA.
- Falhas elegíveis avançam pelos backups na ordem configurada.
- Todo e-mail usa a única conta global do Cifra+.
- Usuários clientes não têm inbox nem acesso a páginas/APIs de canais ou
  templates.
- O administrador possui inbox global com contexto de empresa e cobrança.
- Eventos de entrega continuam atribuídos corretamente a cobrança e empresa.
- Código executável, tipos, páginas e banco não mantêm o caminho antigo por
  empresa.
- Testes, lint e builds definidos pelo projeto passam.
