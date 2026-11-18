/* =============================================================================
   A tabela de contratos com a linha que abre (07/11/2026), usada em três lugares:
     1. "Contratos e pessoas" (ContratosPessoasPage): a linha aberta é a escolhida no endereço;
     2. aba Contratos da ficha do imóvel e 3. bloco Contratos da unidade escolhida (PlaceContracts):
        a linha abre ali mesmo; "Abrir em Contratos e pessoas" é o botão explícito para a ficha
        completa (ações de reajuste, renovação, rescisão).
   A linha aberta (ContractExpansion) responde "quem está neste contrato e o que está anexado":
   as partes com o papel de cada uma, o imóvel e a unidade, as datas que importam e os documentos
   do contrato, com "Anexar documento" para a equipe.
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ExternalLink, PanelRight, Plus } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DescriptionList } from '@/components/ui/Layout'
import { ListToolbar, type FilterDef } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { useRepo } from '@/data/hooks'
import { formatMonths } from '@/components/ui/compare-model'
import { ADJUSTMENT_INDEX, CONTRACT_KIND, CONTRACT_STATUS, CONTRACT_STATUS_TONE, GUARANTEE, PARTY_ROLE } from '@/data/labels'
import type { ContractKind, ContractStatus, PartyRole } from '@/data/types'
import type { ContractRow } from '@/data/views/contracts'
import { csvMoney } from '@/lib/csv'
import { formatDate } from '@/lib/dates'
import { formatPhone, maskDocument } from '@/lib/documents'
import { formatBRL, formatBRLShort } from '@/lib/money'
import { plural } from '@/lib/text'
import { useListState } from '@/lib/useListState'
import { DocumentList } from '@/modules/documentos/parts'
import { formatPct } from '@/modules/financeiro/ui'
import { ExpandTable, type ExpandColumn } from './ExpandTable'
import { getContract, listContractDocuments, listContractsForScreen } from './repo'

/* ---------------------------------------------------------------- colunas */

/**
 * Prazo dito do jeito que importa para a situação ("faltam 45 dias", "começa em 01/12/2026",
 * "encerrado em 30/06/2026"). Vigente com o fim no passado: ninguém encerrou nem renovou (a locação
 * segue por prazo indeterminado, Lei 8.245, art. 46), e a tela diz isso em vez de "-42 dias".
 */
export function termText(k: Pick<ContractRow, 'status' | 'days_to_end' | 'start_date' | 'end_date'>): { text: string; tone?: 'warning' | 'danger' } {
  if (k.status === 'active' && k.days_to_end < 0) return { text: `venceu há ${plural(-k.days_to_end, 'dia', 'dias')}`, tone: 'danger' }
  if (k.status === 'active') return { text: `faltam ${plural(k.days_to_end, 'dia', 'dias')}`, tone: k.days_to_end <= 60 ? 'warning' : undefined }
  if (k.status === 'ended' || k.status === 'terminated') return { text: `encerrado em ${formatDate(k.end_date)}` }
  return { text: `começa em ${formatDate(k.start_date)}` }
}

/** Partes resumidas numa linha: quem aluga e de quem; no contrato de administração, o dono. */
function partiesLine(k: ContractRow): { main: string; sub: string } {
  if (k.kind !== 'lease') return { main: k.lessor_names || 'Sem dono registrado', sub: 'proprietário' }
  return { main: k.lessee_name || 'Sem locatário', sub: k.lessor_names ? `locador: ${k.lessor_names}` : 'sem locador registrado' }
}

/** Número que pode faltar: vazio (sem dado) é diferente de zero. */
const count = (n: number | null) => (n === null ? '' : n)

/**
 * Colunas da tabela. Dado secundário vai na segunda linha da célula (unidade e imóvel sob o código,
 * locador sob o locatário, prazo sob a situação, atraso sob o aluguel): a tabela divide a largura com
 * a ficha curta e precisa caber sem rolar para o lado em 1366 px. O tipo aparece só quando não é
 * locação (a lista mostra locação por padrão). No celular, a situação desce para a célula do código.
 * Desde 07/11/2026: "export" diz o que cada coluna vira no arquivo (a célula que junta dados vira
 * várias colunas) e as "optional" ficam no menu "Colunas": tempo de contrato, renovações,
 * pontualidade do locatário e garantia.
 */
export function contractColumns({ showUnit = true }: { showUnit?: boolean } = {}): ExpandColumn<ContractRow>[] {
  return [
    {
      key: 'code', header: showUnit ? 'Contrato e unidade' : 'Contrato', sortable: true, firstDir: 'asc', locked: true,
      export: [
        { label: 'Código', value: (k) => k.code },
        { label: 'Tipo', value: (k) => CONTRACT_KIND[k.kind] },
        { label: 'Unidade', value: (k) => k.unit_code ?? 'Imóvel inteiro' },
        { label: 'Imóvel', value: (k) => k.property_name },
      ],
      cell: (k) => (
        // No celular a célula estreita (a tabela tem 3 colunas e precisa caber em 390 px sem rolar).
        <span className="flex max-w-[9rem] min-w-0 flex-col sm:max-w-[12rem]">
          <span className="font-medium whitespace-nowrap">
            {k.code}
            {k.kind !== 'lease' && <span className="text-xs font-normal text-muted"> · {CONTRACT_KIND[k.kind]}</span>}
          </span>
          {showUnit && (
            <span className="truncate text-xs text-muted" title={`${k.unit_code ?? 'Imóvel inteiro'} · ${k.property_name}`}>
              {k.unit_code ?? 'Imóvel inteiro'} · {k.property_name}
            </span>
          )}
          <span className="mt-1 sm:hidden">
            <Badge tone={CONTRACT_STATUS_TONE[k.status]}>{CONTRACT_STATUS[k.status]}</Badge>
          </span>
        </span>
      ),
    },
    {
      key: 'lessee', header: 'Partes', sortable: true, firstDir: 'asc', hideBelow: 'md',
      export: [
        { label: 'Locatário', value: (k) => k.lessee_name },
        { label: 'Locadores', value: (k) => k.lessor_names },
        { label: 'Fiador', value: (k) => k.guarantor_name },
      ],
      cell: (k) => {
        const p = partiesLine(k)
        return (
          <span className="block max-w-[10rem] min-w-0" title={[k.lessee_name && `Locatário: ${k.lessee_name}`, k.lessor_names && `Locador: ${k.lessor_names}`, k.guarantor_name && `Fiador: ${k.guarantor_name}`].filter(Boolean).join(' · ')}>
            <span className="block truncate">{p.main}</span>
            <span className="block truncate text-xs text-muted">{p.sub}</span>
          </span>
        )
      },
    },
    {
      key: 'end_date', header: 'Situação e prazo', sortable: true, firstDir: 'desc', hideBelow: 'sm',
      export: [
        { label: 'Situação', value: (k) => CONTRACT_STATUS[k.status] },
        { label: 'Início', value: (k) => formatDate(k.start_date) },
        { label: 'Fim', value: (k) => formatDate(k.end_date) },
        { label: 'Dias para vencer', value: (k) => (k.status === 'active' ? k.days_to_end : '') },
      ],
      cell: (k) => {
        const t = termText(k)
        return (
          <span className="flex flex-col items-start gap-1 whitespace-nowrap">
            <Badge tone={CONTRACT_STATUS_TONE[k.status]}>{CONTRACT_STATUS[k.status]}</Badge>
            <span className={cn('text-xs tabular-nums', t.tone === 'warning' ? 'font-medium text-warning-fg' : t.tone === 'danger' ? 'text-danger-fg' : 'text-muted')}>{t.text}</span>
          </span>
        )
      },
    },
    {
      key: 'term', header: 'Tempo de contrato', optional: true, sortable: true, firstDir: 'desc', hideBelow: 'md',
      export: [
        { label: 'Duração (meses)', value: (k) => k.duration_months },
        { label: 'Decorrido (meses)', value: (k) => k.elapsed_months },
        { label: 'Falta (meses)', value: (k) => count(k.remaining_months) },
      ],
      cell: (k) => (
        <span className="flex flex-col text-[13px] whitespace-nowrap">
          <span>
            {formatMonths(k.elapsed_months)} de {formatMonths(k.duration_months)}
          </span>
          {k.remaining_months !== null && <span className="text-xs text-muted">falta {formatMonths(k.remaining_months)}</span>}
        </span>
      ),
    },
    {
      key: 'renewals', header: 'Renovações', optional: true, sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md',
      export: [{ label: 'Renovações', value: (k) => k.renewals }],
      cell: (k) => (k.renewals ? <span title="Quantas vezes este contrato foi renovado até chegar nele">{k.renewals}</span> : ''),
    },
    {
      key: 'punctuality', header: 'Pontualidade', menuLabel: 'Pontualidade do locatário', optional: true, sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md',
      export: [{ label: 'Pontualidade do locatário (%)', value: (k) => (k.lessee_punctuality_pct === null ? '' : k.lessee_punctuality_pct.toLocaleString('pt-BR')) }],
      cell: (k) =>
        k.lessee_punctuality_pct === null ? '' : (
          <span title="Cobranças dos últimos 12 meses pagas até o vencimento" className={cn(k.lessee_punctuality_pct < 80 && 'text-danger-fg')}>
            {k.lessee_punctuality_pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
          </span>
        ),
    },
    { key: 'guarantee', header: 'Garantia', optional: true, hideBelow: 'lg', export: [{ label: 'Garantia', value: (k) => GUARANTEE[k.guarantee_type] }], cell: (k) => <span className="text-[13px] whitespace-nowrap">{GUARANTEE[k.guarantee_type]}</span> },
    {
      key: 'rent', header: 'Valor', sortable: true, firstDir: 'desc', align: 'right',
      export: [
        { label: 'Aluguel (R$)', value: (k) => (k.kind === 'lease' ? csvMoney(k.rent_cents) : '') },
        { label: 'Taxa de administração (%)', value: (k) => (k.kind === 'lease' ? '' : String(k.admin_fee_pct).replace('.', ',')) },
        { label: 'Índice', value: (k) => ADJUSTMENT_INDEX[k.adjustment_index] },
        { label: 'Em atraso (R$)', value: (k) => csvMoney(k.overdue_cents) },
      ],
      cell: (k) => (
        <span className="flex flex-col items-end whitespace-nowrap">
          <span>{k.kind === 'lease' ? formatBRL(k.rent_cents) : `taxa ${formatPct(k.admin_fee_pct)}`}</span>
          {k.overdue_cents > 0 ? (
            <span className="text-xs font-medium text-danger-fg" title={`${formatBRL(k.overdue_cents)} em atraso`}>
              atraso {formatBRLShort(k.overdue_cents)}
            </span>
          ) : (
            // O índice é detalhe: some no celular (está nos termos do contrato escolhido).
            k.kind === 'lease' && <span className="hidden text-xs text-muted sm:inline">{ADJUSTMENT_INDEX[k.adjustment_index]}</span>
          )}
        </span>
      ),
    },
  ]
}

/* ---------------------------------------------------------------- a linha aberta */

/** Título pequeno de um bloco da linha aberta. */
function Block({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <h3 className="text-[13px] font-medium text-muted">{title}</h3>
      {children}
    </div>
  )
}

/** Papel da parte como a pessoa fala: no contrato de administração, o locador é o proprietário. */
function roleLabel(role: PartyRole, kind: ContractKind): string {
  return kind === 'management' && role === 'lessor' ? 'Proprietário' : PARTY_ROLE[role]
}

const ROLE_TONE: Record<PartyRole, 'primary' | 'success' | 'warning' | 'neutral'> = { lessor: 'primary', lessee: 'success', guarantor: 'warning', representative: 'neutral' }

/**
 * O que a linha aberta do contrato mostra. Lê o contrato (getContract: as partes já vêm na ordem
 * e, no portal, só com o nome das outras pessoas) e os documentos dele (see.document decide quem
 * vê). As duas leituras são as mesmas da ficha curta (mesma chave): abrir a linha não lê de novo.
 *   onShowFicha: na tela Contratos e pessoas, abaixo de 1280 px a ficha curta fica depois da tabela;
 *                o botão "Ver ficha e ações" leva até ela;
 *   openInPage:  fora dela (ficha do imóvel), o botão explícito para a ficha completa.
 */
export function ContractExpansion({ contractId, pinned = false, onShowFicha, openInPage = false }: { contractId: string; pinned?: boolean; onShowFicha?: () => void; openInPage?: boolean }) {
  const s = useSession()
  const team = !isPortal(s)
  const q = useRepo('contrato:ficha', (sess) => getContract(sess, contractId), [contractId])
  const docs = useRepo('contrato:documentos', (sess) => listContractDocuments(sess, contractId), [contractId])
  const v = q.data?.contract.id === contractId ? q.data : undefined // a leitura do contrato anterior não vale
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!v) return <Skeleton className="h-32" />
  const k = v.contract
  const linkPeople = team && can(s, 'people:view')
  const signed = v.events.find((e) => e.kind === 'status' && e.to_status === 'active')?.effective_date
  const nextAdjustment = k.next_adjustment ?? (k.kind === 'lease' && !['ended', 'terminated'].includes(k.status) && k.adjustment_index !== 'none' && v.nextAdjustmentFrom <= k.end_date ? v.nextAdjustmentFrom : null)

  return (
    <div className="flex flex-col gap-4">
      {pinned && <p className="text-xs text-muted">Este contrato não está nesta página da lista ou não passa nos filtros ligados: aparece aqui porque foi escolhido.</p>}
      <div className="grid gap-4 @2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Block title="Partes">
          {v.parties.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {v.parties.map((p) => (
                <li key={p.id} className="flex flex-col gap-0.5 py-1.5 first:pt-0 last:pb-0">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    {linkPeople ? (
                      <Link to="/contratos" search={{ lista: 'pessoas', pessoa: p.person_id }} className="font-medium text-primary hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{p.name}</span>
                    )}
                    <Badge tone={ROLE_TONE[p.role]}>
                      {roleLabel(p.role, k.kind)}
                      {p.share_pct !== null && p.share_pct < 100 ? ` · ${formatPct(p.share_pct)}` : ''}
                    </Badge>
                  </span>
                  {(p.document || p.email || p.phone) && (
                    <span className="num text-xs text-muted">{[p.document && maskDocument(p.document), p.email, p.phone && formatPhone(p.phone)].filter(Boolean).join(' · ')}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nenhuma parte registrada.</p>
          )}
        </Block>
        <Block title="Imóvel e datas">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{k.unit_label ?? `${k.property_name} (imóvel inteiro)`}</span>
            {/* Dentro da ficha do imóvel (openInPage) o imóvel já é a página aberta: o link sairia para o mesmo lugar. */}
            {can(s, 'properties:view') && !openInPage && (
              <Link
                to="/imoveis/$propertyId"
                params={{ propertyId: k.property_id }}
                search={k.unit_id ? { unidade: k.unit_id } : {}}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Abrir imóvel
                <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              </Link>
            )}
          </p>
          <DescriptionList
            columns={2}
            items={[
              { label: 'Início', value: <span className="num">{formatDate(k.start_date)}</span> },
              { label: 'Fim', value: <span className="num">{formatDate(k.end_date)}</span> },
              ...(signed ? [{ label: 'Vigente desde', value: <span className="num">{formatDate(signed)}</span> }] : []),
              ...(k.kind === 'lease' ? [{ label: 'Próximo reajuste', value: nextAdjustment ? <span className="num">{formatDate(nextAdjustment)}</span> : <span className="text-muted">Sem previsão</span> }] : []),
            ]}
          />
        </Block>
      </div>
      <Block title="Documentos do contrato">
        <DocumentList
          docs={docs.data}
          loading={docs.isLoading}
          error={docs.error}
          onRetry={() => docs.refetch()}
          attach={{ target: `contract:${k.id}`, label: `Contrato ${k.code}` }}
          empty={team ? 'Nenhum documento anexado.' : 'Nenhum documento liberado para você neste contrato.'}
        />
      </Block>
      {(onShowFicha || openInPage) && (
        // Só com "Ver ficha e ações" a faixa inteira some a partir de 1280 px (a ficha já está ao lado).
        <div className={cn('flex flex-wrap gap-2 border-t border-border pt-3', !openInPage && 'xl:hidden')}>
          {onShowFicha && (
            <Button size="sm" className="xl:hidden" icon={<PanelRight className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={onShowFicha}>
              Ver ficha e ações
            </Button>
          )}
          {openInPage && (
            <Link
              to="/contratos"
              search={{ contrato: k.id }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:border-border-strong hover:bg-surface-2"
            >
              <ExternalLink className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Abrir em Contratos e pessoas
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- contratos de um imóvel ou de uma unidade */

const STATUSES = Object.keys(CONTRACT_STATUS) as ContractStatus[]

/**
 * Os contratos de um imóvel (aba Contratos da ficha) ou de uma unidade (bloco Contratos da unidade
 * escolhida), com a mesma linha que abre. Aqui a linha aberta fica só na memória da tela: a escolha
 * da ficha do imóvel é a unidade (no endereço); abrir um contrato é olhar dentro dele, sem trocar
 * de assunto. Locação por padrão; na imobiliária o filtro "Tipo" mostra a administração do imóvel.
 */
export function PlaceContracts({ where, storageKey }: { where: { property: string } | { unit: string }; storageKey: string }) {
  const s = useSession()
  const team = !isPortal(s)
  const list = useListState(storageKey)
  const unitId = 'unit' in where ? where.unit : null
  // O recorte fixo vai na consulta; a chave do cache leva o texto dele (o objeto muda a cada desenho).
  const fixed: Record<string, string[]> = 'unit' in where ? { unit: [where.unit] } : { property: [where.property] }
  const fixedKey = 'unit' in where ? `u:${where.unit}` : `p:${where.property}`
  const q = useRepo('contratos:do-lugar', (sess) => listContractsForScreen(sess, list.params, fixed), [list.params, fixedKey])
  const [open, setOpen] = useState<string | null>(null)
  const filters: FilterDef[] = [
    { key: 'status', label: 'Situação', options: STATUSES.map((v) => ({ value: v, label: CONTRACT_STATUS[v] })) },
    // Contrato de administração é do imóvel inteiro (com o dono): só existe na imobiliária e não tem unidade.
    ...(s.org.kind === 'agency' && !unitId && team ? [{ key: 'kind', label: 'Tipo', options: (['lease', 'management'] as ContractKind[]).map((v) => ({ value: v, label: CONTRACT_KIND[v] })) }] : []),
  ]
  return (
    <div className="flex flex-col gap-3">
      <ListToolbar
        state={list}
        noun={['contrato', 'contratos']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        searchPlaceholder={unitId ? 'Buscar por código ou pessoa' : 'Buscar por código, unidade ou pessoa'}
        filters={filters}
      >
        {team && can(s, 'contracts:edit') && (
          <Link
            to="/contratos/novo"
            search={unitId ? { unidade: unitId } : {}}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium whitespace-nowrap text-on-primary hover:bg-primary-hover"
          >
            <Plus className="size-4" aria-hidden="true" />
            Novo contrato
          </Link>
        )}
      </ListToolbar>
      <ExpandTable
        caption={unitId ? 'Contratos da unidade' : 'Contratos do imóvel'}
        columns={contractColumns({ showUnit: !unitId })}
        rows={q.data?.rows}
        rowKey={(k) => k.id}
        rowLabel={(k) => `contrato ${k.code}`}
        openKey={open}
        onToggle={(k) => setOpen((cur) => (cur === k.id ? null : k.id))}
        renderExpansion={(k) => <ContractExpansion contractId={k.id} openInPage={can(s, 'contracts:view')} />}
        sort={list.sort}
        onSort={list.toggleSort}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={
          <EmptyState
            title="Nenhum contrato"
            description={list.activeFilterCount ? 'Nenhum contrato passa nos filtros ligados. Limpe os filtros para ver todos.' : unitId ? 'Os contratos de locação desta unidade aparecem aqui.' : 'As locações das unidades deste imóvel aparecem aqui, do rascunho ao encerramento.'}
            action={list.activeFilterCount ? <Button onClick={list.clearFilters}>Limpar filtros</Button> : undefined}
          />
        }
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
    </div>
  )
}
