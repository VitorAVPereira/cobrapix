# Roteiro de homologação Efí: Fase A (conta própria do cliente)

Execute na VPS com `EFI_ENV=homologation`, com uma conta Efí de **homologação** de um cliente de teste (certificado `.p12` e aplicação de homologação) e a conta CifraMais de homologação configurada em `EFI_PLATFORM_*`. Anote o resultado de cada item (OK / diferente / falhou) com data e evidência, sem copiar segredos. Operação da tela e códigos de erro: `financial-activation.md`.

Os itens marcados com **⚠** confirmam ou corrigem uma suposição do código. Se o resultado for diferente do esperado, registre e peça o ajuste antes de produção.

## 0. Preparação

- [ ] `api.env` conforme a seção 1 do runbook, a API saudável em `/health` e a publicação conforme a seção 2.
- [ ] Tarifa vigente global para Pix e BOLIX (Admin → Tarifas).
- [ ] "Novas emissões" e "Ativação financeira manual" liberadas; "Abertura de contas" pausada.

## 1. Ativação

- [ ] Cadastrar a empresa de teste e ativar pela tela (seção 3 do runbook).
- [ ] A validação aprova certificado, autenticação Pix e Cobranças, webhook Pix (a URL lida de volta confere) e split Pix.
- [ ] No painel Efí da conta do cliente, o webhook Pix aponta para `EFI_WEBHOOK_BASE_URL`.
- [ ] Testes negativos, um de cada vez. Cada um deve dar o código esperado, sem segredo na tela nem no log:
  - senha errada do `.p12`;
  - certificado de produção num perfil de homologação;
  - Client Secret errado.

## 2. Pix CobV

Emita uma cobrança de valor baixo **sem** multa e juros e outra **com** multa de 2%, juros de 1% ao mês e 30 dias de prazo, com vencimento hoje.

- [ ] QR e copia-e-cola aparecem só depois da emissão completa.
- [ ] Pagar antes do vencimento: o webhook Pix dá baixa e a conciliação mostra pagamento, tarifa e remuneração.
- [ ] **⚠** O webhook Pix traz `chave` (a chave do cliente), `valor` e `gnExtras.tarifa`. Anotar se a tarifa vem.
- [ ] Pagar a cobrança com multa e juros **depois** do vencimento (no dia seguinte):
  - a Efí aceita, porque `validadeAposVencimento` foi enviado;
  - o valor cobrado inclui multa e juros;
  - a remuneração é calculada sobre o valor pago.
- [ ] Na conta CifraMais aparece o split da cobrança.

## 3. BOLIX

Emita um BOLIX com multa de 2%, juros de 1% ao mês e 30 dias.

- [ ] A resposta traz o boleto e o QR Pix. Se vier sem o QR, a cobrança fica em `EFI_BILLING_MODE_MISMATCH` (seção 5.2 do runbook).
- [ ] **⚠** Pagar pelo **QR Pix** e anotar:
  - qual webhook dá baixa (esperado: Cobranças);
  - se chega também um webhook Pix com txid desconhecido (esperado: registrado como `UNKNOWN_TXID`, sem baixa).
- [ ] **⚠** Pagar outro BOLIX pelo **boleto** e anotar se a notificação de Cobranças traz o valor pago (`value`).
- [ ] **⚠** Pagar um BOLIX depois do vencimento, pelo boleto e pelo QR, e anotar se cobra multa e juros e qual valor chega.
- [ ] **⚠** Conferir no painel Efí a multa e os juros do boleto. O código envia `interest: { value: 100, type: "monthly" }` supondo 100 = 1% ao mês. Se a Efí interpretar outra unidade, ajustar antes de produção.
- [ ] **⚠** Emitir com prazo 0 após o vencimento, caso em que o campo `days_to_write_off` não é enviado, e anotar até quando o boleto aceita pagamento.
- [ ] **⚠** Pagar o mesmo BOLIX duas vezes (boleto e QR), se a Efí permitir, e anotar as notificações. Esperado: uma baixa e a segunda como duplicidade ou em revisão, sem liquidar duas vezes.
- [ ] Na conta CifraMais aparece o repasse (marketplace) do BOLIX.

## 4. Remuneração no extrato da CifraMais

- [ ] **⚠** Anotar como os splits aparecem no extrato da conta CifraMais: uma linha por cobrança, agrupados por dia, com qual descrição ou identificador.
- [ ] Registrar uma comprovação em Admin → Conciliação com a referência do extrato. Comprovar também com valor diferente e conferir que as cobranças vão para revisão.

## 5. Devoluções

- [ ] Devolver parte de um Pix pelo painel Efí: o webhook registra a devolução, o lançamento compensatório e o pagamento original continua.
- [ ] Devolver o restante: a cobrança fica devolvida e a fatura cancelada.
- [ ] Ligar "Estornar remuneração em devolução" para a empresa de teste, repetir e conferir o estorno proporcional devido.
- [ ] **⚠** Boleto/BOLIX devolvido, se o painel permitir: anotar a notificação recebida.

## 6. Operação

- [ ] Enviar novas credenciais da mesma conta (renovação) e ativar. Cobranças antigas continuam canceláveis e conciliáveis.
- [ ] Pausar "Novas emissões": a emissão é recusada e um webhook de cobrança já emitida ainda é aplicado.
- [ ] "Validar integração agora" no painel Operação mostra a integração saudável. Com o Client Secret revogado na Efí, duas checagens seguidas deixam a conta indisponível e bloqueiam novas emissões.
- [ ] Backup e restauração num ambiente separado (seção 8 do runbook). Depois de restaurar, a validação de saúde passa com as mesmas chaves.

## 7. Resultado

Registre o resumo com as diferenças encontradas em `docs/superpowers/plans/` (arquivo de execução da homologação). As diferenças nos itens **⚠** exigem ajuste de código antes de ligar produção (`EFI_ENV=production`).
