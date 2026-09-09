# Recuperação de senha e primeiro acesso

## Objetivo

Implementar recuperação de senha por e-mail e tornar toda senha temporária de primeiro acesso ou reset administrativo obrigatoriamente descartável após o primeiro login.

## Decisões de arquitetura

- O backend gera senhas temporárias criptograficamente aleatórias. O administrador vê a senha somente na resposta do cadastro ou reset, e o banco armazena apenas o hash bcrypt.
- `User.mustChangePassword` indica que a conta está limitada à troca de senha. `User.tokenVersion` invalida JWTs emitidos antes de uma troca ou reset.
- O JWT e a sessão NextAuth carregam `mustChangePassword` e `tokenVersion`. O login redireciona contas limitadas para `/primeiro-acesso`.
- O `JwtAuthGuard` consulta o usuário atual para validar `tokenVersion` e bloqueia endpoints protegidos enquanto `mustChangePassword` estiver ativo, exceto sessão, logout e troca de senha.
- A solicitação pública `POST /auth/forgot-password` sempre responde com a mesma mensagem, exista ou não a conta. Ela é protegida pelo `ThrottleGuard`.
- Tokens de recuperação têm 32 bytes aleatórios, duração de 30 minutos, uso único e são armazenados apenas como SHA-256. O token público contém `companyId` e o segredo, permitindo que a consulta Prisma sempre seja delimitada por empresa.
- Uma nova solicitação invalida tokens anteriores do mesmo usuário. Uma redefinição válida consome o token, altera a senha, limpa `mustChangePassword` e incrementa `tokenVersion` na mesma transação.
- O e-mail transacional usa `AUTH_RESEND_API_KEY` e `AUTH_EMAIL_FROM`, separados das credenciais de cobrança de cada cliente. Em desenvolvimento sem essas variáveis, a API mantém a resposta genérica e registra apenas que o provedor não está configurado, nunca o token.

## Contratos HTTP

### `POST /auth/forgot-password`

Entrada: `{ "email": "usuario@empresa.com" }`.

Saída em todos os casos aceitos: `{ "message": "Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha." }`.

### `POST /auth/reset-password`

Entrada: `{ "token": "<companyId>.<segredo>", "password": "<nova senha>", "passwordConfirmation": "<nova senha>" }`.

Sucesso: `{ "message": "Senha redefinida com sucesso." }`. Token inválido, expirado ou usado retorna `400` com mensagem amigável.

### `POST /auth/change-password`

Requer JWT. Entrada: `{ "currentPassword": "<senha temporária>", "password": "<nova senha>", "passwordConfirmation": "<nova senha>" }`.

Sucesso: altera a senha, limpa a limitação e invalida o JWT atual. O frontend encerra a sessão e redireciona para `/login?passwordChanged=1`.

## Frontend

- `/login` ganha o link “Esqueci minha senha” e mensagens de sucesso vindas dos dois fluxos.
- `/esqueci-senha` solicita o e-mail e sempre mostra a confirmação genérica.
- `/redefinir-senha?token=...` coleta e confirma a nova senha.
- `/primeiro-acesso` coleta a senha temporária, a nova senha e a confirmação.
- O middleware libera as duas rotas públicas de recuperação. Usuários autenticados com `mustChangePassword` só podem acessar `/primeiro-acesso` e a infraestrutura do NextAuth.
- O cliente HTTP centralizado fornece métodos tipados para os três endpoints.

## Cadastro e reset administrativo

- O campo de senha temporária deixa de ser obrigatório no cadastro de cliente.
- O backend sempre gera a senha no cadastro, define `mustChangePassword: true` e retorna `temporaryPassword` uma única vez junto do cliente criado.
- O reset administrativo continua gerando senha, passa a definir `mustChangePassword: true` e incrementa `tokenVersion`.

## Regras de senha

- Entre 8 e 120 caracteres.
- Deve conter ao menos letra minúscula, letra maiúscula e número.
- Confirmação deve coincidir.
- A nova senha não pode ser igual à senha atual no primeiro acesso.

## Testes e critérios de aceite

- Testes unitários do backend cobrem resposta antienumeração, hash do token, expiração, uso único, troca obrigatória, incremento de versão e geração de senha temporária.
- Testes do guard cobrem versão inválida e bloqueio de conta temporária.
- Testes do frontend cobrem o link no login, os três formulários, mensagens amigáveis e redirecionamentos.
- Build, lint e suítes relevantes de frontend e backend devem passar.

## Fora de escopo

- Escolha de senha pelo administrador.
- Recuperação por WhatsApp ou SMS.
- Painel para listar ou revogar sessões individualmente.
