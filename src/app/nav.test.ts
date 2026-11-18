// Testes do menu (07/11/2026): 7 itens para a equipe, "Contratos e pessoas" no lugar de Pessoas e Contratos,
// Documentos fora do menu, e os portais com o que precisam. Rodar: npx vitest run src/app
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession } from '@/auth/session'
import { USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import { isNavActive, navFor } from './nav'

beforeEach(() => {
  resetForTest('2026-11-04')
})

const labels = (userId: string) => navFor(buildSession(getDb(), userId)!).map((n) => n.label)

describe('menu', () => {
  it('a administradora vê os 7 itens, na ordem', () => {
    expect(labels(USER.admin)).toEqual(['Visão geral', 'Imóveis', 'Contratos e pessoas', 'Financeiro', 'Manutenção', 'Tarefas', 'Configurações'])
  })

  it('o colaborador da manutenção vê pessoas sem ver contratos: o item aparece para ele', () => {
    expect(labels(USER.maint)).toContain('Contratos e pessoas')
  })

  it('portais: "Meus contratos" no lugar de Documentos; o prestador não tem o item', () => {
    expect(labels(USER.owner)).toEqual(['Início', 'Meus imóveis', 'Meus contratos', 'Extratos e repasses', 'Chamados'])
    expect(labels(USER.lessee)).toEqual(['Início', 'Meus contratos', 'Cobranças', 'Chamados'])
    expect(labels(USER.vendor)).toEqual(['Início', 'Meus chamados'])
    for (const u of [USER.admin, USER.owner, USER.lessee]) expect(labels(u)).not.toContain('Documentos')
  })

  it('/pessoas (antes de redirecionar) marca "Contratos e pessoas"', () => {
    const item = navFor(buildSession(getDb(), USER.admin)!).find((n) => n.to === '/contratos')!
    expect(isNavActive(item, '/pessoas')).toBe(true)
    expect(isNavActive(item, '/contratos/novo')).toBe(true)
    expect(isNavActive(item, '/imoveis')).toBe(false)
  })
})
