import { EfiOnboardingStatus } from '@prisma/client';

export function canEditOnboarding(
  status: EfiOnboardingStatus,
  retryBlockedUntil: Date | null,
  now: Date,
): boolean {
  if (status === 'DRAFT' || status === 'CORRECTION_REQUIRED') return true;
  return (
    status === 'REFUSED' &&
    retryBlockedUntil !== null &&
    retryBlockedUntil.getTime() <= now.getTime()
  );
}
export function assertFreshConsent(
  revision: number,
  consentRevision: number | null,
  acceptedAt: Date | null,
  actual: Array<string | null>,
  expected: string[],
): void {
  if (
    revision !== consentRevision ||
    !acceptedAt ||
    actual.length !== expected.length ||
    actual.some(
      (value: string | null, index: number): boolean =>
        !value || value !== expected[index],
    )
  )
    throw new Error('CONSENT_REQUIRED');
}
export function functionalRefusal(code: string): string {
  const reasons: Record<string, string> = {
    cnpj_invalido:
      'Confira o CNPJ informado e a situação cadastral da empresa.',
    cnpj_inativo: 'O CNPJ precisa estar ativo para continuar.',
    razao_social_invalida: 'Confira a razão social vinculada ao CNPJ.',
    cpf_invalido: 'Confira o CPF do representante autorizado.',
    nome_completo_invalido: 'Confira o nome completo do representante.',
    data_nascimento_invalida: 'Confira a data de nascimento do representante.',
    nome_mae_invalido: 'Confira o nome da mãe do representante.',
    celular_invalido: 'Confira o celular do representante.',
    celular_nao_similar: 'Use o celular do representante cadastrado na Efí.',
    email_invalido: 'Confira o e-mail do representante.',
    menoridade: 'O representante precisa ser maior de idade.',
    conta_recusada_pelo_cliente_final:
      'O representante recusou a autorização. Após dois dias, corrija os dados e aceite novamente os termos para tentar outra vez.',
    NOTICE_FAILED:
      'Não foi possível entregar o aviso ao representante. Confira o número de WhatsApp.',
  };
  return (
    reasons[code] ??
    'Não foi possível concluir esta etapa. Confira os dados ou entre em contato com o atendimento CifraMais.'
  );
}
