---
name: nextjs-frontend
description: Acionada ao desenvolver componentes, páginas, rotas ou hooks na pasta front-cobranca utilizando Next.js App Router e React.
---
# Next.js (App Router) Rules
- Separe claramente Client Components (usando a diretiva `"use client"`) de Server Components.
- Mantenha o estado local no Client e o consumo de dados através da classe centralizada `api-client.ts`.
- Evite o uso de `useEffect` desnecessários; prefira derivar estados ou usar reatividade nativa do React 18+.
- Construa a interface utilizando TailwindCSS. O design deve ser altamente responsivo, focado na UX de um lojista ou atendente.
- Tratamento de Erros: Sempre faça parse dos erros HTTP vindos da API e exiba mensagens amigáveis ao invés de códigos técnicos.