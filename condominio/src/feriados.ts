/* =============================================================================
   Feriados, pontos facultativos e emendas: o MESMO cálculo de cond_dias_especiais no banco
   (supabase/schema.sql, seção 1b). Serve ao modo demonstração; em produção a tela pede ao banco.
   O teste tests/banco.test.ts compara os dois, ano a ano.
   Nada vem de serviço de fora: a lei dá as datas fixas e a Páscoa dá as móveis.
   ============================================================================= */
import type { FeriadoLocal } from './config'
import type { DiaEspecial } from './tipos'

const dois = (n: number) => String(n).padStart(2, '0')
const data = (ano: number, mes: number, dia: number) => `${ano}-${dois(mes)}-${dois(dia)}`
function soma(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diaSemana = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay()

/** Domingo de Páscoa (Meeus/Jones/Butcher). Igual a cond_pascoa. */
export function pascoa(ano: number): string {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return data(ano, Math.floor(n / 31), (n % 31) + 1)
}

const NACIONAIS: [number, number, string][] = [
  [1, 1, 'Confraternização Universal'],
  [4, 21, 'Tiradentes'],
  [5, 1, 'Dia do Trabalho'],
  [9, 7, 'Independência do Brasil'],
  [10, 12, 'Nossa Senhora Aparecida'],
  [11, 2, 'Finados'],
  [11, 15, 'Proclamação da República'],
  [11, 20, 'Dia da Consciência Negra'],
  [12, 25, 'Natal'],
]

export interface Ajuste {
  dia: string
  tipo: 'feriado' | 'facultativo' | 'normal'
  nome: string | null
}

/** Os dias especiais entre "de" e "ate" (inclusive), na ordem, com os ajustes do síndico por cima. */
export function diasEspeciais(de: string, ate: string, locais: FeriadoLocal[], ajustes: Ajuste[] = []): DiaEspecial[] {
  const base: DiaEspecial[] = []
  for (let ano = Number(de.slice(0, 4)); ano <= Number(ate.slice(0, 4)); ano++) {
    const p = pascoa(ano)
    for (const [mes, dia, nome] of NACIONAIS) base.push({ dia: data(ano, mes, dia), tipo: 'feriado', nome, origem: 'nacional' })
    for (const antes of [48, 47]) base.push({ dia: soma(p, -antes), tipo: 'facultativo', nome: 'Carnaval', origem: 'nacional' })
    for (const l of locais) {
      base.push({ dia: l.pascoa !== null ? soma(p, l.pascoa) : data(ano, l.mes!, l.dia!), tipo: 'feriado', nome: l.nome, origem: 'local' })
    }
  }
  // Um por dia; feriado vence ponto facultativo; empate pelo nome (como o "distinct on" do banco).
  base.sort((x, y) => x.dia.localeCompare(y.dia) || Number(y.tipo === 'feriado') - Number(x.tipo === 'feriado') || x.nome.localeCompare(y.nome))
  const unicos = base.filter((x, i) => i === 0 || base[i - 1].dia !== x.dia)
  const dias = new Set(unicos.map((u) => u.dia))
  // Emendas: terça puxa a segunda, quinta puxa a sexta.
  const emendas = new Map<string, DiaEspecial>()
  for (const u of [...unicos].sort((x, y) => x.nome.localeCompare(y.nome))) {
    const dow = diaSemana(u.dia)
    if (u.tipo !== 'feriado' || (dow !== 2 && dow !== 4)) continue
    const dia = soma(u.dia, dow === 2 ? -1 : 1)
    if (!dias.has(dia) && !emendas.has(dia)) emendas.set(dia, { dia, tipo: 'facultativo', nome: `Emenda de ${u.nome}`, origem: 'emenda' })
  }
  const ajustados = new Set(ajustes.map((a) => a.dia))
  const tudo = [...unicos, ...emendas.values()].filter((x) => x.dia >= de && x.dia <= ate && !ajustados.has(x.dia))
  for (const a of ajustes) {
    if (a.tipo !== 'normal' && a.dia >= de && a.dia <= ate) {
      tudo.push({ dia: a.dia, tipo: a.tipo, nome: a.nome ?? (a.tipo === 'feriado' ? 'Feriado' : 'Ponto facultativo'), origem: 'ajuste' })
    }
  }
  return tudo.sort((x, y) => x.dia.localeCompare(y.dia))
}
