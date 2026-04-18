/**
 * Teste de exemplo para demonstrar a estrutura de testes funcionando
 * Este teste valida configuração básica do Jest + React Testing Library
 */

import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

describe('Exemplo de Teste', () => {
  it('deve renderizar texto corretamente', () => {
    const TestComponent = () => <div>Texto de teste</div>
    render(<TestComponent />)
    expect(screen.getByText('Texto de teste')).toBeInTheDocument()
  })

  it('deve validar soma simples', () => {
    expect(2 + 2).toBe(4)
  })
})
