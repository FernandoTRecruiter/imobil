// Testes do Início do portal: cada pessoa vê só o que é dela, e o que pede ação dela aparece.
// Rodar: npx vitest run src/modules/portal
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { AccessError } from '@/data/api'
import type { Db } from '@/data/db'
import { USER } from '@/data/seed'
import { resetForTest } from '@/data/store'
import { saveAnnouncement } from '@/modules/comunicacao/repo'
import { getPortalHome } from './repo'

const TODAY = '2026-11-04'
let db: Db
beforeEach(() => {
  db = resetForTest(TODAY)
})

function session(userId: string): Session {
  const s = buildSession(db, userId)!
  s.today = TODAY
  return s
}

describe('Início do portal', () => {
  it('proprietário: as 4 unidades dele, os orçamentos delas e a renovação da A-301 esperando o "sim"', async () => {
    const home = await getPortalHome(session(USER.owner))
    expect(home.lessee).toBeNull()
    expect(home.owner?.units).toBe(4)
    // Os 2 casos fixos (A-301 e a Casa 07, que ele divide com a esposa): todos nas unidades dele.
    const codes = new Set(home.owner?.quotes.map((q) => q.unit_code))
    expect(codes).toEqual(new Set(['A-301', 'Casa 07']))
    expect(home.owner?.quotes.every((q) => q.status === 'awaiting_owner')).toBe(true)
    expect(home.owner?.approvals).toHaveLength(1)
    expect(home.owner?.approvals[0].title).toContain('(A-301)')
    expect(home.owner?.upcomingEnds.every((k, i, all) => i === 0 || all[i - 1].end_date <= k.end_date)).toBe(true)
  })
  it('inquilina: o contrato da B-203 (não o da vaga), só as cobranças dela e o chamado em triagem', async () => {
    const s = session(USER.lessee)
    const home = await getPortalHome(s)
    // Ela também aluga a vaga E-014: o contrato do Início é o da moradia; a cobrança da vaga entra na lista dela.
    expect(home.lessee?.contract?.unit_code).toBe('B-203')
    expect(home.lessee?.openEntries.some((e) => e.unit_code === 'E-014')).toBe(true)
    expect(home.lessee?.openEntries.every((e) => e.person_id === s.personId && e.direction === 'receivable')).toBe(true)
    expect(home.lessee?.requests.some((r) => r.status === 'triage')).toBe(true)
    expect(home.lessee?.requests.every((r) => r.unit_code === 'B-203')).toBe(true)
  })
  it('prestador: só os chamados atribuídos a ele, com o endereço', async () => {
    const s = session(USER.vendor)
    const home = await getPortalHome(s)
    expect(home.vendor?.requests.length).toBeGreaterThan(0)
    expect(home.vendor?.requests.every((r) => r.vendor_person_id === s.personId && r.address.length > 0)).toBe(true)
  })
  it('comunicados: a inquilina vê o do prédio dela e o de todos, do mais novo ao mais antigo; o de outro prédio, não', async () => {
    const lynx = db.properties.find((p) => p.name === 'Lynx Residence')!
    await saveAnnouncement(session(USER.admin), { id: '', title: 'Pintura da fachada', body: 'A pintura da fachada começa na segunda.', audience: 'lessees', property_id: lynx.id, send: true })
    const daniela = await getPortalHome(session(USER.lessee))
    expect(daniela.announcements.map((a) => a.title)).toEqual(['Manutenção do elevador do Bloco B', 'Novo canal de atendimento'])
    expect(daniela.announcements[0].unread).toBe(true) // o aviso do elevador ainda não foi lido
    // O proprietário vê o de todos (público "inquilinos e proprietários"), não o do elevador (só inquilinos), nem o rascunho.
    expect((await getPortalHome(session(USER.owner))).announcements.map((a) => a.title)).toEqual(['Novo canal de atendimento'])
    expect((await getPortalHome(session(USER.vendor))).announcements).toEqual([])
  })
  it('a equipe não usa o Início do portal', async () => {
    await expect(getPortalHome(session(USER.admin))).rejects.toBeInstanceOf(AccessError)
  })
})
