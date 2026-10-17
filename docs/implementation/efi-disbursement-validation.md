# Validação na homologação Efí — pagamentos a colaboradores

**Data:** 17/10/2026. **Ambiente:** sandbox da API Pix (`pix-h.api.efipay.com.br`), conta de
homologação do cliente, com autorização do usuário. Valores fictícios, de R$ 0,01 a R$ 25,00;
nenhum dinheiro real. Credenciais, certificado e token não estão registrados aqui.

**Montagem:**

- SDK `sdk-node-apis-efi` 1.2.28 com o certificado `.p12` de homologação.
- Webhook da chave pagadora cadastrado sem mTLS (`validateMtls: false`, header
  `x-skip-mtls-checking`). O endereço era um túnel temporário aberto pelo usuário até um receptor
  local que só gravava os avisos.
- No fim, o webhook foi removido do sandbox e o receptor, encerrado.

## Resultados

| Item | Resultado |
| --- | --- |
| Token OAuth com certificado | 200. **A resposta lista os escopos concedidos** (`scope`), inclusive `pix.send`, `gn.pix.send.read`, `gn.balance.read`, `gn.receipts.read` e `webhook.*`. Dá para conferir `pix.send` sem mover dinheiro |
| Saldo (`getAccountBalance`) | `{"saldo": "0.00"}`. **Sempre zero em homologação**, e os envios funcionam mesmo assim |
| Listar e criar chave aleatória | Erro do sandbox (`erro_interno_servidor` e `erro_aplicacao`). A chave pagadora veio do app Efí |
| Cadastro do webhook | Aceito. A Efí envia antes `{"evento":"teste_webhook","data_criacao":"..."}` ao endereço cadastrado |
| `idEnvio` de 32 caracteres hexadecimais (id do item sem hífens) | **Aceito** |
| `idEnvio` de 36 caracteres (com ou sem hífens) ou com `_`/`!` | `json_invalido` ("Valores ou tipos de campo inválidos") |
| Chave + `favorecido.cnpj` do titular | Aceito (T02) |
| Chave + `favorecido.cpf` de outra pessoa | `chave_nao_pertence_ao_documento`: "O cpf do favorecido é diferente do documento em posse da chave". **A conferência do titular funciona** |
| Chave do favorecido inexistente | `chave_favorecido_nao_encontrada`: "A chave do favorecido não foi encontrada" |
| Chave pagadora sem webhook na conta | `conta_chave_sem_webhook`: "A chave informada não tem webhook cadastrado na conta Efí autenticada" |
| `contaBanco` com CPF e `tipoConta: cacc` | Aceito. Na consulta aparece como `"corrente"` |
| `contaBanco` com CNPJ e `tipoConta: svgs` | Aceito. Na consulta aparece como `"poupanca"` |
| `contaBanco` com `tipoConta: tran` | Aceito e pago (conta de pagamento) |
| `contaBanco` com `tipoConta: slry` ou `corrente` | `json_invalido`. **Conta salário é recusada** |
| `contaBanco.codigoBanco` | ISPB com 8 dígitos (`09089356`). Agência sem zeros à esquerda (`1`) foi aceita |
| Mesmo `idEnvio` depois do envio (mesmo corpo ou valor diferente) | `id_envio_duplicado`: "O id de envio informado já foi utilizado em outro pagamento". **Nenhum débito em dobro** |
| R$ 0,01 a R$ 10,00 por chave | 201 `EM_PROCESSAMENTO`, depois webhook `REALIZADO` |
| R$ 15,00 | 201 `EM_PROCESSAMENTO`, depois webhook `NAO_REALIZADO` com `gnExtras.erro` |
| R$ 25,00 | **201 com `status: "NAO_REALIZADO"` na própria resposta e sem webhook.** Não vem como erro HTTP |
| R$ 4,00 e R$ 5,00 | `REALIZADO`, seguido de webhooks com `devolucoes` (duas de R$ 2,00 e uma de R$ 5,00) |
| Consulta por `idEnvio` | `status` `REALIZADO` ou `NAO_REALIZADO`, `endToEndId`, `chave` (pagadora), `horario`, `favorecido` (`identificacao` ou `contaBanco`). **Sem o motivo da recusa** |
| Consulta de `idEnvio` inexistente | 404 Problem Details `PixEnviadoNaoEncontrado`: "Pix enviado não encontrado para o idEnvio informado." |
| Lista de enviados | Paginada (`parametros.paginacao`), com `devolucoes` resumidas por Pix |
| Comprovante (`pixGetReceipt`) | 500 `ComprovanteErroInterno`: "Funcionalidade desabilitada em ambiente de homologação." **Só em produção** |

## Formato real do webhook de envio

A Efí acrescenta `/pix` ao endereço cadastrado. Com o padrão atual do sistema
(`/webhooks/efi/pix?ignorar=`), o caminho continua o mesmo.

**Pago:**

```json
{ "pix": [ { "endToEndId": "E09089356…APIDICT…", "chave": "<chave pagadora>", "tipo": "SOLICITACAO",
  "status": "REALIZADO", "valor": "0.01", "horario": "2026-10-17T08:23:31.000Z",
  "infoPagador": "Teste CifraMais", "gnExtras": { "idEnvio": "0b0bc6de611e4415a2b63768d6d9f155" } } ] }
```

**Recusado:**

```json
{ "pix": [ { "endToEndId": "…", "chave": "<chave pagadora>", "tipo": "SOLICITACAO", "status": "NAO_REALIZADO",
  "valor": "15.00", "horario": null, "infoPagador": "…",
  "gnExtras": { "idEnvio": "…", "erro": { "codigo": "EFIERR", "origem": "PSP do usuário pagador",
  "motivo": "Erro interno no processamento do pagamento instantâneo. Tente novamente mais tarde" } } } ] }
```

**Devolução de um Pix pago:**

- Chega um aviso a cada devolução, com o mesmo `endToEndId`, `status: "REALIZADO"` e a lista
  `devolucoes` acumulada.
- Cada devolução traz `id`, `rtrId`, `valor`, `natureza: "ORIGINAL"`, `horario.liquidacao` e
  `status: "DEVOLVIDO"`.
- Não tem `txid`, então o tratamento atual de Pix recebido ignora esses avisos.

`chave` é sempre a chave **pagadora** da empresa, o que permite conferir a conta emissora.

## Consequências para a implementação

- **Tarefa 3 (já corrigida):** `tipoConta` aceito passa a ser `cacc`, `svgs` e `tran`. `slry` sai da
  lista.
- **Tarefa 7:**
  - manter `idEnvio` = id do item sem hífens;
  - enviar sempre `favorecido.cpf` ou `favorecido.cnpj` junto da chave;
  - **201 com `NAO_REALIZADO` é falha imediata**, sem esperar webhook;
  - `json_invalido` e os códigos acima são falhas sem débito;
  - `id_envio_duplicado` significa já processado: consultar por `idEnvio`, nunca dar como falha;
  - **não conferir saldo em homologação** (sempre zero);
  - motivos em PT-BR a partir de `nome`/`mensagem` e de `gnExtras.erro.motivo`.
- **Tarefa 8:**
  - ramo `tipo: "SOLICITACAO"` com `gnExtras.idEnvio` no webhook Pix;
  - conferir `chave` contra a `pixKey` da identidade fotografada;
  - avisos repetidos e fora de ordem são idempotentes;
  - devoluções (`devolucoes` com `status: "DEVOLVIDO"`) precisam de tratamento próprio, porque o Pix
    continua `REALIZADO` mas o dinheiro voltou para a empresa.
- **Verificação de `UNCERTAIN`:** a consulta por `idEnvio` não traz o motivo de uma recusa. Item
  conciliado por consulta fica com "recusado pelo banco (motivo não informado)". A documentação da
  Efí também confirma que reenviar com o mesmo `idEnvio` é idempotente. Na prática, depois de
  processado, a resposta é `id_envio_duplicado`.
- **Liberação pelo admin:** a resposta do token lista os escopos, então a prontidão pode exigir
  `pix.send` e `gn.pix.send.read`.
- **Comprovante:** indisponível em homologação. A tela precisa tratar o erro sem quebrar.

## Não validado (o sandbox não reproduz)

- `403 insufficient_scope`: todos os escopos estavam liberados.
- `429 balde_fichas_vazio` com `Retry-After`.
- Respostas 5xx ou timeout no envio.
- Devoluções por fraude (`natureza` MED).
- Comprovante em PDF.

Ficam cobertos por testes com a Efí simulada, seguindo a documentação.
