---
name: redis-optimization
description: Acionada ao interagir com instâncias do Redis, seja para configuração de Cache, filas do BullMQ ou estado da Evolution API.
---
# Redis Architecture Rules
- Isolamento de Bancos Lógicos: Garanta que o acesso ao Redis está perfeitamente isolado para economizar RAM do servidor.
  - Banco `/0` é reservado exclusivamente para a gestão de estado do BullMQ (NestJS).
  - Banco `/1` é reservado exclusivamente para o Cache e Controle de Sessão do WhatsApp (Evolution API).
- Prefixos: Utilize prefixos claros em chaves independentes para evitar colisão de dados no ecossistema de microsserviços.
- Gerenciamento de Conexão: Trate os eventos do driver `ioredis` para garantir que o sistema não trave permanentemente em caso de reinicialização do container do Redis.