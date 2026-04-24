---
name: bullmq-scaling
description: Acionada ao configurar filas de mensagens, workers, processors ou realizar disparos assíncronos de alta carga no backend.
---
# BullMQ Scalability Rules
- Carga de Pico: O sistema processará até 6.000 faturas de uma vez. Absolutamente NENHUM processamento externo pesado (disparos de WhatsApp, geração de PIX) pode ficar no Event Loop síncrono do NestJS.
- Tratamento de Falhas: Todos os Jobs adicionados à fila devem conter configuração obrigatória de `attempts` (mínimo 3) e `backoff` (atraso exponencial) para absorver quedas ou instabilidades na Evolution API.
- Idempotência Estrita: O Processor (`message.processor.ts`) não pode gerar duplicidade de cobrança caso o mesmo job seja reprocessado após um erro de timeout.
- Regra Anti-Ban: O disparo das tarefas para a Evolution API deve respeitar o Pacing de segurança (Rate Limit) para simular comportamento humano.