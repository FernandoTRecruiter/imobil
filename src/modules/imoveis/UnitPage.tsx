/* =============================================================================
   A unidade DENTRO da ficha do imóvel (07/11/2026). Pedido do Fernando: "quando clico na unidade
   que quero, ela abre outra aba (página), não quero isso!". A unidade deixou de ter página
   própria; ela é escolhida no 3D ou na tabela do imóvel e aparece em dois lugares da mesma tela:
     - UnitFicha: o painel curto à direita do desenho (trilha, código e situação, tipo e área,
       locatário, dono, aluguel, fim do contrato; ações Editar, Arquivar e Limpar escolha);
     - UnitDetails: as abas de baixo (no máximo 3, nunca aba dentro de aba):
         Contratos e cobranças (pessoas com contato, contratos e financeiro) | Chamados |
         Histórico e documentos. Desde 07/11 o contrato da lista abre no lugar (partes e documentos,
         a mesma linha de "Contratos e pessoas") em vez de levar a outra página, e os documentos
         ganharam "Anexar documento" (a tela Documentos saiu do menu).
   O endereço antigo /unidades/<id> continua valendo para todo link do app (pessoa, contrato,
   financeiro): UnitRedirect lê a unidade e troca o endereço pela ficha do imóvel com ela escolhida
   (/imoveis/<imóvel>?unidade=<id>), trocando também o ?aba= antigo pelo novo (UNIT_OLD_TABS).
   Por que um componente e não um redirecionamento na rota (beforeLoad): achar o imóvel da unidade
   precisa da sessão (persona e escopo), que mora no React; a rota não tem a sessão.

   "Ocupada" não se escolhe: vem do contrato de locação vigente (rules.ts). Arquivar é recusado
   com locação vigente ou aguardando assinatura (o repositório confere).
   ============================================================================= */
import { useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import { Archive, ArchiveRestore, ChevronRight, FilePlus2, Pencil, X } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import type { Session } from '@/auth/session'
import { Badge, UnitStatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { Card, DescriptionList, Section } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, PageSkeleton, Skeleton } from '@/components/ui/States'
import { TabPanel, Tabs, type TabDef } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { PARTY_ROLE, UNIT_KIND } from '@/data/labels'
import { listMaintenance } from '@/data/views/finance'
import { getUnit, type UnitRow } from '@/data/views/units'
import { daysBetween, formatDate } from '@/lib/dates'
import { maskDocument, formatPhone } from '@/lib/documents'
import { formatBRL } from '@/lib/money'
import { plural } from '@/lib/text'
import { useListState } from '@/lib/useListState'
import { EditUnitDialog } from './dialogs'
import { archiveUnit, placeCounts, unitHistory } from './repo'
import { formatPct } from './schemas'
import { EntriesTab, HistoryTab, maintenanceColumns, PlaceDocumentsTab, resolveTab, TabBlock } from './tabs'
import { PlaceContracts } from '@/modules/contratos/ContractsTable'
import { getUnitLeaseParties } from '@/modules/contratos/repo'

/* ---------------------------------------------------------------- endereço antigo e abas */

/** As abas de baixo quando uma unidade está escolhida, na ordem. */
export const UNIT_TAB_VALUES = ['contratos', 'chamados', 'historico'] as const

/**
 * ?aba= de antes (da página da unidade, até 07/11/2026) para a aba de hoje. Link velho e endereço
 * guardado continuam abrindo o lugar certo; "resumo" e "pessoas" (dados e pessoas) caem na
 * primeira aba, onde as pessoas com contato ficam agora.
 */
export const UNIT_OLD_TABS: Record<string, string> = { resumo: 'contratos', pessoas: 'contratos', financeiro: 'contratos', manutencao: 'chamados', documentos: 'historico' }

/**
 * Para onde vai o endereço antigo /unidades/<id>?aba=...: a ficha do imóvel da unidade, com ela
 * escolhida e a aba traduzida (aba desconhecida fica de fora: a ficha abre na primeira).
 */
export function unitRedirect(u: Pick<UnitRow, 'id' | 'property_id'>, aba?: string): { propertyId: string; search: { unidade: string; aba?: string } } {
  const mapped = aba !== undefined && Object.hasOwn(UNIT_OLD_TABS, aba) ? UNIT_OLD_TABS[aba] : aba
  const known = (UNIT_TAB_VALUES as readonly string[]).includes(mapped ?? '')
  return { propertyId: u.property_id, search: known ? { unidade: u.id, aba: mapped } : { unidade: u.id } }
}

/** A rota /unidades/$unitId: lê a unidade (pelo escopo da sessão) e troca o endereço, sem deixar rastro no "voltar". */
export function UnitRedirect({ id, tab }: { id: string; tab?: string }) {
  return (
    <Guard action="properties:view" what="as unidades">
      <RedirectToProperty id={id} tab={tab} />
    </Guard>
  )
}

function RedirectToProperty({ id, tab }: { id: string; tab?: string }) {
  const q = useRepo('unidade', (sess) => getUnit(sess, id), [id])
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data || q.data.id !== id) return <PageSkeleton />
  const to = unitRedirect(q.data, tab)
  return <Navigate to="/imoveis/$propertyId" params={{ propertyId: to.propertyId }} search={to.search} replace />
}

/** As abas da unidade para esta pessoa. Com dois assuntos juntos a contagem sai (somar contrato com lançamento não conta nada). */
export function unitTabs(s: Session, counts?: { contracts: number; maintenance: number; documents: number }): TabDef[] {
  return [
    can(s, 'finance:view') ? { value: 'contratos', label: 'Contratos e cobranças' } : { value: 'contratos', label: 'Contratos', count: counts?.contracts },
    ...(can(s, 'maintenance:view') ? [{ value: 'chamados', label: 'Chamados', count: counts?.maintenance }] : []),
    !isPortal(s) ? { value: 'historico', label: 'Histórico e documentos' } : { value: 'historico', label: 'Documentos', count: counts?.documents },
  ]
}

/* ---------------------------------------------------------------- peças comuns às duas fichas */

/**
 * O cartão do painel curto (imóvel ou unidade): a mesma moldura dos cartões do app. A partir de
 * 1280 px ele tem a altura do desenho ao lado e rola por dentro.
 */
export function FichaCard({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Card className="flex flex-col gap-3 p-4 xl:max-h-full xl:overflow-y-auto">
      <section aria-label={label} className="flex flex-col gap-3">
        {children}
      </section>
    </Card>
  )
}

/** Título pequeno da área de detalhes ("Detalhes do imóvel", "Detalhes de Casa 09 · limpar"). */
export function DetailsHeading({ title, onClear }: { title: string; onClear?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h2 className="text-base font-medium">{title}</h2>
      {onClear && (
        <>
          <span className="text-muted" aria-hidden="true">
            ·
          </span>
          <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={onClear}>
            limpar
          </button>
        </>
      )}
    </div>
  )
}

/** Nome da unidade como a pessoa conhece: o código; casa avulsa leva o nome do imóvel; vaga externa, o código. */
export const unitTitle = (u: Pick<UnitRow, 'building_id' | 'zone' | 'code' | 'property_name'>) => (u.building_id || u.zone ? u.code : u.property_name)

/* ---------------------------------------------------------------- a ficha curta (painel ao lado do desenho) */

/**
 * A ficha curta da unidade escolhida. De cima para baixo: trilha (Imóveis › imóvel › bloco ›
 * andar › código), código e situação, tipo e área, até 7 linhas de dados e as ações. Os dados
 * vêm de getUnit (a mesma leitura de antes): depois de editar, a ficha se atualiza sozinha.
 */
export function UnitFicha({ unitId, onClear }: { unitId: string; onClear: () => void }) {
  const s = useSession()
  const team = !isPortal(s)
  const canEdit = can(s, 'properties:edit')
  const linkPeople = can(s, 'people:view')
  const navigate = useNavigate()
  const toast = useToast()
  const q = useRepo('unidade', (sess) => getUnit(sess, unitId), [unitId])
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const archive = useRepoMutation(archiveUnit, { silent: true })

  if (q.error)
    return (
      <FichaCard label="Ficha da unidade">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </FichaCard>
    )
  const u = q.data?.id === unitId ? q.data : undefined // a resposta da unidade anterior não vale
  if (!u) return <Skeleton className="h-full min-h-64" />
  const archived = !!u.deleted_at
  // "Nova locação" só para unidade disponível: ocupada, reservada ou em obra não se aluga agora.
  const canLease = can(s, 'contracts:edit') && !archived && u.status === 'available'
  const daysLeft = u.lease ? daysBetween(s.today, u.lease.end_date) : 0
  const meta = [UNIT_KIND[u.kind], `${u.area_m2.toLocaleString('pt-BR')} m²`, u.bedrooms > 0 ? plural(u.bedrooms, 'quarto', 'quartos') : '', u.zone ?? u.district].filter(Boolean)

  return (
    <FichaCard label={`Ficha de ${unitTitle(u)}`}>
      <Trail u={u} portal={!team} onProperty={onClear} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">{unitTitle(u)}</h2>
        <UnitStatusBadge status={u.status} />
        {archived && <Badge tone="danger">Arquivada</Badge>}
      </div>
      <p className="-mt-2 flex flex-wrap gap-x-2 text-sm text-muted">
        {meta.map((m, i) => (
          <span key={i} className={i === 1 ? 'num' : undefined}>
            {m}
          </span>
        ))}
      </p>
      <DescriptionList
        columns={1}
        items={[
          {
            label: 'Locatário',
            value: !u.lease ? (
              <span className="text-muted">Sem locação vigente</span>
            ) : u.lease.lessee_id && linkPeople ? (
              <Link to="/pessoas/$personId" params={{ personId: u.lease.lessee_id }} className="text-primary hover:underline">
                {u.lease.lessee_name}
              </Link>
            ) : (
              u.lease.lessee_name
            ),
          },
          ...(u.lease
            ? [
                {
                  label: 'Contrato',
                  value: can(s, 'contracts:view') ? (
                    <Link to="/contratos/$contractId" params={{ contractId: u.lease.id }} className="text-primary hover:underline">
                      {u.lease.code}
                    </Link>
                  ) : (
                    u.lease.code
                  ),
                },
                { label: 'Aluguel', value: <span className="num">{formatBRL(u.lease.rent_cents)}</span> },
                {
                  label: 'Fim do contrato',
                  value: (
                    <span>
                      <span className="num">{formatDate(u.lease.end_date)}</span>
                      <span className="text-muted"> · {daysLeft >= 0 ? `em ${plural(daysLeft, 'dia', 'dias')}` : 'prazo vencido'}</span>
                    </span>
                  ),
                },
              ]
            : [{ label: 'Aluguel pedido', value: u.asking_rent_cents !== null ? <span className="num">{formatBRL(u.asking_rent_cents)}</span> : '' }]),
          { label: u.owners.length > 1 ? 'Donos' : 'Dono', value: u.owners.length ? u.owners.map((o) => (o.share_pct < 100 ? `${o.name} (${formatPct(o.share_pct)})` : o.name)).join(', ') : <span className="text-muted">Nenhum dono registrado</span> },
          ...(u.features.length ? [{ label: 'Características', value: u.features.join(', ') }] : []),
          ...(u.notes ? [{ label: 'Observações', value: u.notes }] : []),
        ]}
      />
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {canLease && (
          <Button size="sm" variant="primary" icon={<FilePlus2 className="size-4" aria-hidden="true" />} onClick={() => void navigate({ href: `/contratos/novo?unidade=${encodeURIComponent(u.id)}` })}>
            Nova locação
          </Button>
        )}
        {canEdit && !archived && (
          <>
            <Button size="sm" icon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(true)}>
              Editar unidade
            </Button>
            <Button size="sm" icon={<Archive className="size-4" aria-hidden="true" />} onClick={() => setArchiving(true)}>
              Arquivar
            </Button>
          </>
        )}
        {canEdit && archived && (
          <Button
            size="sm"
            variant="primary"
            icon={<ArchiveRestore className="size-4" aria-hidden="true" />}
            loading={archive.isPending}
            onClick={() => archive.mutate({ id: u.id, restore: true }, { onSuccess: () => toast.success(`Unidade ${u.code} restaurada.`) })}
          >
            Restaurar
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<X className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={onClear} title="Limpar escolha (Esc)">
          Limpar escolha
        </Button>
      </div>

      {editing && <EditUnitDialog unit={u} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Arquivar a unidade ${u.code}?`}
        danger
        loading={archive.isPending}
        confirmLabel="Arquivar"
        message={
          u.lease ? (
            <>
              A unidade tem o contrato vigente <strong>{u.lease.code}</strong>: o arquivamento vai ser recusado. Encerre ou rescinda o contrato antes.
            </>
          ) : (
            'A unidade sai das listas e do desenho. Contratos antigos, pagamentos e histórico continuam guardados, e dá para desfazer.'
          )
        }
        onConfirm={() =>
          archive.mutate(
            { id: u.id },
            {
              onSuccess: () => {
                setArchiving(false)
                toast.success(`Unidade ${u.code} arquivada.`, { label: 'Desfazer', onClick: () => archive.mutate({ id: u.id, restore: true }) })
              },
              onError: () => setArchiving(false),
            },
          )
        }
      />
    </FichaCard>
  )
}

/**
 * Trilha Imóveis › imóvel › bloco › andar › código, pequena. "Imóveis" é link (outra tela); o
 * imóvel é botão que solta a escolha (volta ao resumo dele, na mesma tela). Vaga externa mostra a área.
 */
function Trail({ u, portal, onProperty }: { u: UnitRow; portal: boolean; onProperty: () => void }) {
  const parts = (u.building_id ? [u.building_name, u.floor_label] : [u.zone]).filter(Boolean) as string[]
  const sep = <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
  return (
    <nav aria-label="Trilha da unidade" className="text-xs">
      <ol className="flex flex-wrap items-center gap-1 text-muted">
        <li>
          <Link to="/imoveis" className="hover:text-text hover:underline">
            {portal ? 'Meus imóveis' : 'Imóveis'}
          </Link>
        </li>
        <li className="flex items-center gap-1">
          {sep}
          <button type="button" className="hover:text-text hover:underline" onClick={onProperty} title="Voltar ao resumo do imóvel">
            {u.property_name}
          </button>
        </li>
        {parts.map((p) => (
          <li key={p} className="flex items-center gap-1">
            {sep}
            {p}
          </li>
        ))}
        {(u.building_id || u.zone) && (
          <li className="flex items-center gap-1 text-text" aria-current="page">
            {sep}
            {u.code}
          </li>
        )}
      </ol>
    </nav>
  )
}

/* ---------------------------------------------------------------- os detalhes (abas de baixo) */

/**
 * As abas da unidade escolhida. A aba muda SÓ no clique da pessoa na aba; escolher outra unidade
 * volta para a primeira (a ficha do imóvel tira o ?aba= do endereço ao trocar de escolha).
 */
export function UnitDetails({ unitId, tab, onTab, onClear }: { unitId: string; tab?: string; onTab: (v: string) => void; onClear: () => void }) {
  const s = useSession()
  const team = !isPortal(s)
  const finance = can(s, 'finance:view')
  const q = useRepo('unidade', (sess) => getUnit(sess, unitId), [unitId])
  const counts = useRepo('unidade:contagens', (sess) => placeCounts(sess, { unitId }), [unitId])
  const c = counts.data
  const u = q.data?.id === unitId ? q.data : undefined
  const tabs = unitTabs(s, c)
  const current = resolveTab(tab, tabs, UNIT_OLD_TABS)
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!u) return <Skeleton className="h-40" />
  return (
    <section className="flex flex-col gap-2" aria-label={`Detalhes de ${unitTitle(u)}`}>
      <DetailsHeading title={`Detalhes de ${unitTitle(u)}`} onClear={onClear} />
      <Tabs value={current} onValueChange={onTab} tabs={tabs}>
        <TabPanel value="contratos" className="pt-3">
          <div className="flex flex-col gap-8">
            <TabBlock title="Pessoas">
              <UnitPeople u={u} />
            </TabBlock>
            <TabBlock title="Contratos">
              <PlaceContracts where={{ unit: unitId }} storageKey="unidade-contratos" />
            </TabBlock>
            {finance && (
              <TabBlock title="Cobranças">
                <EntriesTab filter="unit" id={unitId} storageKey="unidade-financeiro" csvName={`financeiro-${u.code}.csv`} baseTotal={c?.entries} />
              </TabBlock>
            )}
          </div>
        </TabPanel>
        <TabPanel value="chamados" className="pt-3">
          <UnitMaintenance unitId={unitId} baseTotal={c?.maintenance} />
        </TabPanel>
        <TabPanel value="historico" className="pt-3">
          <div className="flex flex-col gap-8">
            <TabBlock title={team ? 'Documentos' : undefined}>
              <PlaceDocumentsTab target={{ unitId }} storageKey="unidade-documentos" />
            </TabBlock>
            {team && (
              <TabBlock>
                <Section title="Histórico" info="O que foi feito na unidade, nos contratos e chamados dela e as baixas de pagamento, com quem fez e quando.">
                  <HistoryTab queryKey={`unidade:${unitId}`} load={(sess) => unitHistory(sess, unitId)} />
                </Section>
              </TabBlock>
            )}
          </div>
        </TabPanel>
      </Tabs>
    </section>
  )
}

/* ---------------------------------------------------------------- Pessoas (no alto da aba Contratos e cobranças) */

/**
 * Donos (da unidade ou do imóvel inteiro), locatário e fiador da locação vigente, com contato.
 * Fica no alto da aba "Contratos e cobranças" (a ficha curta ao lado do desenho só dá os nomes).
 * Contato (e-mail, telefone) só para a equipe: no portal, cada um vê só o próprio cadastro (matriz F).
 */
function UnitPeople({ u }: { u: UnitRow }) {
  const s = useSession()
  const team = !isPortal(s)
  const linkPeople = can(s, 'people:view')
  const leaseId = u.lease?.id
  // Lida pela unidade (não pelo contrato): a ficha do imóvel já pede esta leitura junto com a unidade
  // escolhida, e ela chega pronta aqui (mesma chave), sem esqueleto.
  const detail = useRepo('unidade:partes', (sess) => getUnitLeaseParties(sess, u.id), [u.id], { enabled: !!leaseId })
  const parties = (detail.data ?? []).filter((p) => p.role === 'lessee' || p.role === 'guarantor')
  const card = (key: string, personId: string, name: string, role: string, extra?: { document: string; email: string; phone: string }, share?: number) => (
    <li key={key} className="flex flex-col gap-1 rounded-xl border border-border p-3">
      <span className="flex items-center justify-between gap-2">
        {linkPeople ? (
          <Link to="/pessoas/$personId" params={{ personId }} className="font-medium hover:underline">
            {name}
          </Link>
        ) : (
          <span className="font-medium">{name}</span>
        )}
        <Badge tone="neutral">{role}</Badge>
      </span>
      {share !== undefined && <span className="num text-xs text-muted">Fatia de {formatPct(share)}</span>}
      {team && extra && (
        <span className="num text-xs text-muted">
          {maskDocument(extra.document)}
          {extra.email ? ` · ${extra.email}` : ''}
          {extra.phone ? ` · ${formatPhone(extra.phone)}` : ''}
        </span>
      )}
    </li>
  )
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Donos">
        {u.owners.length ? <ul className="flex flex-col gap-2">{u.owners.map((o) => card(o.person_id, o.person_id, o.name, 'Proprietário', undefined, o.share_pct))}</ul> : <p className="text-sm text-muted">Nenhum dono registrado.</p>}
      </Section>
      <Section title="Locatário e fiador">
        {!leaseId ? (
          <p className="text-sm text-muted">Sem locação vigente: sem locatário nem fiador no momento.</p>
        ) : detail.error ? (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        ) : !detail.data ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="flex flex-col gap-2">
            {parties.map((p) => card(p.id, p.person_id, p.name, PARTY_ROLE[p.role], { document: p.document, email: p.email, phone: p.phone }))}
            {!parties.some((p) => p.role === 'guarantor') && <li className="text-xs text-muted">Contrato sem fiador (a garantia é outra modalidade ou não há).</li>}
          </ul>
        )}
      </Section>
    </div>
  )
}

/* ---------------------------------------------------------------- Chamados */

function UnitMaintenance({ unitId, baseTotal }: { unitId: string; baseTotal: number | undefined }) {
  const navigate = useNavigate()
  const list = useListState('unidade-manutencao')
  const params = useMemo(() => ({ ...list.params, filters: { ...list.params.filters, unit: [unitId] } }), [list.params, unitId])
  const q = useRepo('unidade:manutencao', (sess) => listMaintenance(sess, params), [params])
  return (
    <div className="flex flex-col gap-3">
      <ListToolbar
        state={list}
        noun={['chamado', 'chamados']}
        total={q.data?.total}
        totalAll={baseTotal}
        facets={q.data?.facets}
        searchPlaceholder="Buscar por código ou assunto"
        filters={[{ key: 'open', label: 'Andamento', options: [{ value: 'aberto', label: 'Em aberto' }, { value: 'fechado', label: 'Concluído ou cancelado' }] }]}
      />
      <DataTable
        caption="Chamados da unidade"
        columns={maintenanceColumns({ linkRequests: true, showUnit: false })}
        rows={q.data?.rows}
        rowKey={(r) => r.id}
        sort={list.sort}
        onSort={list.toggleSort}
        onRowClick={(r) => void navigate({ to: '/manutencao/$requestId', params: { requestId: r.id } })}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState title="Nenhum chamado" description={list.activeFilterCount ? 'Nenhum chamado passa nos filtros ligados. Limpe os filtros para ver todos.' : 'Os chamados de manutenção desta unidade aparecem aqui.'} />}
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
    </div>
  )
}
