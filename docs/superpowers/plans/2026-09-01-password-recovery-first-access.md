# Password Recovery and First Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar recuperação de senha por e-mail e troca obrigatória de toda senha temporária, com invalidação de sessões.

**Architecture:** O Prisma persiste estado de primeiro acesso, versão de token e hashes de tokens de recuperação. O NestJS concentra geração, validação, envio e troca de senhas; NextAuth transporta o estado de primeiro acesso e o Next.js fornece três telas dedicadas.

**Tech Stack:** Prisma 7, PostgreSQL, NestJS 11, Passport JWT, bcryptjs, Resend, Next.js 16 App Router, NextAuth 5, React 19, Jest e Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-01-password-recovery-first-access-design.md`

## Global Constraints

- Senhas têm de 8 a 120 caracteres, com minúscula, maiúscula e número.
- Tokens têm 32 bytes, são persistidos como SHA-256, expiram em 30 minutos e só podem ser usados uma vez.
- Respostas de solicitação de recuperação não revelam se o e-mail existe.
- Toda consulta nova de dados de tenant usa `companyId`.
- Não usar `any`, `@ts-ignore` ou tipos implícitos.
- O frontend consome a API exclusivamente por `front-cobranca/src/lib/api-client.ts`.

---

### Task 1: Persistência de autenticação

**Files:**
- Modify: `api-cobranca/prisma/schema.prisma`
- Create: `api-cobranca/prisma/migrations/20260901120000_add_password_recovery/migration.sql`

**Interfaces:**
- Produces: `User.mustChangePassword: boolean`, `User.tokenVersion: number` e `PasswordResetToken` delimitado por `companyId`.

- [ ] **Step 1: Escrever a alteração de schema que o código ainda não consegue compilar**

```prisma
model PasswordResetToken {
  id        String    @id @default(uuid())
  companyId String
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@unique([companyId, tokenHash])
  @@index([companyId, userId])
}
```

- [ ] **Step 2: Executar `npm run prisma:generate` e confirmar a falha ou mudança de cliente esperada antes dos consumidores existirem**

Run: `cd api-cobranca && npm run prisma:generate`

- [ ] **Step 3: Adicionar os campos ao `User`, a relação e a migração SQL**

```prisma
mustChangePassword Boolean @default(false)
tokenVersion       Int     @default(0)
passwordResetTokens PasswordResetToken[]
@@unique([id, companyId])
```

- [ ] **Step 4: Gerar Prisma Client e validar a migração**

Run: `cd api-cobranca && npm run prisma:generate`
Expected: exit 0.

### Task 2: Regras e endpoints de recuperação no backend

**Files:**
- Create: `api-cobranca/src/auth/dto/password.dto.ts`
- Modify: `api-cobranca/src/auth/auth.types.ts`
- Modify: `api-cobranca/src/auth/auth.service.spec.ts`
- Modify: `api-cobranca/src/auth/auth.service.ts`
- Modify: `api-cobranca/src/auth/auth.controller.ts`
- Modify: `api-cobranca/src/auth/auth.module.ts`
- Modify: `api-cobranca/src/config/env.validation.ts`
- Modify: `api-cobranca/.env.example`

**Interfaces:**
- Produces: `forgotPassword(dto): Promise<MessageResponse>`, `resetPassword(dto): Promise<MessageResponse>`, `changePassword(user, dto): Promise<MessageResponse>`.
- Produces: respostas de login com `mustChangePassword` e JWT com `tokenVersion`.

- [ ] **Step 1: Criar testes que expressem os fluxos ausentes**

```ts
it('responde de forma genérica para e-mail inexistente', async () => {
  prisma.user.findUnique.mockResolvedValue(null);
  await expect(service.forgotPassword({ email: 'ausente@teste.com' }))
    .resolves.toEqual({ message: FORGOT_PASSWORD_MESSAGE });
  expect(mailer.sendEmail).not.toHaveBeenCalled();
});

it('consome token válido e incrementa tokenVersion', async () => {
  await service.resetPassword({
    token: 'company-1.secret',
    password: 'NovaSenha1',
    passwordConfirmation: 'NovaSenha1',
  });
  expect(userUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'user-1', companyId: 'company-1' },
    data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
  }));
});
```

- [ ] **Step 2: Rodar os testes e observar falha por métodos/DTOs inexistentes**

Run: `cd api-cobranca && npm test -- --runInBand auth/auth.service.spec.ts`
Expected: FAIL citando `forgotPassword` ou `resetPassword` inexistente.

- [ ] **Step 3: Criar DTOs validados e implementar os métodos mínimos**

```ts
export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @Length(8, 120)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
  password!: string;

  @IsString()
  passwordConfirmation!: string;
}
```

Implementar geração por `randomBytes(32).toString('base64url')`, hash SHA-256, transação de consumo e comparação bcrypt para a troca autenticada.

- [ ] **Step 4: Expor os três endpoints e registrar `ResendMailerService`**

```ts
@UseGuards(ThrottleGuard)
@Post('forgot-password')
forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponse> {
  return this.authService.forgotPassword(dto);
}
```

- [ ] **Step 5: Rodar a suíte de auth até ficar verde**

Run: `cd api-cobranca && npm test -- --runInBand auth/auth.service.spec.ts`
Expected: PASS.

### Task 3: Validação de versão e bloqueio de primeiro acesso

**Files:**
- Create: `api-cobranca/src/auth/decorators/allow-password-change-required.decorator.ts`
- Create: `api-cobranca/src/auth/guards/jwt-auth.guard.spec.ts`
- Modify: `api-cobranca/src/auth/guards/jwt-auth.guard.ts`
- Modify: `api-cobranca/src/auth/strategies/jwt.strategy.ts`
- Modify: `api-cobranca/src/auth/auth.types.ts`
- Modify: `api-cobranca/src/auth/auth.controller.ts`

**Interfaces:**
- Produces: `AuthenticatedUser.mustChangePassword` e verificação de `tokenVersion` a cada JWT.
- Produces: decorator `@AllowPasswordChangeRequired()` para sessão, logout e troca de senha.

- [ ] **Step 1: Escrever testes de guard para conta limitada e versão revogada**

```ts
it('nega endpoint comum para conta que precisa trocar senha', async () => {
  request.user = { ...user, mustChangePassword: true };
  await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
});
```

- [ ] **Step 2: Rodar o teste e confirmar a falha por ausência do bloqueio**

Run: `cd api-cobranca && npm test -- --runInBand auth/guards/jwt-auth.guard.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar consulta por `{ id, companyId }`, versão e metadata de exceção**

```ts
const databaseUser = await this.prisma.user.findFirst({
  where: { id: payload.sub, companyId: payload.companyId },
  select: { tokenVersion: true, mustChangePassword: true },
});
```

- [ ] **Step 4: Rodar testes de guard e auth**

Run: `cd api-cobranca && npm test -- --runInBand auth`
Expected: PASS.

### Task 4: Senha temporária administrativa

**Files:**
- Modify: `api-cobranca/src/admin/dto/admin-client.dto.ts`
- Modify: `api-cobranca/src/admin/admin.service.spec.ts`
- Modify: `api-cobranca/src/admin/admin.service.ts`
- Modify: `api-cobranca/src/admin/admin.controller.ts`

**Interfaces:**
- Produces: `CreateAdminClientResponse { client: AdminClientResponse; temporaryPassword: string }`.
- Produces: reset administrativo que define `mustChangePassword: true` e incrementa `tokenVersion`.

- [ ] **Step 1: Alterar testes para exigir senha gerada no cadastro e limitação no reset**

```ts
expect(companyCreate).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    users: { create: expect.objectContaining({ mustChangePassword: true }) },
  }),
}));
expect(result.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);
```

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `cd api-cobranca && npm test -- --runInBand admin/admin.service.spec.ts`
Expected: FAIL porque cadastro ainda exige senha e não retorna senha temporária.

- [ ] **Step 3: Gerar senha no backend, remover senha do DTO e atualizar reset**

```ts
const temporaryPassword = this.generateTemporaryPassword();
const passwordHash = await bcrypt.hash(temporaryPassword, 10);
```

- [ ] **Step 4: Rodar as suítes de admin e auth**

Run: `cd api-cobranca && npm test -- --runInBand admin/admin.service.spec.ts auth`
Expected: PASS.

### Task 5: Contrato de sessão e cliente HTTP no frontend

**Files:**
- Modify: `front-cobranca/src/lib/auth.ts`
- Modify: `front-cobranca/src/lib/api-client.ts`
- Modify: `front-cobranca/src/lib/__tests__/api-client-admin.test.ts`
- Create: `front-cobranca/src/lib/__tests__/api-client-auth.test.ts`
- Modify: `front-cobranca/src/middleware.ts`

**Interfaces:**
- Produces: `session.user.mustChangePassword: boolean`.
- Produces: `forgotPassword`, `resetPassword`, `changePassword` e retorno tipado do cadastro administrativo.

- [ ] **Step 1: Escrever testes de payloads e respostas tipadas**

```ts
await apiClient.forgotPassword('usuario@empresa.com');
expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/auth/forgot-password'),
  expect.objectContaining({ body: JSON.stringify({ email: 'usuario@empresa.com' }) }));
```

- [ ] **Step 2: Rodar e confirmar falha por métodos inexistentes**

Run: `cd front-cobranca && npx jest --runInBand src/lib/__tests__/api-client-auth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar tipos, métodos, callback NextAuth e redirecionamento de middleware**

```ts
if (req.auth?.user.mustChangePassword && pathname !== '/primeiro-acesso') {
  return NextResponse.redirect(new URL('/primeiro-acesso', req.url));
}
```

- [ ] **Step 4: Rodar testes do cliente HTTP**

Run: `cd front-cobranca && npx jest --runInBand src/lib/__tests__/api-client-auth.test.ts src/lib/__tests__/api-client-admin.test.ts`
Expected: PASS.

### Task 6: Telas de recuperação e primeiro acesso

**Files:**
- Create: `front-cobranca/src/components/auth/AuthCard.tsx`
- Create: `front-cobranca/src/app/esqueci-senha/page.tsx`
- Create: `front-cobranca/src/app/redefinir-senha/page.tsx`
- Create: `front-cobranca/src/app/primeiro-acesso/page.tsx`
- Create: `front-cobranca/src/app/esqueci-senha/page.test.tsx`
- Create: `front-cobranca/src/app/redefinir-senha/page.test.tsx`
- Create: `front-cobranca/src/app/primeiro-acesso/page.test.tsx`
- Create: `front-cobranca/src/app/login/page.test.tsx`
- Modify: `front-cobranca/src/app/login/page.tsx`
- Modify: `front-cobranca/src/app/(dashboard)/admin/clientes/page.tsx`
- Modify: `front-cobranca/src/app/(dashboard)/admin/clientes/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: métodos do `apiClient` e `session.user.mustChangePassword`.
- Produces: formulários responsivos com mensagens amigáveis e redirecionamentos definidos na spec.

- [ ] **Step 1: Escrever testes de interação para os quatro pontos de entrada**

```tsx
expect(screen.getByRole('link', { name: /esqueci minha senha/i }))
  .toHaveAttribute('href', '/esqueci-senha');
```

- [ ] **Step 2: Rodar os testes e confirmar falhas por telas/link inexistentes**

Run: `cd front-cobranca && npx jest --runInBand src/app/login/page.test.tsx src/app/esqueci-senha/page.test.tsx src/app/redefinir-senha/page.test.tsx src/app/primeiro-acesso/page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar `AuthCard`, páginas, validação local e chamadas centralizadas**

```tsx
const result = await apiClient.resetPassword({ token, password, passwordConfirmation });
router.push('/login?passwordReset=1');
```

- [ ] **Step 4: Atualizar cadastro administrativo para exibir a senha gerada uma vez**

```ts
const result = await apiClient.createAdminClient(payload);
setMessage(`Cliente cadastrado. Senha temporaria: ${result.temporaryPassword}`);
```

- [ ] **Step 5: Rodar todas as suítes frontend relacionadas**

Run: `cd front-cobranca && npx jest --runInBand src/app/login src/app/esqueci-senha src/app/redefinir-senha src/app/primeiro-acesso 'src/app/(dashboard)/admin/clientes' src/lib/__tests__`
Expected: PASS.

### Task 7: Verificação integrada

**Files:**
- Modify: `api-cobranca/.env.example`

**Interfaces:**
- Consumes: todos os contratos anteriores.
- Produces: build e testes verdes, sem segredos registrados.

- [ ] **Step 1: Executar geração Prisma e testes completos do backend**

Run: `cd api-cobranca && npm run prisma:generate && npm test -- --runInBand && npm run build`
Expected: todos os comandos com exit 0.

- [ ] **Step 2: Executar testes, lint e build do frontend**

Run: `cd front-cobranca && npx jest --runInBand && npm run lint && npm run build`
Expected: todos os comandos com exit 0.

- [ ] **Step 3: Conferir diff e ausência de segredos ou tipos proibidos novos**

Run: `git diff --check && rg -n 'AUTH_RESEND_API_KEY=.+|@ts-ignore|\\bany\\b' api-cobranca front-cobranca`
Expected: nenhum segredo real e nenhum tipo proibido introduzido.
