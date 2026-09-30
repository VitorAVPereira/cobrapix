# Diagnóstico do alerta Google Safe Browsing

Data: 30/09/2026. Verificação somente leitura de uma página de pagamento indicada pelo operador. Este documento não contém o token, identificadores da cobrança, dados pessoais ou instrumentos de pagamento.

## Evidências disponíveis

- O Chrome do operador mostrou o alerta de site perigoso ao abrir um link válido de pagamento.
- O Search Console confirmou a categoria **Páginas enganosas**, sem URLs de amostra (`N/D`).
- No mesmo Chrome, o operador abriu `/pagar/teste` e recebeu a página normal de link indisponível, sem alerta.
- Até esta verificação, o operador havia testado apenas um link válido. Não está confirmado se outros links de cobranças também são sinalizados.

## O que foi verificado no link afetado

| Verificação | Resultado |
| --- | --- |
| Formato do link | HTTPS, domínio `www.ciframais.com.br`, rota `/pagar/[token]` |
| Tipo de token no código | Payload assinado com finalidade `invoice-payment`; não cria sessão de login |
| Resposta da página | HTTP 200, sem redirecionamento nessa consulta |
| Resposta da API pública | HTTP 200, modalidade `PIX`, estado `PAYABLE`, `canPay=true` |
| Conteúdo apresentado | Página de cobrança com Pix copia e cola |
| Formulário com campo de senha | Ausente no HTML consultado |
| Iframes e redirecionamento por meta refresh | Ausentes no HTML consultado |
| Scripts declarados no HTML | Dez arquivos estáticos do próprio domínio, em `/_next/static/` |
| Links de boleto/PDF | Ausentes nessa cobrança |
| Domínio da URL dinâmica contida no Pix | `qrcodespix.sejaefi.com.br`; o endpoint bancário não foi acessado |
| Cache e referência | `no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` |
| Perfis HTTP simulados | Windows/Chrome e Android/Chrome receberam HTML idêntico |

Os perfis HTTP simulados não executam a Navegação Segura do Chrome e não reproduzem o contexto completo dos navegadores do operador. A resposta HTTP normal não significa que o Google tenha removido sua classificação.

## Conclusão e limites

A classificação do Google está confirmada. O motivo específico não foi divulgado no relatório. Não foi encontrada falha de validação do token nem redirecionamento inesperado no caminho consultado. A comparação com `/pagar/teste` não isola o token como causa, pois o conteúdo renderizado também muda quando uma cobrança válida é carregada.

Uma classificação indevida é uma possibilidade, não uma conclusão comprovada. Esta verificação não constitui auditoria completa do site, dos scripts executados em navegador, de todas as cobranças, dos acessos à Vercel ou do destinatário bancário. Não houve pagamento, emissão, mudança de configuração ou envio de pedido de revisão ao Google.

O uso de link assinado, por si só, não foi identificado como defeito nesta investigação. Não há fundamento nos resultados para remover sua proteção ou mudar o endereço com o objetivo de contornar o alerta.

## Próximo procedimento

1. Conferir na Vercel se a publicação de produção e os acessos administrativos são reconhecidos pelo responsável. Investigar mudanças desconhecidas antes de declarar problemas corrigidos.
2. Corrigir qualquer conteúdo enganoso ou comprometimento que seja encontrado. A identificação da plataforma e da empresa responsável pela cobrança deve ser clara ao pagador.
3. Caso não seja identificado conteúdo enganoso após essas verificações, solicitar reavaliação como possível classificação indevida no relatório **Problemas de segurança**. O Google prevê esse procedimento mesmo quando não fornece URLs de amostra.
4. Descrever apenas verificações e correções efetivamente realizadas. Não declarar remoção de malware ou auditoria integral sem evidência.
5. Aguardar a decisão do Google e testar novamente o endereço afetado. Não há prazo garantido; não reenviar pedidos repetidamente enquanto a revisão estiver pendente.

Referências: [orientação para engenharia social e serviços de terceiros](https://developers.google.com/search/docs/monitor-debug/security/social-engineering) e [relatório de problemas de segurança](https://support.google.com/webmasters/answer/9044101?hl=pt-BR).

## Texto-base para o responsável usar na revisão

> Sou responsável por ciframais.com.br, plataforma de gestão de cobranças. O Search Console indica “Páginas enganosas”, sem URLs de amostra. Observamos o alerta do Chrome em um link válido da rota /pagar/.
>
> A página usa um token assinado, restrito à consulta de uma cobrança; não cria sessão nem solicita credenciais bancárias do pagador. Na verificação do link afetado, a página e a API responderam HTTP 200. O HTML apresentou o Pix, sem formulário de senha, iframe ou redirecionamento inesperado. Os scripts declarados nesse HTML pertencem ao próprio domínio. Consultas com perfis HTTP de computador e celular retornaram conteúdo idêntico.
>
> Não identificamos conteúdo enganoso nessa verificação limitada da rota. Solicitamos a reavaliação da classificação. Caso persista, pedimos exemplos de URLs ou informações adicionais que permitam localizar o conteúdo responsável.

Acrescentar ao texto os resultados da conferência da Vercel e eventuais correções somente depois de realizados. Não incluir tokens de acesso, código Pix, dados pessoais ou uma afirmação de que todos os problemas foram corrigidos sem confirmação.
