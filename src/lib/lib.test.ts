// Testes das regras puras: dinheiro, datas, documentos e busca.
// Rodar: npm test   (ou só este arquivo: npx vitest run src/lib/lib.test.ts)
import { describe, expect, it } from 'vitest'
import { applyPct, formatBRL, parseBRL, splitByShares } from './money'
import { addMonths, daysBetween, dueDateFor, formatDate, parseDateBR, todayIn } from './dates'
import { cnpjFromBase, cpfFromBase, documentError, formatDocument, isValidCNPJ, isValidCPF } from './documents'
import { matchesSearch, normalize } from './text'

describe('dinheiro em centavos', () => {
  it('formata em reais', () => {
    expect(formatBRL(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56')
  })
  it('lê o que vem de formulário e planilha', () => {
    expect(parseBRL('1.234,56')).toBe(123456)
    expect(parseBRL('R$ 1.234,56')).toBe(123456)
    expect(parseBRL('1234.5')).toBe(123450)
    expect(parseBRL('1.234.567')).toBe(123456700)
    expect(parseBRL('12,345')).toBe(1235) // terceira casa arredonda
    expect(parseBRL('abc')).toBeNull()
  })
  it('rateio fecha no centavo (R$ 1.000,01 em 50/50)', () => {
    const parts = splitByShares(100001, [50, 50])
    expect(parts).toEqual([50001, 50000])
    expect(parts[0] + parts[1]).toBe(100001)
  })
  it('rateio em três partes iguais não perde centavo', () => {
    const parts = splitByShares(10000, [1, 1, 1])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000)
  })
  it('percentual arredonda meio para cima', () => {
    expect(applyPct(150000, 10)).toBe(15000)
    expect(applyPct(12345, 10)).toBe(1235) // 1234,5 centavos vira 1235
  })
})

describe('datas sem fuso', () => {
  it('vencimento dia 31 cai no último dia de fevereiro e volta a 31 em março', () => {
    expect(dueDateFor('2026-02-01', 31)).toBe('2026-02-28')
    expect(dueDateFor('2028-02-01', 31)).toBe('2028-02-29')
    expect(dueDateFor('2026-03-01', 31)).toBe('2026-03-31')
  })
  it('soma de mês respeita mês curto', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
  })
  it('hoje é calculado no fuso de Brasília, não em UTC', () => {
    // 04/11/2026 às 23h30 em Brasília já é dia 05 em UTC.
    const now = new Date('2026-11-05T02:30:00Z')
    expect(todayIn('America/Sao_Paulo', now)).toBe('2026-11-04')
    expect(todayIn('UTC', now)).toBe('2026-11-05')
  })
  it('conta dias e lê data brasileira', () => {
    expect(daysBetween('2026-11-04', '2027-01-03')).toBe(60)
    expect(parseDateBR('04/11/2026')).toBe('2026-11-04')
    expect(parseDateBR('31/02/2026')).toBeNull()
    expect(formatDate('2026-11-04')).toBe('04/11/2026')
  })
})

describe('CPF e CNPJ', () => {
  it('CPF pelo dígito verificador', () => {
    expect(cpfFromBase('123456789')).toBe('12345678909')
    expect(isValidCPF('123.456.789-09')).toBe(true)
    expect(isValidCPF('123.456.789-08')).toBe(false)
    expect(isValidCPF('111.111.111-11')).toBe(false)
  })
  it('CNPJ numérico e alfanumérico (regra da Receita desde jul/2026)', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true)
    expect(isValidCNPJ('12.ABC.345/01DE-35')).toBe(true)
    expect(isValidCNPJ('12.ABC.345/01DE-34')).toBe(false)
    expect(cnpjFromBase('12ABC34501DE')).toBe('12ABC34501DE35')
  })
  it('mensagem diz a causa', () => {
    expect(documentError('1234567890')).toBe('Tem 10 caracteres: CPF tem 11 e CNPJ tem 14.')
    expect(documentError('12345678908')).toBe('CPF inválido: dígito verificador não confere.')
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81')
  })
})

describe('busca', () => {
  it('ignora acento e caixa e exige todos os termos', () => {
    expect(normalize('Ação')).toBe('acao')
    expect(matchesSearch('joao silva', ['João da Silva'])).toBe(true)
    expect(matchesSearch('joao souza', ['João da Silva'])).toBe(false)
  })
})
