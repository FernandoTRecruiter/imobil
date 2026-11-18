// Testes de Configurações: último administrador e o próprio acesso, convites, permissões do
// colaborador, carteiras, situações e cores (contraste), dados da empresa e auditoria só do admin.
// Rodar: npx vitest run src/modules/configuracoes
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession } from '@/auth/session'
import { AccessError } from '@/data/api'
import { ORG, USER } from '@/data/seed'
import { getDb, resetForTest, upsertRows } from '@/data/store'
import type { Membership } from '@/data/types'
import {
  contrastRatio, deletePortfolio, inviteUser, listAudit, listInvitations, listStatusConfig, normalizePermissions, revokeInvitation, saveCompany, savePortfolio,
  saveStaffPermissions, saveStatusConfig, setMemberStatus,
} from './repo'
import { resolveSettingsTab, settingsTabs } from './SettingsPage'

const TODAY = '2026-11-04'
const session = (userId: string) => {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}
const membershipOf = (userId: string, orgId: string = ORG.agency) => getDb().memberships.find((m) => m.user_id === userId && m.organization_id === orgId)!
beforeEach(() => {
  resetForTest(TODAY)
})

describe('usuários: desativar e reativar', () => {
  it('não desativa o último administrador ativo (nem a dona da conta de proprietário)', async () => {
    const ana = session(USER.admin)
    await expect(setMemberStatus(ana, { id: membershipOf(USER.admin).id, status: 'disabled' })).rejects.toThrow(/último administrador ativo/)
    const marina = session(USER.landlord)
    await expect(setMemberStatus(marina, { id: membershipOf(USER.landlord, ORG.landlord).id, status: 'disabled' })).rejects.toThrow(/último administrador ativo/)
  })

  it('com outro administrador, a trava passa a ser "não desativa a si mesmo"', async () => {
    const extra: Membership = { ...membershipOf(USER.staff), id: 'm-admin-extra', role: 'admin', permissions: [] }
    upsertRows('memberships', [extra])
    const ana = session(USER.admin)
    await expect(setMemberStatus(ana, { id: membershipOf(USER.admin).id, status: 'disabled' })).rejects.toThrow(/não pode desativar o próprio acesso/)
  })

  it('desativa e reativa um colaborador, com auditoria do antes e depois', async () => {
    const ana = session(USER.admin)
    const bruno = membershipOf(USER.staff)
    await setMemberStatus(ana, { id: bruno.id, status: 'disabled' })
    expect(membershipOf(USER.staff).status).toBe('disabled')
    const log = getDb().audit_logs.find((a) => a.entity === 'memberships' && a.entity_id === bruno.id)
    expect(log?.changes?.status).toEqual({ from: 'active', to: 'disabled' })
    // Desativado não entra: a sessão dele não se monta mais nesta conta.
    expect(buildSession(getDb(), USER.staff)).toBeNull()
    await expect(setMemberStatus(ana, { id: bruno.id, status: 'disabled' })).rejects.toThrow(/já está desativado/)
    await setMemberStatus(ana, { id: bruno.id, status: 'active' })
    expect(membershipOf(USER.staff).status).toBe('active')
  })

  it('colaborador e outra conta não mexem em usuários', async () => {
    await expect(setMemberStatus(session(USER.staff), { id: membershipOf(USER.owner).id, status: 'disabled' })).rejects.toThrow(AccessError)
    await expect(setMemberStatus(session(USER.landlord), { id: membershipOf(USER.staff).id, status: 'disabled' })).rejects.toThrow(AccessError)
  })
})

describe('convites', () => {
  it('portal exige pessoa que combina com o papel; pendente repetido é recusado; revogar tira da lista', async () => {
    const ana = session(USER.admin)
    await expect(inviteUser(ana, { email: 'novo@example.com', role: 'owner', person_id: null })).rejects.toThrow(/ligue o convite a uma pessoa/)
    const vendor = getDb().people.find((p) => p.organization_id === ORG.agency && p.tags.includes('vendor') && !p.user_id)!
    await expect(inviteUser(ana, { email: 'novo@example.com', role: 'owner', person_id: vendor.id })).rejects.toThrow(/não é proprietário de nenhum imóvel/)
    const inv = await inviteUser(ana, { email: 'Prestador.Novo@Example.com', role: 'vendor', person_id: vendor.id })
    expect(inv.email).toBe('prestador.novo@example.com')
    await expect(inviteUser(ana, { email: 'prestador.novo@example.com', role: 'vendor', person_id: vendor.id })).rejects.toThrow(/Já existe convite pendente/)
    expect((await listInvitations(ana)).some((i) => i.id === inv.id)).toBe(true)
    await revokeInvitation(ana, inv.id)
    expect((await listInvitations(ana)).some((i) => i.id === inv.id)).toBe(false)
    expect(getDb().audit_logs.some((a) => a.entity === 'invitations' && a.entity_id === inv.id && a.summary.startsWith('Revogou'))).toBe(true)
  })

  it('e-mail que já tem o mesmo papel ativo não recebe convite; conta de proprietário não convida colaborador', async () => {
    const ana = session(USER.admin)
    await expect(inviteUser(ana, { email: 'bruno.teixeira@example.com', role: 'staff', person_id: null })).rejects.toThrow(/já é colaborador com acesso ativo/)
    await expect(inviteUser(session(USER.landlord), { email: 'ajudante@example.com', role: 'staff', person_id: null })).rejects.toThrow(/Conta de proprietário não convida colaborador/)
  })
})

describe('papéis e permissões', () => {
  it('"Editar" traz "Ver" junto; configurações nunca vão para colaborador; auditoria guarda o antes e depois', async () => {
    expect(normalizePermissions(['properties:edit'])).toEqual(['properties:view', 'properties:edit'])
    const ana = session(USER.admin)
    const bruno = membershipOf(USER.staff)
    await expect(saveStaffPermissions(ana, { changes: [{ membershipId: bruno.id, permissions: [...bruno.permissions, 'settings:manage'] }] })).rejects.toThrow(/só do administrador/)
    await expect(saveStaffPermissions(ana, { changes: [{ membershipId: membershipOf(USER.admin).id, permissions: [] }] })).rejects.toThrow(/vale só para colaborador/)
    await saveStaffPermissions(ana, { changes: [{ membershipId: bruno.id, permissions: [...bruno.permissions, 'data:import', 'people:edit'] }] })
    const after = membershipOf(USER.staff)
    expect(after.permissions).toEqual(expect.arrayContaining(['data:import', 'people:edit', 'people:view']))
    const log = getDb().audit_logs.find((a) => a.entity === 'memberships' && a.entity_id === bruno.id && a.action === 'update')
    expect(log?.summary).toMatch(/\+Dados: importar e editar em massa/)
    expect(log?.changes?.permissions).toBeTruthy()
    // A permissão vale na sessão seguinte do colaborador.
    expect(session(USER.staff).permissions.has('data:import')).toBe(true)
  })
})

describe('situações e cores', () => {
  it('contraste com o branco pela fórmula da WCAG', () => {
    expect(contrastRatio('#ffffff')).toBe(1)
    expect(contrastRatio('#000000')).toBe(21)
    expect(contrastRatio('#3a5cf0')).toBeGreaterThan(4.5)
    expect(contrastRatio('#fbbf24')).toBeLessThan(3) // amarelo claro: o aviso aparece
  })
  it('grava rótulo e cor com id fixo (sem linha repetida) e audita', async () => {
    const ana = session(USER.admin)
    const rows = await listStatusConfig(ana)
    expect(rows.map((r) => r.status)).toEqual(['available', 'occupied', 'reserved', 'maintenance', 'blocked'])
    await saveStatusConfig(ana, rows.map((r) => (r.status === 'reserved' ? { ...r, label: 'Reservada (proposta)', color: '#FBBF24' } : r)))
    const mine = getDb().unit_status_config.filter((c) => c.organization_id === ORG.agency)
    expect(mine).toHaveLength(5)
    expect(mine.find((c) => c.status === 'reserved')).toMatchObject({ id: `${ORG.agency}:reserved`, label: 'Reservada (proposta)', color: '#fbbf24' })
    expect(getDb().audit_logs.some((a) => a.entity === 'unit_status_config' && a.changes?.color)).toBe(true)
    // A outra conta não é afetada.
    expect(getDb().unit_status_config.find((c) => c.organization_id === ORG.landlord && c.status === 'reserved')?.label).toBe('Reservada')
    await expect(saveStatusConfig(ana, rows.map((r) => ({ ...r, label: 'Igual' })))).rejects.toThrow(/mesmo rótulo/)
  })
})

describe('carteiras e empresa', () => {
  it('não exclui carteira com imóvel; recusa nome repetido; cria e exclui a vazia', async () => {
    const ana = session(USER.admin)
    const res = getDb().portfolios.find((p) => p.name === 'Residencial')!
    await expect(deletePortfolio(ana, res.id)).rejects.toThrow(/tem \d+ imóveis: mova-os/)
    await expect(savePortfolio(ana, { id: null, name: 'residencial', color: '#123456' })).rejects.toThrow(/Já existe a carteira/)
    const nova = await savePortfolio(ana, { id: null, name: 'Luxo', color: '#7C3AED' })
    await deletePortfolio(ana, nova.id)
    expect(getDb().portfolios.some((p) => p.id === nova.id)).toBe(false)
    await expect(savePortfolio(session(USER.landlord), { id: null, name: 'Minha', color: '#123456' })).rejects.toThrow(/não usa carteiras/)
  })
  it('documento inválido é recusado com a causa; salvar audita o antes e depois', async () => {
    const ana = session(USER.admin)
    const org = getDb().organizations.find((o) => o.id === ORG.agency)!
    const base = { name: org.name, document: org.document, timezone: org.timezone, brand_color: org.brand_color }
    await expect(saveCompany(ana, { ...base, document: '11.222.333/0001-80' })).rejects.toThrow(/CNPJ inválido: dígito verificador não confere/)
    await expect(saveCompany(ana, { ...base, brand_color: 'azul' })).rejects.toThrow(/#RRGGBB/)
    await saveCompany(ana, { ...base, name: 'Imobiliária Aurora Centro', timezone: 'America/Manaus' })
    const after = getDb().organizations.find((o) => o.id === ORG.agency)!
    expect(after).toMatchObject({ name: 'Imobiliária Aurora Centro', timezone: 'America/Manaus', plan: org.plan })
    const log = getDb().audit_logs.find((a) => a.entity === 'organizations')
    expect(log?.changes?.name).toEqual({ from: org.name, to: 'Imobiliária Aurora Centro' })
  })
})

describe('auditoria', () => {
  it('só o administrador vê; filtros por ação, quem e período; só a própria conta', async () => {
    await expect(listAudit(session(USER.staff), {})).rejects.toThrow(AccessError)
    const ana = session(USER.admin)
    const all = await listAudit(ana, { pageSize: 10_000 })
    expect(all.totalAll).toBeGreaterThan(0)
    expect(all.rows.every((r) => r.organization_id === ORG.agency)).toBe(true)
    const imports = await listAudit(ana, { filters: { action: ['import'] }, pageSize: 100 })
    expect(imports.rows.some((r) => r.entity === 'import_batches' && /planilha-vagas-lynx/.test(r.summary))).toBe(true)
    expect(all.facets.action.import).toBe(imports.total)
    const week = await listAudit(ana, { filters: { period: ['7'] }, pageSize: 10_000 })
    expect(week.total).toBeLessThan(all.total)
    expect(all.actors.some((a) => a.label === 'Ana Ribeiro')).toBe(true)
  })
})

describe('abas da tela (sete viraram quatro em 06/11)', () => {
  it('aba antiga lembrada no navegador cai na aba que a recebeu; valor estranho abre Empresa', () => {
    const tabs = settingsTabs(true)
    expect(tabs.map((t) => t.label)).toEqual(['Empresa', 'Usuários e permissões', 'Carteiras e situações', 'Auditoria'])
    expect(resolveSettingsTab('aparencia', tabs)).toBe('empresa')
    expect(resolveSettingsTab('usuarios', tabs)).toBe('usuarios-permissoes')
    expect(resolveSettingsTab('papeis', tabs)).toBe('usuarios-permissoes')
    expect(resolveSettingsTab('carteiras', tabs)).toBe('carteiras-situacoes')
    expect(resolveSettingsTab('situacoes', tabs)).toBe('carteiras-situacoes')
    expect(resolveSettingsTab('auditoria', tabs)).toBe('auditoria')
    expect(resolveSettingsTab(null, tabs)).toBe('empresa')
    expect(resolveSettingsTab('inexistente', tabs)).toBe('empresa')
  })

  it('na conta de proprietário as quatro abas ficam, com o nome só do que ela mostra', () => {
    const tabs = settingsTabs(false)
    expect(tabs.map((t) => t.label)).toEqual(['Empresa', 'Usuários', 'Situações e cores', 'Auditoria'])
    // "Carteiras" lembrada da conta de imobiliária abre a aba das situações, que existe aqui.
    expect(resolveSettingsTab('carteiras', tabs)).toBe('carteiras-situacoes')
  })
})
