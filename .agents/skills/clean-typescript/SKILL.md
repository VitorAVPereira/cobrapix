---
name: clean-typescript
description: Acionada ao escrever, refatorar ou revisar código TypeScript em qualquer parte do projeto. Não acionar para arquivos de configuração JSON/YAML.
---
# Clean TypeScript Rules
- STRICT MODE: É estritamente proibido o uso de `any`, `@ts-ignore` ou tipos implícitos. Toda variável, entrada e saída deve ser tipada.
- Interfaces e DTOs devem ser explícitos e rigorosamente validados usando `class-validator` (no backend).
- Retornos de funções e Promises devem ser tipados na assinatura do método.
- Aplique o princípio de responsabilidade única (SRP). Funções devem ser curtas, com nomes semânticos e sem efeitos colaterais ocultos.