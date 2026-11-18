/* =============================================================================
   documents.ts: CPF, CNPJ, CEP e telefone.

   A validação confere o DÍGITO VERIFICADOR (os 2 últimos números, calculados a partir
   dos outros). Ela pega erro de digitação; não prova que o documento existe na Receita.

   CNPJ ALFANUMÉRICO: desde julho de 2026 a Receita emite CNPJ com letras nas 12 primeiras
   posições (os 2 dígitos verificadores seguem números). Por isso o CNPJ aqui guarda
   dígitos E letras maiúsculas, e cada caractere vale (código ASCII - 48): '0'..'9' = 0..9,
   'A' = 17, 'B' = 18... É a mesma conta antiga para quem só tem números.
   ============================================================================= */

/** Tira pontuação e espaço; deixa só 0-9 e A-Z (letra vira maiúscula). */
export function normalizeDocument(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export function onlyDigits(input: string): string {
  return input.replace(/\D/g, '')
}

export function isValidCPF(input: string): boolean {
  const c = onlyDigits(input)
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false // 111.111.111-11 passa na conta mas não vale
  const dv = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10])
}

function cnpjCheckDigit(base: string): number {
  // Pesos de 2 a 9, da direita para a esquerda, recomeçando em 2 depois do 9.
  let sum = 0
  let w = 2
  for (let i = base.length - 1; i >= 0; i--) {
    sum += (base.charCodeAt(i) - 48) * w
    w = w === 9 ? 2 : w + 1
  }
  const r = sum % 11
  return r < 2 ? 0 : 11 - r
}

export function isValidCNPJ(input: string): boolean {
  const c = normalizeDocument(input)
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false
  const d1 = cnpjCheckDigit(c.slice(0, 12))
  const d2 = cnpjCheckDigit(c.slice(0, 12) + d1)
  return d1 === Number(c[12]) && d2 === Number(c[13])
}

/** CPF (11) ou CNPJ (14): escolhe a regra pelo tamanho. */
export function isValidDocument(input: string): boolean {
  const c = normalizeDocument(input)
  if (c.length === 11) return isValidCPF(c)
  if (c.length === 14) return isValidCNPJ(c)
  return false
}

/** Mensagem que diz a causa e o conserto (regra de formulário da casa). */
export function documentError(input: string): string | null {
  const c = normalizeDocument(input)
  if (!c) return 'Informe o CPF ou CNPJ.'
  if (c.length !== 11 && c.length !== 14) return `Tem ${c.length} caracteres: CPF tem 11 e CNPJ tem 14.`
  if (c.length === 11 && !/^\d+$/.test(c)) return 'CPF só tem números.'
  return isValidDocument(c) ? null : `${c.length === 11 ? 'CPF' : 'CNPJ'} inválido: dígito verificador não confere.`
}

export function formatDocument(input: string): string {
  const c = normalizeDocument(input)
  if (c.length === 11) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`
  if (c.length === 14) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
  return input
}

/** Esconde o miolo do documento em telas de demonstração e listas: ***.456.789-** */
export function maskDocument(input: string): string {
  const f = formatDocument(input)
  if (f.length === 14) return `***.${f.slice(4, 11)}-**`
  if (f.length === 18) return `**.${f.slice(3, 10)}/****-**`
  return f
}

export function formatCEP(input: string): string {
  const c = onlyDigits(input)
  return c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : input
}

export function formatPhone(input: string): string {
  const c = onlyDigits(input)
  if (c.length === 11) return `(${c.slice(0, 2)}) ${c.slice(2, 7)}-${c.slice(7)}`
  if (c.length === 10) return `(${c.slice(0, 2)}) ${c.slice(2, 6)}-${c.slice(6)}`
  return input
}

/** Gera CPF válido a partir de 9 dígitos (usado só pelos dados fictícios). */
export function cpfFromBase(base9: string): string {
  let c = base9
  for (const len of [9, 10]) {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i)
    const r = (sum * 10) % 11
    c += String(r === 10 ? 0 : r)
  }
  return c
}

/** Gera CNPJ válido a partir de 12 caracteres (usado só pelos dados fictícios). */
export function cnpjFromBase(base12: string): string {
  const d1 = cnpjCheckDigit(base12)
  return base12 + d1 + cnpjCheckDigit(base12 + d1)
}
