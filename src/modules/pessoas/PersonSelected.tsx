/* =============================================================================
   A pessoa ESCOLHIDA em "Contratos e pessoas" (07/11/2026): o que era a página da pessoa
   (PersonPage, até 07/11) dividido pela regra de navegação do app ("uma ficha por coisa"):
     - PersonFicha: a ficha CURTA ao lado da tabela: papéis, documento inteiro, contato, endereço,
       atraso, acesso ao portal, com os botões explícitos Editar pessoa, Novo contrato, Arquivar
       (ou Restaurar) e Limpar escolha;
     - PersonDetails: as abas de baixo: Financeiro (com os Chamados embaixo, quando ela presta
       serviço) | Histórico (só a equipe). Unidades, contratos, vagas e documentos dela estão na
       linha aberta da tabela (PeopleTable.tsx).
   Arquivar esconde a pessoa das listas sem apagar nada. É recusado enquanto ela "segura" algo:
   contrato vigente ou aguardando assinatura, fatia de dono vigente ou login no portal. A janela
   mostra o motivo ANTES do clique de confirmar.
   ============================================================================= */
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Archive, ArchiveRestore, FilePlus2, Pencil } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { Dialog } from '@/components/ui/Dialog'
import { Section } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { TabPanel, Tabs, type TabDef } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { MAINTENANCE_CATEGORY, MAINTENANCE_STATUS, PARTY_ROLE } from '@/data/labels'
import { getPerson, type PersonRow } from '@/data/views/contracts'
import { formatDate } from '@/lib/dates'
import { formatCEP, formatDocument, formatPhone } from '@/lib/documents'
import { formatBRL } from '@/lib/money'
import { plural } from '@/lib/text'
import { useListState } from '@/lib/useListState'
import { FichaFooter, FichaFrame, type FichaItem } from '@/modules/contratos/ui'
import { EntriesTab, HistoryTab, maintenanceColumns } from '@/modules/imoveis/tabs'
import { DetailsHeading } from '@/modules/imoveis/UnitPage'
import { PersonDialog } from './PersonDialog'
import { archivePerson, getPersonArchiveBlockers, listVendorRequests, personCounts, personHistory, type PersonCounts } from './repo'
import { RoleBadges } from './roles'

/** A leitura da pessoa escolhida (a ficha curta e os detalhes usam a mesma). */
export function usePersonView(personId: string | null) {
  const q = useRepo('pessoa', (sess) => getPerson(sess, personId!), [personId], { enabled: !!personId })
  // keepPreviousData mantém a pessoa anterior enquanto a nova chega: só vale se for ESTA.
  return { q, person: q.data && q.data.id === personId ? q.data : undefined }
}

/* ---------------------------------------------------------------- ficha curta */

export function PersonFicha({ person: p, error, onRetry, onClear, className }: { person: PersonRow | undefined; error: unknown; onRetry: () => void; onClear: () => void; className?: string }) {
  const s = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const archive = useRepoMutation(archivePerson, { silent: true })
  if (error && !p)
    return (
      <FichaFrame className={className} label="Pessoa não encontrada" eyebrow="Escolha" title="Pessoa não encontrada" sub="Ela não existe mais ou está fora do seu acesso." items={[]} footer={<FichaFooter onClear={onClear} />}>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Tentar de novo
        </Button>
      </FichaFrame>
    )
  if (!p) return <FichaFrame className={className} label="Pessoa escolhida" eyebrow="Pessoa escolhida" title={<Skeleton className="h-6 w-40" />} items={null} />

  const archived = !!p.deleted_at
  const canEdit = can(s, 'people:edit')
  const a = p.address
  const items: FichaItem[] = [
    { label: 'Papéis', value: <RoleBadges roles={p.roles} />, info: 'Proprietário, inquilino e fiador vêm das ligações com imóveis e contratos. Prestador, contato, zelador e síndico são marcados no cadastro.' },
    // Equipe do prédio pode não ter documento (cadastro rápido): sem "CPF" solto e vazio.
    { label: p.kind === 'PF' ? 'CPF' : 'CNPJ', value: p.document ? <span className="num">{formatDocument(p.document)}</span> : '' },
    { label: 'Telefone', value: p.phone ? <span className="num whitespace-nowrap">{formatPhone(p.phone)}</span> : '' },
    { label: 'E-mail', value: p.email },
    { label: 'Em atraso', value: p.overdue_cents > 0 ? <span className="num font-medium text-danger-fg">{formatBRL(p.overdue_cents)}</span> : <span className="text-muted">Nada em atraso</span>, info: 'Soma do que esta pessoa deve pagar, está em aberto e venceu antes de hoje.' },
    { label: 'Acesso ao portal', value: p.user_id ? 'Sim, tem login' : 'Não' },
    ...(p.tags.includes('vendor') ? [{ label: 'Serviços', value: p.vendor_categories.map((x) => MAINTENANCE_CATEGORY[x]).join(', ') }] : []),
    ...(a ? [{ label: 'Endereço', value: `${a.street}, ${a.number}${a.complement ? ` (${a.complement})` : ''} · ${a.district} · ${a.city}/${a.state} · CEP ${formatCEP(a.cep)}` }] : []),
    ...(p.notes ? [{ label: 'Observações', value: p.notes }] : []),
  ]
  return (
    <FichaFrame
      className={className}
      label={`Pessoa escolhida: ${p.name}`}
      eyebrow={`${p.kind === 'PF' ? 'Pessoa física' : 'Pessoa jurídica'} · cadastrada em ${formatDate(p.created_at.slice(0, 10))}`}
      title={p.name}
      sub={archived ? <Badge tone="danger">Arquivada</Badge> : undefined}
      aside={p.photo ? <img src={p.photo} alt={`Foto de ${p.name}`} className="size-12 shrink-0 rounded-full border border-border object-cover" /> : undefined}
      items={items}
      footer={
        <FichaFooter onClear={onClear}>
          {canEdit && archived && (
            <Button
              size="sm"
              variant="primary"
              icon={<ArchiveRestore className="size-4" aria-hidden="true" />}
              loading={archive.isPending}
              onClick={() => archive.mutate({ id: p.id, restore: true }, { onSuccess: () => toast.success(`Cadastro de ${p.name} restaurado.`) })}
            >
              Restaurar
            </Button>
          )}
          {canEdit && !archived && (
            <Button size="sm" icon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(true)}>
              Editar pessoa
            </Button>
          )}
          {!archived && !isPortal(s) && can(s, 'contracts:edit') && (
            <Button size="sm" icon={<FilePlus2 className="size-4" aria-hidden="true" />} onClick={() => void navigate({ to: '/contratos/novo' })}>
              Novo contrato
            </Button>
          )}
          {canEdit && !archived && (
            <Button size="sm" variant="ghost" icon={<Archive className="size-4" aria-hidden="true" />} onClick={() => setArchiving(true)}>
              Arquivar
            </Button>
          )}
        </FichaFooter>
      }
    >
      {editing && <PersonDialog person={p} onClose={() => setEditing(false)} />}
      {archiving && (
        <ArchiveDialog
          person={p}
          loading={archive.isPending}
          onClose={() => setArchiving(false)}
          onConfirm={() =>
            archive.mutate(
              { id: p.id },
              {
                onSuccess: () => {
                  setArchiving(false)
                  toast.success(`Cadastro de ${p.name} arquivado.`, { label: 'Desfazer', onClick: () => archive.mutate({ id: p.id, restore: true }) })
                },
              },
            )
          }
        />
      )}
    </FichaFrame>
  )
}

/* ---------------------------------------------------------------- abas: regra (testada em pessoas.test.ts) */

/** As listas que a aba Financeiro empilha. */
export type PersonSection = 'financeiro' | 'chamados'

/** Uma aba dos detalhes: o que o Tabs desenha e as seções que ela empilha. */
export interface PersonTab extends TabDef {
  sections: PersonSection[]
}

/**
 * As abas da pessoa escolhida (até 07/11 eram três; "Imóveis e contratos" virou a linha aberta da
 * tabela). Passo a passo:
 *   1. Financeiro junta os lançamentos e, para quem presta serviço, os chamados (o chamado é o
 *      trabalho, o lançamento é o pagamento dele). Com uma lista só, a aba tem o nome dela e a
 *      contagem; com as duas, "Financeiro e chamados", sem número (somar lançamento com chamado
 *      daria um número que não conta nada);
 *   2. Histórico, só para a equipe;
 *   3. sem nenhuma (a pessoa logada não vê financeiro, não é prestadora nem equipe), sem abas.
 */
export function personTabs(c: PersonCounts | undefined, show: { finance: boolean; requests: boolean; history: boolean }): PersonTab[] {
  const parts = [
    ...(show.finance ? [{ key: 'financeiro' as const, label: 'Financeiro', count: c?.entries }] : []),
    ...(show.requests ? [{ key: 'chamados' as const, label: 'Chamados', count: c?.requests }] : []),
  ]
  const tabs: PersonTab[] = []
  if (parts.length) {
    const label = parts.map((p, i) => (i === 0 ? p.label : p.label.toLowerCase())).join(' e ')
    tabs.push({ value: 'financeiro', label, count: parts.length === 1 ? parts[0].count : undefined, sections: parts.map((p) => p.key) })
  }
  if (show.history) tabs.push({ value: 'historico', label: 'Histórico', sections: [] })
  return tabs
}

/**
 * Qual aba abre: a pedida no endereço, se existe para esta pessoa; senão a primeira. O endereço é
 * dado de fora: valor estranho só cai no padrão. Os nomes da página antiga (chamados, imoveis...)
 * já foram traduzidos no redirecionamento (personRedirect, em contratos/endereco.ts).
 */
export function pickPersonTab(tabs: PersonTab[], asked: string | undefined): string | undefined {
  if (asked && tabs.some((t) => t.value === asked)) return asked
  return tabs[0]?.value
}

/* ---------------------------------------------------------------- detalhes (abas de baixo) */

export function PersonDetails({ person: p, tab, onTab, onClear }: { person: PersonRow; tab?: string; onTab: (t: string) => void; onClear: () => void }) {
  const s = useSession()
  const team = !isPortal(s)
  const counts = useRepo('pessoa:contagens', (sess) => personCounts(sess, p.id), [p.id])
  const c = counts.data
  const isVendor = p.tags.includes('vendor') || (c?.requests ?? 0) > 0
  // As abas dependem das contagens (que seção fica, que rótulo): por isso esperam elas chegarem.
  const tabs = personTabs(c, { finance: can(s, 'finance:view'), requests: isVendor && can(s, 'maintenance:view'), history: team })
  const current = pickPersonTab(tabs, tab)
  const money = tabs.find((t) => t.value === 'financeiro')?.sections ?? []
  if (!tabs.length || !current) return null
  return (
    <section className="flex flex-col gap-2" aria-label={`Detalhes de ${p.name}`}>
      <DetailsHeading title={`Detalhes de ${p.name}`} onClear={onClear} />
      {!c && !counts.error ? (
        <Skeleton className="h-64" />
      ) : (
        <Tabs value={current} onValueChange={onTab} tabs={tabs}>
          {/* O espaço entre as seções vai num div de dentro: o painel inativo do Radix fica no DOM com
              "hidden", e um "flex" no próprio painel venceria o hidden e mostraria a aba fechada. */}
          <TabPanel value="financeiro" className="pt-3">
            <div className="flex flex-col gap-4">
              {money.includes('financeiro') && (
                <TabSection alone={money.length === 1} title="Financeiro" info="Lançamentos em que a pessoa é quem paga (a receber) ou quem recebe (a pagar).">
                  <EntriesTab filter="person" id={p.id} storageKey="pessoa-financeiro" csvName="financeiro-pessoa.csv" baseTotal={c?.entries} />
                </TabSection>
              )}
              {money.includes('chamados') && (
                <TabSection alone={money.length === 1} title="Chamados" info="Chamados atribuídos à pessoa como prestadora de serviço.">
                  <VendorRequests personId={p.id} />
                </TabSection>
              )}
            </div>
          </TabPanel>
          {team && (
            <TabPanel value="historico" className="pt-3">
              <Section title="Histórico" info="Alterações no cadastro e nos contratos de que a pessoa é parte, com quem fez e quando.">
                <HistoryTab queryKey={`pessoa:${p.id}`} load={(sess) => personHistory(sess, p.id)} />
              </Section>
            </TabPanel>
          )}
        </Tabs>
      )}
    </section>
  )
}

/**
 * Seção dentro de uma aba que junta listas. Com mais de uma seção na aba, cada uma ganha título
 * (Section). Sozinha, fica sem moldura: o rótulo da aba já diz o que é, e o Financeiro traz
 * cartões de indicador que dentro de outro cartão virariam moldura em cima de moldura.
 */
function TabSection({ alone, title, info, children }: { alone: boolean; title: string; info: string; children: ReactNode }) {
  if (alone) return <>{children}</>
  return (
    <Section title={title} info={info}>
      {children}
    </Section>
  )
}

function VendorRequests({ personId }: { personId: string }) {
  const navigate = useNavigate()
  const list = useListState('pessoa-chamados')
  const q = useRepo('pessoa:chamados', (sess) => listVendorRequests(sess, personId, list.params), [personId, list.params])
  return (
    <div className="flex flex-col gap-3">
      <ListToolbar
        state={list}
        noun={['chamado', 'chamados']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        searchPlaceholder="Buscar por código, assunto ou unidade"
        filters={[{ key: 'status', label: 'Situação', options: Object.entries(MAINTENANCE_STATUS).map(([value, label]) => ({ value, label })) }]}
      />
      <DataTable
        caption="Chamados atribuídos à pessoa"
        columns={maintenanceColumns({ linkRequests: true, showUnit: true })}
        rows={q.data?.rows}
        rowKey={(r) => r.id}
        sort={list.sort}
        onSort={list.toggleSort}
        onRowClick={(r) => void navigate({ to: '/manutencao/$requestId', params: { requestId: r.id } })}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState title="Nenhum chamado" description={list.activeFilterCount ? 'Nenhum chamado passa nos filtros ligados.' : 'Chamados atribuídos a esta pessoa como prestadora aparecem aqui.'} />}
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
    </div>
  )
}

/* ---------------------------------------------------------------- arquivar */

function ArchiveDialog({ person, loading, onClose, onConfirm }: { person: PersonRow; loading: boolean; onClose: () => void; onConfirm: () => void }) {
  const q = useRepo('pessoa:bloqueios', (sess) => getPersonArchiveBlockers(sess, person.id), [person.id])
  const reasons = useMemo(() => {
    if (!q.data) return []
    const out: string[] = []
    if (q.data.contracts.length) {
      const list = q.data.contracts.slice(0, 6).map((k) => `${k.code} (${PARTY_ROLE[k.role].toLowerCase()})`).join(', ')
      out.push(`${plural(q.data.contracts.length, 'contrato vigente ou aguardando assinatura', 'contratos vigentes ou aguardando assinatura')}: ${list}${q.data.contracts.length > 6 ? '...' : ''}. Encerre ou rescinda antes.`)
    }
    if (q.data.units) out.push(`É dona de ${plural(q.data.units, 'fatia de imóvel', 'fatias de imóvel')} hoje. Passe as fatias para outra pessoa antes.`)
    if (q.data.hasLogin) out.push('Tem acesso ao portal. Desative o acesso em Configurações antes.')
    return out
  }, [q.data])
  const blocked = reasons.length > 0
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={blocked ? 'Não dá para arquivar ainda' : `Arquivar ${person.name}?`}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{blocked ? 'Fechar' : 'Cancelar'}</Button>
          {!blocked && (
            <Button variant="danger" loading={loading} disabled={!q.data} onClick={onConfirm} icon={<Archive className="size-4" aria-hidden="true" />}>
              Arquivar
            </Button>
          )}
        </>
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-20" />
      ) : blocked ? (
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">A pessoa sai das listas e das buscas. Contratos antigos, pagamentos e histórico continuam guardados, e dá para desfazer.</p>
      )}
    </Dialog>
  )
}
