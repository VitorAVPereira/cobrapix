/**
 * Efí refusals that never debit the account (codes seen in homologation or documented),
 * with the reason shown to the company and to the approver. Anything else is uncertain:
 * it is checked by the send id, never taken as a failure.
 */
export const EFI_REFUSALS: Record<string, string> = {
  chave_nao_pertence_ao_documento:
    'A chave Pix não pertence ao CPF ou CNPJ do colaborador',
  chave_favorecido_nao_encontrada: 'Chave Pix do colaborador não encontrada',
  json_invalido:
    'Dados do colaborador recusados pela Efí; confira a chave ou a conta',
  valor_invalido: 'Valor ou documento recusado pela Efí',
  documento_bloqueado: 'O documento da conta Efí da empresa tem bloqueios',
  chave_invalida: 'A chave Pix da empresa não pertence à conta Efí',
  conta_chave_sem_webhook:
    'A chave Pix da empresa está sem webhook na Efí; fale com o suporte CifraMais',
  pagamento_negado: 'Pagamento negado pela análise da Efí',
  insufficient_scope:
    'A conta Efí não tem permissão para enviar Pix; fale com o suporte CifraMais',
};

export const DISBURSEMENT_REASONS = {
  NOT_REALIZED: 'Pix não realizado pela Efí',
  NOT_REALIZED_UNKNOWN: 'Recusado pelo banco (motivo não informado)',
  ISSUER_CHANGED:
    'A conta Efí da empresa mudou depois da aprovação; nada foi enviado',
  ACCOUNT_UNAVAILABLE:
    'A conta Efí da empresa está indisponível (credencial ou certificado); nada foi enviado',
} as const;

export function insufficientBalanceReason(
  availableCents: number,
  neededCents: number,
): string {
  const brl = (cents: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
      .format(cents / 100)
      .replace(/\s/g, ' ');
  return `Saldo insuficiente na conta Efí: disponível ${brl(availableCents)}, necessário ${brl(neededCents)}; nada foi enviado`;
}
