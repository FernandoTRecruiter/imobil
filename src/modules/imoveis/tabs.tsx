/* =============================================================================
   Abas que se repetem nas telas de detalhe (imóvel, unidade e pessoa):
     - PlaceDocumentsTab: documentos do imóvel ou da unidade (e do que pendura neles), com
       "Anexar documento" escolhendo a que ele pertence (07/11: a tela Documentos saiu do menu);
     - EntriesTab: lançamentos com os totais do recorte (previsto, vencido, recebido, pago);
     - contractColumns / maintenanceColumns: colunas das tabelas de contratos e chamados;
     - HistoryTab: a linha do tempo lida da auditoria, com "de X para Y" das alterações;
     - resolveTab / TabBlock: a aba que o ?aba= abre (com os valores antigos) e o bloco de uma
       aba que juntou outras (título leve e rolagem até a seção pedida).
   Todas leem pelas views prontas (data/views), que já aplicam o escopo da sessão.
   ============================================================================= */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FilePlus2, FileText } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { isPortal } from '@/auth/permissions'
import type { Session } from '@/auth/session'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { InfoTip } from '@/components/ui/InfoTip'
import { KpiTile, Timeline } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { useRepo } from '@/data/hooks'
import {
  CONTRACT_KIND, CONTRACT_STATUS, CONTRACT_STATUS_TONE, ENTRY_CATEGORY, MAINTENANCE_CATEGORY, MAINTENANCE_STATUS, MAINTENANCE_STATUS_TONE,
  PARTY_ROLE, PERSON_TAG, PRIORITY, PRIORITY_TONE, PROPERTY_KIND, UNIT_KIND, UNIT_STATUS, type Tone,
} from '@/data/labels'
import type { EntryState } from '@/data/rules'
import type { Address, AuditLog, PartyRole } from '@/data/types'
import type { ContractRow } from '@/data/views/contracts'
import { listEntries, type EntryRow, type MaintenanceRow } from '@/data/views/finance'
import { csvMoney, downloadText } from '@/lib/csv'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDate, formatDateTime } from '@/lib/dates'
import { maskDocument } from '@/lib/documents'
import { formatBRL } from '@/lib/money'
import { useListState } from '@/lib/useListState'
import { AttachDocumentDialog, DocumentActions } from '@/modules/documentos/parts'
import type { HistoryEntry } from './history'
import { LINK_KIND_LABEL, listPlaceDocuments, VISIBILITY_LABEL, type PlaceDocumentRow, type PlaceTarget } from './repo'

/* ---------------------------------------------------------------- abas juntadas */

/**
 * Qual aba abrir a partir do ?aba= do endereço (dado de fora: qualquer texto chega aqui).
 * Passo a passo:
 *   1. valor de antes de juntar as abas vira o novo pelo mapa "old" (link velho continua valendo);
 *   2. se a aba existe para esta pessoa, abre ela;
 *   3. senão (valor desconhecido ou aba que a permissão esconde), abre a primeira.
 * Object.hasOwn e não old[asked] direto: "?aba=constructor" acharia uma função herdada do objeto.
 */
export function resolveTab(asked: string | undefined, tabs: { value: string }[], old: Record<string, string>): string {
  const want = asked !== undefined && Object.hasOwn(old, asked) ? old[asked] : asked
  return tabs.some((t) => t.value === want) ? want! : tabs[0].value
}

/** Gestos que mostram que a pessoa assumiu a rolagem: a partir deles a página para de rolar sozinha. */
const GESTURES = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

/**
 * Um bloco de uma aba que juntou outras (ex.: "Documentos e histórico"). Faz duas coisas:
 *   1. título leve (h2) quando o conteúdo não traz cartão com título próprio. Sem moldura de
 *      cartão de propósito: a tabela já tem a dela, e cartão dentro de cartão vira caixa em caixa;
 *   2. âncora do endereço antigo: com scrollHere, a página abre já rolada até este bloco
 *      (?aba=historico abre "Documentos e histórico" no Histórico, que fica embaixo).
 * Por que rolar de novo enquanto a aba cresce: cada bloco carrega sozinho (140 a 300 ms no banco
 * fictício) e a tabela de cima, ao chegar, empurraria este bloco para fora da tela.
 * A folga para as barras presas no alto já vem do scroll-padding-top do html (styles.css):
 * somar scroll-margin aqui dobraria o espaço.
 */
export function TabBlock({ id, title, info, scrollHere = false, children }: { id?: string; title?: string; info?: ReactNode; scrollHere?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!scrollHere || !el) return
    // Passo a passo: rola agora; rola de novo a cada mudança de tamanho da aba (o observador
    // também avisa uma vez logo ao começar); para no primeiro gesto da pessoa ou depois de 2 s,
    // o que vier antes, para nunca brigar com quem já está rolando.
    // atalho: 2 s cobrem o banco fictício; com o banco de verdade (fase 2) em rede lenta, medir de novo.
    const go = () => el.scrollIntoView({ block: 'start' })
    const watch = new ResizeObserver(go)
    const stop = () => {
      watch.disconnect()
      window.clearTimeout(timer)
      for (const g of GESTURES) window.removeEventListener(g, stop)
    }
    const timer = window.setTimeout(stop, 2000)
    for (const g of GESTURES) window.addEventListener(g, stop, { passive: true })
    watch.observe(el.parentElement ?? el)
    go()
    return stop
  }, [scrollHere])
  return (
    <div id={id} ref={ref} className="flex flex-col gap-3">
      {/* "info": a explicação vai no "i" ao lado do título, nunca num parágrafo de aviso (regra da casa). */}
      {title && (
        <h2 className="flex items-center gap-1 text-[15px] font-medium">
          {title}
          {info && <InfoTip>{info}</InfoTip>}
        </h2>
      )}
      {children}
    </div>
  )
}

/* ---------------------------------------------------------------- documentos */

/** No modo de demonstração não há arquivo guardado: o download entrega um aviso no lugar. */
function demoDownload(d: PlaceDocumentRow) {
  downloadText(`${d.name}.txt`, `Arquivo de demonstração: "${d.name}".

No Imobil de verdade (fase 2) o download usa um link assinado que expira em poucos minutos.`, 'text/plain;charset=utf-8')
}

/**
 * Documentos do imóvel ou da unidade e do que pendura neles (contratos, vistorias, chamados).
 * A equipe anexa daqui ("Pertence a": o imóvel, um contrato ou uma unidade dali) e, por linha, muda
 * quem vê ou arquiva; o portal só baixa o que foi liberado para ele.
 */
export function PlaceDocumentsTab({ target, storageKey }: { target: PlaceTarget; storageKey: string }) {
  const s = useSession()
  const team = !isPortal(s)
  const list = useListState(storageKey)
  const targetId = 'unitId' in target ? target.unitId : target.propertyId
  const q = useRepo('imoveis:documentos', (sess) => listPlaceDocuments(sess, target, list.params), [targetId, list.params])
  const [attaching, setAttaching] = useState(false)

  const columns: Column<PlaceDocumentRow>[] = [
    {
      key: 'name', header: 'Documento', sortable: true, firstDir: 'asc',
      cell: (d) => (
        <span className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <button className="min-h-6 text-left font-medium hover:underline" onClick={() => demoDownload(d)} title="Baixar">
            {d.name}
          </button>
        </span>
      ),
    },
    {
      key: 'link', header: 'Pertence a', hideBelow: 'sm',
      cell: (d) => (
        <Link to={d.linkHref} className="text-primary hover:underline">
          {LINK_KIND_LABEL[d.linkKind]} {d.linkLabel}
        </Link>
      ),
    },
    ...(team ? [{ key: 'visibility', header: 'Quem vê', hideBelow: 'md', cell: (d) => <Badge tone={d.visibilityKey === 'internal' ? 'neutral' : 'primary'}>{VISIBILITY_LABEL[d.visibilityKey]}</Badge> } satisfies Column<PlaceDocumentRow>] : []),
    { key: 'created_at', header: 'Enviado em', sortable: true, firstDir: 'desc', align: 'right', cell: (d) => formatDate(d.created_at.slice(0, 10)) },
    ...(team ? [{ key: 'acoes', header: '', className: 'w-12', cell: (d) => <DocumentActions doc={d} /> } satisfies Column<PlaceDocumentRow>] : []),
  ]
  const attachButton = (
    <Button icon={<FilePlus2 className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={() => setAttaching(true)}>
      Anexar documento
    </Button>
  )

  return (
    <div className="flex flex-col gap-3">
      <ListToolbar
        state={list}
        noun={['documento', 'documentos']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        searchPlaceholder="Buscar documento"
        filters={[{ key: 'vinculo', label: 'Pertence a', options: Object.entries(LINK_KIND_LABEL).filter(([k]) => k !== 'person').map(([value, label]) => ({ value, label })) }]}
      >
        {team && attachButton}
      </ListToolbar>
      <DataTable
        caption="Documentos"
        columns={columns}
        rows={q.data?.rows}
        rowKey={(d) => d.id}
        sort={list.sort}
        onSort={list.toggleSort}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={
          <EmptyState
            title="Nenhum documento"
            description={list.activeFilterCount ? 'Nenhum documento passa nos filtros ligados. Limpe os filtros para ver todos.' : team ? 'Anexe contratos, laudos e plantas: cada um fica ligado ao imóvel, a um contrato ou a uma unidade.' : 'A administração ainda não liberou documento para você aqui.'}
          />
        }
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      {attaching && <AttachDocumentDialog around={target} onClose={() => setAttaching(false)} />}
    </div>
  )
}

/* ---------------------------------------------------------------- financeiro */

export const ENTRY_STATE_LABEL: Record<EntryState, string> = { forecast: 'Previsto', overdue: 'Vencido', received: 'Recebido', paid: 'Pago', canceled: 'Cancelado' }
export const ENTRY_STATE_TONE: Record<EntryState, Tone> = { forecast: 'primary', overdue: 'danger', received: 'success', paid: 'success', canceled: 'neutral' }

/**
 * Lançamentos de uma unidade ou de uma pessoa, com os totais do recorte inteiro (não só da
 * página). "Vencido" sai calculado da view (aberto e vencimento antes de hoje): nunca gravado.
 */
export function EntriesTab({ filter, id, storageKey, csvName, baseTotal }: { filter: 'unit' | 'person'; id: string; storageKey: string; csvName: string; baseTotal: number | undefined }) {
  const s = useSession()
  const list = useListState(storageKey)
  const params = { ...list.params, filters: { ...list.params.filters, [filter]: [id] } }
  const q = useRepo('lancamentos', (sess) => listEntries(sess, params), [filter, id, list.params])
  const t = q.data?.totals
  const columns: Column<EntryRow>[] = [
    { key: 'competence', header: 'Competência', sortable: true, firstDir: 'desc', cell: (e) => <span className="num">{e.competence.slice(5, 7)}/{e.competence.slice(0, 4)}</span> },
    { key: 'description', header: 'Descrição', className: 'max-w-72', cell: (e) => <span className="line-clamp-2">{e.description}</span> },
    { key: 'category', header: 'Categoria', hideBelow: 'lg', cell: (e) => ENTRY_CATEGORY[e.category] },
    ...(filter === 'unit'
      ? [{ key: 'person', header: 'Pessoa', sortable: true, firstDir: 'asc', hideBelow: 'lg', cell: (e) => e.person_name ?? '' } satisfies Column<EntryRow>]
      : [{ key: 'unit', header: 'Unidade', hideBelow: 'lg', className: 'max-w-56', cell: (e) => <span className="line-clamp-2">{e.unit_label ?? ''}</span> } satisfies Column<EntryRow>]),
    { key: 'due_date', header: 'Vencimento', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'sm', cell: (e) => formatDate(e.due_date) },
    {
      key: 'amount', header: 'Valor', sortable: true, firstDir: 'desc', align: 'right',
      cell: (e) => (e.direction === 'payable' ? <span className="text-muted" title="A pagar">-{formatBRL(e.amount_cents)}</span> : formatBRL(e.amount_cents)),
    },
    {
      key: 'state', header: 'Situação',
      cell: (e) => (
        <Badge tone={ENTRY_STATE_TONE[e.state]}>
          {ENTRY_STATE_LABEL[e.state]}
          {e.state === 'overdue' ? ` há ${e.days_overdue} d` : ''}
        </Badge>
      ),
    },
  ]
  const exportList = async (format: ExportFormat) => {
    const all = await listEntries(s, { ...params, page: 1, pageSize: 100_000 })
    await downloadTable(
      csvName,
      all.rows,
      [
        { label: 'Competência', value: (e) => `${e.competence.slice(5, 7)}/${e.competence.slice(0, 4)}` },
        { label: 'Descrição', value: (e) => e.description },
        { label: 'Categoria', value: (e) => ENTRY_CATEGORY[e.category] },
        { label: 'Tipo', value: (e) => (e.direction === 'receivable' ? 'A receber' : 'A pagar') },
        { label: 'Pessoa', value: (e) => e.person_name },
        { label: 'Unidade', value: (e) => e.unit_label },
        { label: 'Vencimento', value: (e) => formatDate(e.due_date) },
        { label: 'Valor (R$)', value: (e) => csvMoney(e.amount_cents) },
        { label: 'Em aberto (R$)', value: (e) => csvMoney(e.open_cents) },
        { label: 'Situação', value: (e) => ENTRY_STATE_LABEL[e.state] },
      ],
      format,
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Previsto" value={t ? formatBRL(t.forecast) : '…'} hint="em aberto, ainda no prazo" />
        <KpiTile
          label="Vencido"
          value={t ? formatBRL(t.overdue) : '…'}
          hint="em aberto, prazo passou"
          tone={t && t.overdue > 0 ? 'danger' : undefined}
          info="Lançamento em aberto com vencimento antes de hoje. Conta só o saldo que falta pagar."
        />
        <KpiTile label="Recebido" value={t ? formatBRL(t.received) : '…'} hint="a receber já pagos" tone="success" />
        <KpiTile label="Pago" value={t ? formatBRL(t.paid) : '…'} hint="a pagar já quitados" />
      </div>
      <ListToolbar
        state={list}
        noun={['lançamento', 'lançamentos']}
        total={q.data?.total}
        // O "M" de "N de M" é o total DESTA unidade ou pessoa (vem da contagem da aba). O totalAll da
        // lista seria o da conta inteira, porque aqui o recorte entra como filtro.
        totalAll={baseTotal}
        facets={q.data?.facets}
        onExport={exportList}
        searchPlaceholder="Buscar por descrição ou pessoa"
        filters={[
          { key: 'state', label: 'Situação', options: (Object.keys(ENTRY_STATE_LABEL) as EntryState[]).map((v) => ({ value: v, label: ENTRY_STATE_LABEL[v] })) },
          { key: 'category', label: 'Categoria', options: Object.entries(ENTRY_CATEGORY).map(([value, label]) => ({ value, label })) },
        ]}
      />
      <DataTable
        caption="Lançamentos"
        columns={columns}
        rows={q.data?.rows}
        rowKey={(e) => e.id}
        sort={list.sort}
        onSort={list.toggleSort}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState title="Nenhum lançamento" description={list.activeFilterCount ? 'Nenhum lançamento passa nos filtros ligados. Limpe os filtros para ver todos.' : 'Aluguéis, despesas e repasses aparecem aqui quando houver contrato ou cobrança.'} />}
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
    </div>
  )
}

/* ---------------------------------------------------------------- colunas de contratos e chamados */

/** Colunas de contrato. "showRoles" (aba da pessoa) mostra o papel dela; "showUnit" mostra a unidade. */
export function contractColumns<T extends ContractRow & { person_roles?: PartyRole[] }>({ linkContracts, showUnit, showRoles }: { linkContracts: boolean; showUnit: boolean; showRoles?: boolean }): Column<T>[] {
  const cols: Column<T>[] = [
    {
      key: 'code', header: 'Contrato', sortable: true, firstDir: 'asc',
      cell: (k) => (
        <span className="flex flex-col">
          {linkContracts ? (
            <Link to="/contratos/$contractId" params={{ contractId: k.id }} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
              {k.code}
            </Link>
          ) : (
            <span className="font-medium">{k.code}</span>
          )}
          <span className="text-xs text-muted">{CONTRACT_KIND[k.kind]}</span>
        </span>
      ),
    },
  ]
  if (showRoles) cols.push({ key: 'role', header: 'Papel', cell: (k) => (k.person_roles ?? []).map((r) => PARTY_ROLE[r]).join(', ') })
  if (showUnit) cols.push({ key: 'unit', header: 'Unidade', hideBelow: 'md', className: 'max-w-64', cell: (k) => <span className="line-clamp-2">{k.unit_label ?? k.property_name}</span> })
  cols.push(
    { key: 'status', header: 'Situação', cell: (k) => <Badge tone={CONTRACT_STATUS_TONE[k.status]}>{CONTRACT_STATUS[k.status]}</Badge> },
    { key: 'lessee', header: 'Locatário', sortable: true, firstDir: 'asc', hideBelow: 'lg', className: 'max-w-56', cell: (k) => <span className="line-clamp-2">{k.lessee_name}</span> },
    { key: 'start_date', header: 'Início', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'sm', cell: (k) => formatDate(k.start_date) },
    { key: 'end_date', header: 'Fim', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md', cell: (k) => formatDate(k.end_date) },
    { key: 'rent', header: 'Aluguel', sortable: true, firstDir: 'desc', align: 'right', cell: (k) => (k.kind === 'lease' ? formatBRL(k.rent_cents) : `taxa ${k.admin_fee_pct}%`) },
  )
  return cols
}

export function maintenanceColumns({ linkRequests, showUnit }: { linkRequests: boolean; showUnit: boolean }): Column<MaintenanceRow>[] {
  const cols: Column<MaintenanceRow>[] = [
    {
      key: 'code', header: 'Chamado',
      cell: (r) =>
        linkRequests ? (
          <Link to="/manutencao/$requestId" params={{ requestId: r.id }} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.code}
          </Link>
        ) : (
          <span className="font-medium">{r.code}</span>
        ),
    },
    { key: 'title', header: 'Assunto', className: 'max-w-72', cell: (r) => <span className="line-clamp-2">{r.title}</span> },
  ]
  if (showUnit) cols.push({ key: 'unit', header: 'Unidade', hideBelow: 'md', className: 'max-w-56', cell: (r) => <span className="line-clamp-2">{r.unit_label}</span> })
  cols.push(
    { key: 'status', header: 'Situação', cell: (r) => <Badge tone={MAINTENANCE_STATUS_TONE[r.status]}>{MAINTENANCE_STATUS[r.status]}</Badge> },
    { key: 'priority', header: 'Prioridade', hideBelow: 'sm', cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY[r.priority]}</Badge> },
    { key: 'created_at', header: 'Aberto em', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md', cell: (r) => formatDate(r.created_at.slice(0, 10)) },
    { key: 'vendor', header: 'Prestador', hideBelow: 'lg', cell: (r) => r.vendor_name ?? <span className="text-muted">Sem prestador</span> },
  )
  return cols
}

/* ---------------------------------------------------------------- histórico */

const FIELD_LABEL: Record<string, string> = {
  name: 'Nome', code: 'Código', kind: 'Tipo', area_m2: 'Área (m²)', bedrooms: 'Quartos', bathrooms: 'Banheiros', parking_spots: 'Vagas',
  features: 'Características', zone: 'Área externa', manual_status: 'Situação', asking_rent_cents: 'Aluguel pedido', notes: 'Observações', address: 'Endereço',
  portfolio_id: 'Carteira', manager_user_id: 'Responsável', email: 'E-mail', phone: 'Telefone', document: 'Documento', tags: 'Papéis declarados',
  vendor_categories: 'Serviços do prestador', owners: 'Proprietários', deleted_at: 'Arquivamento',
  dependents: 'Dependentes', pets: 'Animais de estimação', vehicles: 'Veículos', occupation: 'Ocupação',
}

/** Valor legível de um campo alterado (código do banco vira o rótulo em pt-BR). */
function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return 'vazio'
  if (key === 'manual_status') return UNIT_STATUS[v as keyof typeof UNIT_STATUS] ?? String(v)
  if (key === 'kind') return v === 'PF' ? 'Pessoa física' : v === 'PJ' ? 'Pessoa jurídica' : (UNIT_KIND[v as keyof typeof UNIT_KIND] ?? PROPERTY_KIND[v as keyof typeof PROPERTY_KIND] ?? String(v))
  if (key === 'asking_rent_cents' && typeof v === 'number') return formatBRL(v)
  if (key === 'document') return maskDocument(String(v))
  if (key === 'address' && typeof v === 'object') {
    const a = v as Address
    return `${a.street}, ${a.number} · ${a.district}`
  }
  if (Array.isArray(v)) return v.map((x) => PERSON_TAG[x as keyof typeof PERSON_TAG] ?? MAINTENANCE_CATEGORY[x as keyof typeof MAINTENANCE_CATEGORY] ?? String(x)).join(', ')
  return String(v)
}

/** "Código: de A-101 para A-101B". Campo de id (carteira, responsável) diz só que mudou. */
export function describeChanges(changes: AuditLog['changes']): string[] {
  if (!changes) return []
  const lines = Object.entries(changes).map(([key, { from, to }]) => {
    const label = FIELD_LABEL[key] ?? key
    if (key === 'deleted_at') return to ? 'Arquivado' : 'Restaurado'
    if (key.endsWith('_id')) return `${label}: alterado`
    return `${label}: de ${show(key, from)} para ${show(key, to)}`
  })
  return lines.length > 5 ? [...lines.slice(0, 5), `e mais ${lines.length - 5} alterações`] : lines
}

export function HistoryTab({ queryKey, load }: { queryKey: string; load: (s: Session) => Promise<HistoryEntry[]> }) {
  const s = useSession()
  const q = useRepo('historico', load, [queryKey])
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Carregando">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    )
  }
  return (
    <Timeline
      empty="Nada registrado ainda."
      items={q.data.map((h) => {
        const lines = describeChanges(h.changes)
        return {
          id: h.id,
          when: formatDateTime(h.at, s.org.timezone),
          title: h.summary,
          who: h.who,
          detail: lines.length ? (
            <ul className="list-disc pl-4">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : undefined,
        }
      })}
    />
  )
}
