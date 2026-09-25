# Execução — correções e telas antecipadas (após a etapa 4)

Pedido do responsável ao aprovar a etapa 4. Registro anterior: `2026-09-25-ativacao-financeira-etapa4-execution.md`.

## Decisões

- Ruling (responsável): a VPS será publicada com `EFI_OPENING_ENABLED=false` até a Efí liberar a API de abertura.
- Ruling (responsável): corrigir a conversão de booleanos. O problema era do pipe global, então a correção vale para todos os campos `@IsBoolean()` da API (26), com o decorator `ToBoolean` (`src/common/to-boolean.ts`): booleano JSON e as strings exatas `"true"`/`"false"` são aceitos; qualquer outro valor é recusado.
- Ruling (responsável): a tela de ativação da empresa fica escondida enquanto a abertura estiver desligada. Novo `GET /financial-profile` (empresa da sessão) informa `openingEnabled` e o resumo mascarado do perfil ativo. Com a abertura desligada: o item de menu some, `/onboarding/efi` mostra apenas um aviso e o banner não aponta para o formulário.
- Ruling: “pode emitir” no frontend = perfil financeiro ativo **ou** abertura concluída. A segunda condição preserva o caminho atual até a etapa 5, quando a abertura também publicará perfil.
- Ruling (responsável): tela administrativa antecipada da etapa 8, só para a conta própria do cliente (Fase A): `/admin/ativacao-financeira` (escolha do cliente) e `/admin/ativacao-financeira/[companyId]`, com link na lista de clientes e no menu do administrador.

## Tela administrativa

1. Iniciar: conta Efí do cliente (os modos da conta CifraMais aparecem desabilitados), ambiente e meios.
2. Credenciais: titular (fixo no documento da empresa), conta, dígito, `payee_code`, chave Pix, Client ID, Client Secret, certificado `.p12` e senha, enviados por multipart. Client Secret e senha são campos de senha; eles e o arquivo são limpos após cada envio. Reabrir mostra só versão, conta mascarada, fingerprint e validade.
3. Autorização e titularidade: referência do contrato, validade opcional, atestação de que a conta é da empresa e referência da evidência.
4. Validação: lista antes os efeitos na conta do cliente (webhook Pix e split de validação) e o limite do BOLIX; acompanha os passos a cada 3 s enquanto valida.
5. Revisão e ativação: resumo, validade da validação, confirmação dos efeitos (incluindo a régua) e ciência dos passos não comprováveis. Cancelamento com motivo.

Revisão em conflito recarrega os dados e explica. Com a ativação manual pausada, a tela avisa e bloqueia validar/ativar. O cliente HTTP deixa de forçar `Content-Type: application/json` quando o corpo é `FormData`.

## Verificação

- Backend: `npx jest` 90 suítes / 621 testes (inclui `to-boolean.spec.ts` e `company-financial-profile.service.spec.ts`); ESLint e `nest build` sem erros.
- Frontend: `npx jest` 36 suítes / 133 testes (provedor e banner, menu com e sem abertura, aviso em `/onboarding/efi`, tela administrativa: início, upload multipart com limpeza dos segredos, conflito de revisão, confirmações da ativação, pausa); `tsc` sem erros; ESLint sem erros novos; `next build` com as rotas novas.
- Limite do jsdom encontrado nos testes: `new FormData(form)` devolve arquivo vazio e `required` em campo de arquivo não se satisfaz; a tela anexa o arquivo explicitamente a partir do campo e valida a presença no envio.
