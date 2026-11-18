/* =============================================================================
   VagasTable: a tabela das vagas de garagem (pedido de 06/11/2026: "de quem é aquela vaga").
   Os dados (lugar, locatário, "Mora/aluga aqui") saem de vagas.ts; aqui só se desenha.

   Três usos, a mesma tabela (uma ficha por coisa: a linha abre a ficha da vaga, /unidades/<id>,
   porque a vaga é uma unidade):
     1. ficha do imóvel: <VagasTable propertyId={id} onSelect={(unitId) => ...} />
        as vagas dele; com onSelect, clicar na linha ESCOLHE a vaga na mesma tela (o 3D acende a
        vaga e o painel ao lado mostra a ficha dela), em vez de abrir outra página;
     2. ficha da pessoa: <VagasTable personId={id} /> as vagas que ela aluga hoje;
     3. página Imóveis, categoria Vagas: <VagasTable list={lista} showProperty onHoverProperty={...} />
        todas as vagas, com a coluna Imóvel. A barra de busca e filtros fica em cima do mapa (um filtro
        só por tela), e a tabela segue o mesmo estado (useSpotList devolve a mesma consulta à página).

   Sem "list" (usos 1 e 2), a tabela guarda a própria ordem e página e mostra só o total e o
   "Exportar" (o mesmo menu de toda lista: planilha .xlsx ou CSV, 07/11/2026): a ficha já tem o
   filtro dela em cima do desenho, e uma segunda barra de filtros competiria com ele.
   No uso 3 as colunas vêm da página (botão "Colunas" da barra única); nos outros, as do padrão.
   ============================================================================= */
import type { MouseEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useSession } from '@/auth/SessionProvider'
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { UnitStatusBadge } from '@/components/ui/Badge'
import { exportColumnsOf, isColumnVisible } from '@/components/ui/columns'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ExportMenu } from '@/components/ui/ExportMenu'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/States'
import { useRepo } from '@/data/hooks'
import { UNIT_STATUS } from '@/data/labels'
import type { ListParams } from '@/data/query'
import { csvMoney } from '@/lib/csv'
import { formatDate } from '@/lib/dates'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatBRL } from '@/lib/money'
import { plural } from '@/lib/text'
import { useListState, type ListState } from '@/lib/useListState'
import { listSpots, RENTER_KIND, residentLabel, type SpotRow, type SpotScope } from './vagas'

export interface VagasTableProps {
  /** Só as vagas deste imóvel (ficha do imóvel). */
  propertyId?: string
  /** Só as vagas que esta pessoa aluga hoje (ficha da pessoa). */
  personId?: string
  /**
   * Lista controlada de fora (página Imóveis): busca, filtros, ordem e página vêm da barra única
   * da página. Sem ela, a tabela guarda a própria ordem e página e mostra o total e o CSV.
   */
  list?: ListState
  /** Liga a coluna Imóvel (lista de todas as vagas). */
  showProperty?: boolean
  /** Clique na linha (ou no código) escolhe a vaga na mesma tela em vez de navegar; recebe o id da vaga (a vaga é uma unidade). */
  onSelect?: (unitId: string) => void
  /** Mouse em cima de uma linha: o id do imóvel dela (a página Imóveis acende o pino); null ao sair. */
  onHoverProperty?: (propertyId: string | null) => void
  /** Colunas à vista escolhidas fora (página Imóveis, botão "Colunas"); sem isto, as do padrão. */
  columns?: Column<SpotRow>[]
}

/** A consulta da tabela. Exportada para a página Imóveis ler a MESMA (barra e tabela com o mesmo número). */
export function useSpotList(params: ListParams, where: SpotScope = {}, enabled = true) {
  return useRepo('imoveis:vagas', (sess) => listSpots(sess, params, where), [params, where.propertyId ?? null, where.personId ?? null], { enabled })
}

/**
 * Baixa o que a lista mostra (busca e filtros valendo; todas as páginas), com as colunas pedidas.
 * Sem colunas, vão as do padrão da tabela (ficha do imóvel e da pessoa, que não têm "Colunas").
 */
export async function exportSpots(s: Session, params: ListParams, format: ExportFormat, where: SpotScope = {}, columns?: Column<SpotRow>[]): Promise<void> {
  const all = await listSpots(s, { ...params, page: 1, pageSize: 100_000 }, where)
  const cols = columns ?? spotColumns({ showProperty: !where.propertyId, linkPeople: false }).filter((c) => isColumnVisible(c, { on: [], off: [] }))
  await downloadTable('vagas', all.rows, exportColumnsOf(cols), format)
}

/**
 * As colunas. "Mora/aluga aqui" mostra o código da casa, apartamento ou sala do locatário no mesmo
 * imóvel; vazio é alguém de fora. Locatário vira link só para quem pode abrir o cadastro de pessoas.
 * "export" diz o que cada uma vira no arquivo; as "optional" ficam no menu "Colunas".
 */
export function spotColumns({ showProperty, linkPeople, onSelect }: { showProperty: boolean; linkPeople: boolean; onSelect?: (unitId: string) => void }): Column<SpotRow>[] {
  // O clique no link ou no botão não pode disparar também o clique da linha (abriria a ficha junto).
  const stop = (e: MouseEvent) => e.stopPropagation()
  const cols: Column<SpotRow>[] = [
    {
      key: 'code', header: 'Vaga', sortable: true, firstDir: 'asc', locked: true,
      export: [{ label: 'Vaga', value: (r) => r.code }],
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <Link
            to="/unidades/$unitId"
            params={{ unitId: r.id }}
            className="font-medium hover:underline"
            onClick={(e) => {
              stop(e)
              // Com onSelect, o clique simples escolhe na mesma tela; Ctrl+clique continua abrindo noutra aba.
              if (!onSelect || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              onSelect(r.id)
            }}
          >
            {r.code}
          </Link>
          {/* No celular as colunas Imóvel e Área somem: o que falta vem embaixo do código. */}
          <span className="line-clamp-1 text-xs text-muted sm:hidden">{showProperty ? `${r.property_name} · ${r.place}` : r.place}</span>
        </span>
      ),
    },
  ]
  if (showProperty) {
    cols.push({ key: 'property', header: 'Imóvel', sortable: true, firstDir: 'asc', hideBelow: 'sm', className: 'max-w-56', export: [{ label: 'Imóvel', value: (r) => r.property_name }], cell: (r) => <span className="line-clamp-2">{r.property_name}</span> })
  }
  cols.push(
    { key: 'place', header: 'Área ou andar', sortable: true, firstDir: 'asc', hideBelow: 'sm', export: [{ label: 'Área ou andar', value: (r) => r.place }], cell: (r) => r.place },
    { key: 'status', header: 'Situação', sortable: true, firstDir: 'asc', export: [{ label: 'Situação', value: (r) => UNIT_STATUS[r.status] }], cell: (r) => <UnitStatusBadge status={r.status} /> },
    {
      key: 'renter', header: 'Locatário', sortable: true, firstDir: 'asc', hideBelow: 'md', className: 'max-w-56',
      export: [{ label: 'Locatário', value: (r) => r.renter_name }],
      cell: (r) =>
        r.renter_id && linkPeople ? (
          <Link to="/pessoas/$personId" params={{ personId: r.renter_id }} className="line-clamp-2 hover:underline" onClick={stop}>
            {r.renter_name}
          </Link>
        ) : (
          <span className="line-clamp-2">{r.renter_name}</span>
        ),
    },
    {
      key: 'resident', header: 'Mora/aluga aqui', sortable: true, firstDir: 'asc', hideBelow: 'md',
      export: [{ label: 'Mora/aluga aqui', value: (r) => r.resident_codes.join(', ') }],
      cell: (r) => (r.resident_codes.length ? <span title={r.resident_codes.join(', ')}>{residentLabel(r.resident_codes)}</span> : null),
    },
    { key: 'renter_kind', header: 'Quem aluga', optional: true, hideBelow: 'md', export: [{ label: 'Quem aluga', value: (r) => RENTER_KIND[r.renter_kind] }], cell: (r) => <span className="text-[13px] whitespace-nowrap">{RENTER_KIND[r.renter_kind]}</span> },
    {
      key: 'rent', header: 'Mensalidade', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'sm',
      export: [
        { label: 'Mensalidade (R$)', value: (r) => csvMoney(r.lease?.rent_cents) },
        { label: 'Aluguel pedido (R$)', value: (r) => (r.lease ? '' : csvMoney(r.asking_rent_cents)) },
      ],
      cell: (r) =>
        r.lease ? (
          formatBRL(r.lease.rent_cents)
        ) : r.asking_rent_cents ? (
          <span className="flex flex-col items-end text-muted" title="Valor pedido no anúncio (sem contrato vigente)">
            <span className="whitespace-nowrap">{formatBRL(r.asking_rent_cents)}</span>
            <span className="text-[11px]">pedido</span>
          </span>
        ) : null,
    },
    { key: 'contract', header: 'Contrato', optional: true, hideBelow: 'md', export: [{ label: 'Contrato', value: (r) => r.lease?.code }], cell: (r) => <span className="num text-[13px]">{r.lease?.code}</span> },
    { key: 'end_date', header: 'Fim do contrato', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md', export: [{ label: 'Fim do contrato', value: (r) => formatDate(r.lease?.end_date) }], cell: (r) => formatDate(r.lease?.end_date) },
  )
  return cols
}

export function VagasTable({ propertyId, personId, list, showProperty = false, onSelect, onHoverProperty, columns }: VagasTableProps) {
  const s = useSession()
  const navigate = useNavigate()
  // Ganchos não podem ser condicionais: o estado próprio existe sempre e só vale quando ninguém manda "list".
  // A chave é uma por uso (ficha de imóvel, de pessoa): a ordem escolhida vale para todas as fichas iguais.
  const own = useListState(personId ? 'vagas-pessoa' : 'vagas-imovel')
  const state = list ?? own
  const where: SpotScope = { propertyId, personId }
  const q = useSpotList(state.params, where)
  const rows = q.data?.rows
  // Alugadas = vagas com locação vigente (sem filtro nenhum na ficha, a contagem "ocupada" da situação é exatamente isso).
  const rented = q.data?.facets.status?.occupied ?? 0

  // Mouse numa linha acende o pino do imóvel dela. A DataTable não avisa qual linha está sob o mouse:
  // a conta é pela POSIÇÃO da linha no corpo da tabela, que segue a ordem de "rows".
  const hover = onHoverProperty
    ? {
        onMouseOver: (e: MouseEvent) => {
          const tr = e.target instanceof Element ? e.target.closest('tbody > tr') : null
          const row = tr?.parentElement ? rows?.[Array.prototype.indexOf.call(tr.parentElement.children, tr)] : undefined
          onHoverProperty(row ? row.property_id : null)
        },
        onMouseLeave: () => onHoverProperty(null),
      }
    : {}

  const filtered = !!list && list.activeFilterCount > 0
  return (
    <div className="flex flex-col gap-3">
      {!list && q.data && q.data.totalAll > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            {plural(q.data.totalAll, 'vaga', 'vagas')} · {plural(rented, 'alugada', 'alugadas')}
          </p>
          <ExportMenu size="sm" total={q.data.total} onExport={(f) => exportSpots(s, state.params, f, where)} />
        </div>
      )}
      <div {...hover}>
        <DataTable
          caption={personId ? 'Vagas que a pessoa aluga' : 'Vagas de garagem'}
          columns={columns ?? spotColumns({ showProperty, linkPeople: can(s, 'people:view'), onSelect }).filter((c) => !c.optional)}
          rows={rows}
          rowKey={(r) => r.id}
          sort={state.sort}
          onSort={state.toggleSort}
          onRowClick={(r) => (onSelect ? onSelect(r.id) : void navigate({ to: '/unidades/$unitId', params: { unitId: r.id } }))}
          loading={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={
            <EmptyState
              title={filtered ? 'Nenhuma vaga encontrada' : 'Nenhuma vaga'}
              description={
                filtered
                  ? 'Nenhuma vaga passa na busca e nos filtros ligados. Limpe os filtros para ver todas.'
                  : personId
                    ? 'A pessoa não aluga vaga de garagem hoje.'
                    : 'As vagas de garagem aparecem aqui quando o imóvel tem estacionamento cadastrado.'
              }
            />
          }
        />
      </div>
      {q.data && q.data.total > 0 && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={state.setPage} onPageSize={state.setPageSize} />}
    </div>
  )
}
