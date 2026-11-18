/* =============================================================================
   Imóveis: UMA tela, lida de cima para baixo. Segunda rodada de 06/11, pedido do Fernando: "não
   quero mudança direto de aba/página por interações simples. quero que o mapa seja sempre o foco,
   tabela pequena à direita com informações simples, abaixo tabelas e históricos mais detalhados".
     1. indicadores: clicar num deles mostra as unidades daquela situação;
     2. "Mostrar: Imóveis | Unidades | Vagas": escolhe o que a tela lista (e quais filtros a barra tem);
     3. UMA barra de busca e filtros, que vale para o mapa E para a tabela;
     4. a linha principal: o MAPA (o foco, cerca de 2/3) e, à direita, a ficha curta (FichaCurta.tsx):
        o resumo do recorte quando nada está escolhido, ou o básico do imóvel, da unidade ou da vaga
        escolhida. Abaixo de 1280 px a ficha desce para baixo do mapa;
     5. a tabela com os dados das MESMAS coisas, com a linha escolhida marcada.

   Vagas de garagem (06/11/2026) são unidades do tipo "parking", mas têm categoria própria: a
   categoria Unidades e os indicadores contam só casa, apartamento e sala (recorte spot: ['nao'],
   posto em toda consulta e nunca guardado na lista, para o "Limpar" não trazer as vagas de volta).
   A categoria Vagas mostra de quem é cada vaga e onde o locatário mora (VagasTable).

   Clique simples ESCOLHE, nunca muda de página:
   - pino: escolhe o imóvel (o pino fica marcado e a ficha curta mostra o básico dele);
   - linha de imóvel: o mesmo; linha de unidade ou de vaga: escolhe o imóvel dela no mapa E mostra a
     unidade (ou a vaga) na ficha curta. Se o mapa saiu da vista (a pessoa rolou até a tabela), a
     página volta até ele;
   - mudar de página é só pelos botões da ficha curta: "Abrir imóvel" (/imoveis/<id>) e "Abrir no
     imóvel" (/imoveis/<id>?unidade=<id>, a página do imóvel já com a unidade escolhida).
   A ficha curta mostra o BÁSICO; o completo continua só na página do imóvel (uma ficha por coisa).

   Como a barra única funciona: cada categoria tem a SUA lista lembrada no navegador
   (imobil:list:imoveis, imobil:list:unidades e imobil:list:vagas, pelo useListState). A barra mostra
   os filtros da categoria aberta e o mapa lê a mesma lista. Ao trocar de categoria, a busca e os
   filtros que querem dizer a mesma coisa nas duas (situação, imóvel, carteira, bairro) vão junto, para
   o mapa não "esquecer" o recorte. Outra tela que manda para as unidades já filtradas grava
   imobil:list:unidades antes de navegar (rememberList, na Visão geral).

   O endereço guarda a categoria e a escolha (?lista=imoveis|unidades|vagas&imovel=<id>&unidade=<id>).
   A escolha troca o endereço com `replace` (o Voltar não desfaz cada clique) e sem rolar a página.
   Endereços antigos: parseImoveisSearch (o ?imovel= do 3D antigo agora escolhe o imóvel no mapa).

   O proprietário (portal) vê a mesma tela como "Meus imóveis": o escopo do repositório já
   devolve só as unidades dele, então a tela não filtra nada à mão (filtrar na tela seria
   esconder, e esconder não protege; quem protege é o escopo, espelho da RLS).

   Rapidez e altura (07/11/2026, "tá muito travado" e "o mapa fica menor que 3 heroes"):
   - escolher (pino ou linha) troca só o endereço. O corpo da página é memo e NÃO lê a escolha:
     quem lê é a linha principal (Stage: mapa + ficha curta) e o marcador da linha (RowMarker),
     cada um pedindo ao roteador só ?imovel= e ?unidade=. Antes, cada escolha redesenhava a página
     inteira (indicadores, barra, tabela), uns 80 ms medidos no modo de desenvolvimento;
   - o mouse em cima de uma linha passa pelo canal do mapa (mapa/hover.ts): só o mapa redesenha;
   - "Mostrar" foi para a mesma linha da busca e dos filtros, a faixa de indicadores ficou baixa e o
     mapa cresceu (MAP_H): o mapa começa a uns 250 px do topo em 1366 x 768 (era 535).

   Barra única, Colunas e Comparar (07/11/2026, "deixar eu comparar imóveis e unidades" e "filtros
   enormes ... tudo muito contra-intuitivo"):
   - a barra é a ListToolbar de toda lista: busca, "Filtros" (painel), "Colunas" e "Exportar"
     (planilha ou CSV com as colunas à vista). "Mostrar arquivadas" virou caixa dentro de Filtros;
   - cada categoria tem a sua escolha de colunas (imobil:colunas:imoveis, :unidades, :vagas);
   - Imóveis e Unidades têm a caixa "Comparar" na primeira coluna: marcar NÃO escolhe nem muda a
     página (o clique na caixa é ignorado pelo useTableRows); a faixa do rodapé abre a comparação.
   ============================================================================= */
import { memo, useEffect, useMemo, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Plus, Upload } from 'lucide-react'
import { useHoverChannel, type HoverChannel } from '@/modules/mapa/hover'
import { ASIDE_H, CityMap } from '@/modules/mapa/MapPage'
import { listMapPins, listMapProperties, type ListKind, type MapPin, type MapPropertyRow } from '@/modules/mapa/repo'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, hasFeature, isPortal } from '@/auth/permissions'
import { cn } from '@/components/ui/cn'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { compareColumn, useCompare } from '@/components/ui/Compare'
import { exportColumnsOf, useColumnChooser } from '@/components/ui/columns'
import { KpiTile, PageHeader } from '@/components/ui/Layout'
import { ListToolbar, type FilterDef } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useRepo } from '@/data/hooks'
import { PROPERTY_KIND, UNIT_KIND, UNIT_STATUS } from '@/data/labels'
import type { ListParams } from '@/data/query'
import { listUnits, type UnitRow } from '@/data/views/units'
import { csvMoney } from '@/lib/csv'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatBRL } from '@/lib/money'
import { readJSON, writeJSON } from '@/lib/storage'
import { plural } from '@/lib/text'
import { useListState, type ListState } from '@/lib/useListState'
import { formatPctNumber, OccupancyBar, STATUS_ORDER, unitColumns } from './components'
import { listPlaceOptions } from './repo'
import { PropertyCompareBar, UnitCompareBar } from './CompareViews'
import { FichaEscolha, ResumoRecorte, useRevealOnNarrow, type Escolha } from './FichaCurta'
import { listSpotPins, RENTER_KIND, type SpotRow } from './vagas'
import { exportSpots, spotColumns, useSpotList, VagasTable } from './VagasTable'

/** A categoria da tabela embaixo do mapa: as duas do mapa (imóvel ou unidade por linha) e a vaga de garagem por linha. */
export type ListaKind = ListKind | 'vagas'
const KINDS: ListaKind[] = ['imoveis', 'unidades', 'vagas']

export interface ImoveisSearch {
  /** Categoria da tabela embaixo do mapa. Vazio = a última escolhida neste navegador. */
  lista?: ListaKind
  /** Imóvel escolhido no mapa (a ficha curta mostra o básico dele). */
  imovel?: string
  /** Unidade ou vaga escolhida na tabela; só vale junto do imóvel dela. */
  unidade?: string
}
const LIST_KEY = 'imobil:imoveis:lista'
/** Filtros que querem dizer a mesma coisa nas categorias: vão junto ao trocar (a barra é uma só). */
const SHARED_FILTERS = ['status', 'property', 'portfolio', 'district']
/** Os filtros que a barra de cada categoria tem (só o que as DUAS têm vai junto na troca). */
const FILTER_KEYS: Record<ListaKind, string[]> = {
  imoveis: ['kind', 'status', 'portfolio', 'district', 'manager'],
  unidades: ['status', 'kind', 'property', 'portfolio', 'district', 'archived'],
  vagas: ['status', 'property', 'place', 'renter', 'district'],
}

/**
 * Recorte "sem vagas" da categoria Unidades: posto na consulta (e nos pinos), nunca na lista lembrada.
 * Guardado na lista, o "Limpar" o apagaria e as 120 vagas voltariam para o meio das unidades.
 */
export function homesOnly(params: ListParams): ListParams {
  return { ...params, filters: { ...params.filters, spot: ['nao'] } }
}

/** Id que veio do endereço: texto curto e não vazio (dado de fora; o repositório confere o acesso depois). */
const idParam = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : undefined)

/**
 * Lê o endereço (dado de fora: só passa o que é conhecido; o resto é ignorado sem quebrar a tela).
 * Endereços de antes da tela única (06/11): ?modo=mapa|unidades|imovel são aceitos e ignorados;
 * ?modo=imoveis vira ?lista=imoveis. O ?imovel=<id>&unidade=<id> do 3D antigo agora ESCOLHE o
 * imóvel (e a unidade) no mapa desta tela; 'avulsos' (a caixa dos imóveis sem bloco, que não é um
 * imóvel) é jogado fora.
 */
export function parseImoveisSearch(search: Record<string, unknown>): ImoveisSearch {
  const out: ImoveisSearch = {}
  if (KINDS.includes(search.lista as ListaKind)) out.lista = search.lista as ListaKind
  else if (search.modo === 'imoveis') out.lista = 'imoveis'
  const imovel = idParam(search.imovel)
  if (imovel && imovel !== 'avulsos') {
    out.imovel = imovel
    const unidade = idParam(search.unidade)
    if (unidade) out.unidade = unidade
  }
  return out
}

/** Chaves dos endereços de antes da tela única: quando aparecem, a rota limpa o endereço (link velho não circula). */
export const OLD_SEARCH_KEYS = ['modo', 'bloco']

export function PropertiesPage({ search }: { search: ImoveisSearch }) {
  const s = useSession()
  const portal = isPortal(s)
  return (
    <Guard action="properties:view" what="os imóveis">
      <PageHeader
        eyebrow={portal ? 'Portal do proprietário' : 'Imóveis'}
        title={portal ? 'Meus imóveis' : 'Imóveis e unidades'}
        description={portal ? 'As unidades de que você é dono, com a situação de cada uma hoje.' : undefined}
        info={portal ? undefined : 'Cadastro de imóveis, blocos e unidades. A situação "ocupada" vem do contrato vigente; as outras são escolhidas à mão.'}
        actions={
          <>
            {/* Importar planilha mora aqui (e em Configurações): o menu "Dados" saiu para simplificar. */}
            {can(s, 'data:import') && (
              <Link to="/dados/importar" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium transition-colors duration-150 hover:border-border-strong">
                <Upload className="size-4" strokeWidth={1.5} aria-hidden="true" />
                Importar planilha
              </Link>
            )}
            {can(s, 'properties:edit') && (
              // Link com cara de botão (e não botão dentro de link, que o HTML não permite): abre em nova aba também.
              <Link to="/imoveis/novo" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover max-sm:min-h-11">
                <Plus className="size-4" aria-hidden="true" />
                Cadastrar imóvel
              </Link>
            )}
          </>
        }
      />
      {/* Só a categoria entra aqui: a escolha (?imovel=, ?unidade=) é lida mais embaixo, por quem precisa dela. */}
      <PropertiesBody lista={search.lista} />
    </Guard>
  )
}

/** O que está escolhido no endereço, lido aos pedaços: só quem chama desenha de novo quando muda. */
function useEscolha(): Escolha | null {
  const imovel = useSearch({ from: '/imoveis/', select: (q) => q.imovel })
  const unidade = useSearch({ from: '/imoveis/', select: (q) => q.unidade })
  return useMemo(() => (imovel ? { propertyId: imovel, unitId: unidade } : null), [imovel, unidade])
}

const PropertiesBody = memo(function PropertiesBody({ lista }: { lista?: ListaKind }) {
  const session = useSession()
  const navigate = useNavigate()
  const propList = useListState('imoveis')
  const unitList = useListState('unidades')
  const spotList = useListState('vagas')
  const [storedKind, setStoredKind] = useState<ListaKind>(() => {
    const k = readJSON<ListaKind>(LIST_KEY)
    return k && KINDS.includes(k) ? k : 'imoveis'
  })
  const kind = lista ?? storedKind
  const lists: Record<ListaKind, ListState> = { imoveis: propList, unidades: unitList, vagas: spotList }
  const list = lists[kind]
  /** Imóvel acendido no mapa (mouse numa linha da tabela ou num pino): um canal, não estado da página. */
  const hover = useHoverChannel()

  // A linha principal (mapa + ficha curta): escolher pela tabela traz ela de volta à vista.
  const stageRef = useRef<HTMLDivElement>(null)

  // A categoria mora no endereço (o Voltar funciona) e fica lembrada para a próxima visita.
  // `replace` ao trocar pelo "Mostrar" (voltar não deve desfazer cada troca); o indicador empilha.
  // O imóvel escolhido continua escolhido (a unidade não: ela só existe na tabela de onde veio).
  // resetScroll: false porque trocar o endereço não pode jogar a página para o topo.
  const showKind = (k: ListaKind, replace: boolean) => {
    setStoredKind(k)
    writeJSON(LIST_KEY, k)
    void navigate({ to: '/imoveis', search: (prev) => ({ lista: k, imovel: prev.imovel }), replace, resetScroll: false })
  }
  /**
   * Escolher (ou limpar, com null): só o endereço muda; a página fica onde está. A categoria de antes
   * passa pelo parseImoveisSearch: o "prev" do roteador mistura os endereços de todas as telas (o
   * ?lista= de Contratos tem outros valores), e só o que vale aqui pode seguir.
   */
  const choose = (next: Escolha | null) =>
    void navigate({ to: '/imoveis', search: (prev) => ({ lista: parseImoveisSearch(prev).lista, imovel: next?.propertyId, unidade: next?.unitId }), replace: true, resetScroll: false })
  /**
   * Escolher pela TABELA: além de escolher, se menos da metade do MAPA está na vista (a pessoa rolou
   * até a tabela), a página volta até a linha principal, onde o pino marcado e a ficha curta mostram o
   * escolhido. Conta pelo mapa, não pela linha inteira: só a legenda aparecendo não é "o mapa na vista".
   */
  const chooseFromTable = (next: Escolha) => {
    choose(next)
    const stage = stageRef.current
    const map = stage?.firstElementChild
    if (!stage || !map) return
    const r = map.getBoundingClientRect()
    const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)
    if (visible < r.height / 2) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      stage.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
    }
  }
  /* "Mostrar": a busca e os filtros comuns vão junto, então o mapa continua com o mesmo recorte. */
  const switchKind = (k: ListaKind) => {
    if (k === kind) return
    const [from, to] = [lists[kind], lists[k]]
    // Só o filtro que as DUAS barras têm vai junto: o outro ficaria ligado sem aparecer (e sem "Limpar").
    const shared = SHARED_FILTERS.filter((f) => FILTER_KEYS[kind].includes(f) && FILTER_KEYS[k].includes(f))
    to.replaceFilters({ ...to.filters, ...Object.fromEntries(shared.map((f) => [f, from.filters[f] ?? []])) })
    to.setSearchInput(from.searchInput)
    showKind(k, true)
  }

  // O mapa segue a busca e os filtros da categoria aberta, não a página nem a ordem: virar a página não mexe nele.
  const { search, filters } = list.params
  const pinParams = useMemo(() => ({ search, filters }), [search, filters])
  // Vagas: um pino por imóvel com vaga no resultado (os números do pino são das vagas). Unidades: sem as vagas.
  const pins = useRepo(
    'imoveis:pinos',
    (sess) => (kind === 'vagas' ? listSpotPins(sess, pinParams) : listMapPins(sess, kind, kind === 'unidades' ? homesOnly(pinParams) : pinParams)),
    [kind, pinParams],
  )

  // As três categorias ficam montadas (ganchos não podem ser condicionais), mas só a aberta consulta.
  // Cada tabela recebe o que está escolhido (para marcar a linha) e o que fazer ao clicar numa linha.
  const pick: TablePick = { onPick: chooseFromTable, onHover: hover.set }
  const propView = usePropertiesView(propList, kind === 'imoveis', pick)
  const unitView = useUnitsView(unitList, kind === 'unidades', pick)
  const spotView = useSpotsView(spotList, kind === 'vagas', pick)
  const view = { imoveis: propView, unidades: unitView, vagas: spotView }[kind]
  // A opção "Vagas" só aparece para quem tem vaga para ver (o proprietário convidado, por exemplo, não tem).
  // Enquanto a contagem chega, a equipe já vê a opção (sem o botão "pular" para o lado depois de carregar).
  const spotsCount = useRepo('imoveis:vagas-total', (sess) => listSpotPins(sess, {}))
  const hasSpots = kind === 'vagas' || (spotsCount.data ? spotsCount.data.length > 0 : !isPortal(session))

  /* Faixa de indicadores: a contagem por situação das unidades que a sessão enxerga (casa, apartamento
     e sala; as vagas têm a categoria delas e não entram na ocupação). */
  const kpi = useRepo('imoveis:kpi', (sess) => listUnits(sess, homesOnly({ page: 1, pageSize: 1 })))
  const st = kpi.data?.facets.status ?? {}
  const total = kpi.data?.totalAll ?? 0
  const rentable = total - (st.blocked ?? 0)
  const occupied = st.occupied ?? 0
  const pct = rentable ? Math.round((occupied / rentable) * 1000) / 10 : 0
  const showUnits = (statuses: string[]) => {
    unitList.setFilter('status', statuses)
    showKind('unidades', false)
  }
  const loadingKpi = !kpi.data
  // Os cartões abrem a tabela de unidades já filtrada. O de Ocupação não é clicável porque tem o "i" da
  // fórmula, e botão dentro de botão é HTML inválido (o leitor de tela se perde).

  return (
    <>
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3" aria-label="Indicadores">
        <KpiTile label="Unidades" value={loadingKpi ? '…' : total.toLocaleString('pt-BR')} hint={`${plural(occupied, 'ocupada', 'ocupadas')} hoje`} onClick={() => showUnits([])} />
        <KpiTile
          label="Ocupação"
          value={loadingKpi ? '…' : formatPctNumber(pct)}
          hint={`${occupied} de ${rentable} alugáveis`}
          info="Unidades ocupadas ÷ unidades alugáveis (bloqueada não conta). Ocupada = contrato de locação vigente hoje."
        />
        <KpiTile label="Disponíveis" value={loadingKpi ? '…' : (st.available ?? 0).toLocaleString('pt-BR')} hint="prontas para alugar" tone="success" onClick={() => showUnits(['available'])} />
        <KpiTile
          label="Reservadas e em manutenção"
          value={loadingKpi ? '…' : ((st.reserved ?? 0) + (st.maintenance ?? 0)).toLocaleString('pt-BR')}
          hint={`${st.reserved ?? 0} reservadas · ${st.maintenance ?? 0} em manutenção`}
          onClick={() => showUnits(['reserved', 'maintenance'])}
        />
      </section>
      {kpi.error && <ErrorState error={kpi.error} onRetry={() => kpi.refetch()} />}

      {/* Uma barra só, em cima do mapa: o que ela filtra vale para os pinos e para a tabela. "Mostrar" abre a
          linha (troca os filtros dela), e tudo cabe numa linha só a partir de 1366 px. */}
      <ListToolbar state={list} {...view.toolbar} leading={<KindSwitch kind={kind} kinds={hasSpots ? KINDS : ['imoveis', 'unidades']} onChange={switchKind} />} />
      <Stage stageRef={stageRef} pins={pins} filtered={list.activeFilterCount > 0} hover={hover} onChoose={choose} />
      {view.table}
      {/* A faixa do Comparar da categoria aberta (some sozinha sem nada marcado). */}
      {kind === 'imoveis' && <PropertyCompareBar />}
      {kind === 'unidades' && <UnitCompareBar />}
    </>
  )
})

/**
 * A linha principal: o mapa é o foco; a ficha curta fica à direita (embaixo dele abaixo de 1280 px),
 * com a ALTURA do mapa e rolando por dentro. É o único pedaço da página que lê a escolha do
 * endereço (com o marcador da linha da tabela): escolher redesenha só ele.
 * scroll-mt-24: ao voltar até aqui, a linha principal para abaixo das duas barras grudadas do topo (32 + 48 px).
 */
function Stage({ stageRef, pins, filtered, hover, onChoose }: { stageRef: RefObject<HTMLDivElement | null>; pins: { data?: MapPin[]; error: unknown; refetch: () => unknown }; filtered: boolean; hover: HoverChannel; onChoose: (next: Escolha | null) => void }) {
  const escolha = useEscolha()
  // Abaixo de 1280 px a ficha curta fica embaixo do mapa: escolher rola até ela (o toque no pino "responde").
  const panelRef = useRef<HTMLDivElement>(null)
  useRevealOnNarrow(panelRef, escolha ? `${escolha.propertyId}:${escolha.unitId ?? ''}` : null)
  // A lista de ids muda só quando os pinos mudam (o resumo não pede de novo a cada desenho).
  const ids = useMemo(() => pins.data?.map((p) => p.id), [pins.data])
  return (
    <div ref={stageRef} className="grid scroll-mt-24 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <CityMap pins={pins.data} error={pins.error} onRetry={() => pins.refetch()} onSelect={(id) => onChoose({ propertyId: id })} selectedId={escolha?.propertyId ?? null} hover={hover} />
      </div>
      <div ref={panelRef} className={cn('min-w-0 scroll-mt-24', ASIDE_H)}>
        {escolha ? <FichaEscolha className="xl:h-full" escolha={escolha} onClear={() => onChoose(null)} /> : <ResumoRecorte className="xl:h-full" propertyIds={ids} filtered={filtered} />}
      </div>
    </div>
  )
}

const KIND_LABEL: Record<ListaKind, string> = { imoveis: 'Imóveis', unidades: 'Unidades', vagas: 'Vagas' }

/**
 * "Mostrar: Imóveis | Unidades | Vagas", no começo da barra de filtros: um imóvel, uma unidade ou
 * uma vaga por linha. É o Segmented do kit (no celular vira lista de escolha).
 */
function KindSwitch({ kind, kinds, onChange }: { kind: ListaKind; kinds: ListaKind[]; onChange: (k: ListaKind) => void }) {
  return <Segmented value={kind} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={onChange} />
}

/** O que cada categoria entrega à tela: o conteúdo da barra única e a tabela com a paginação. */
interface CategoryView {
  toolbar: Omit<ComponentProps<typeof ListToolbar>, 'state'>
  table: ReactNode
}

/** O que a página passa a cada tabela: o que fazer ao clicar numa linha e o "mouse em cima". A escolha ela não recebe (ver RowMarker). */
interface TablePick {
  onPick: (next: Escolha) => void
  onHover: (propertyId: string | null) => void
}

/** A linha da tabela sob o evento, pela POSIÇÃO dela no corpo da tabela (que segue a ordem de `rows`). */
function rowAt<T>(target: EventTarget | null, rows: T[] | undefined): T | undefined {
  const tr = target instanceof Element ? target.closest('tbody > tr') : null
  return tr?.parentElement ? rows?.[Array.prototype.indexOf.call(tr.parentElement.children, tr)] : undefined
}

/** Fundo e filete à esquerda da linha escolhida (o atributo é posto pelo RowMarker), entrando com transição curta. */
const PICKED_ROW =
  '[&_tbody>tr>td:first-child]:transition-shadow [&_tbody>tr>td:first-child]:duration-150 [&_tbody>tr[data-escolhida]]:bg-primary-soft [&_tbody>tr[data-escolhida]>td:first-child]:shadow-[inset_3px_0_0_var(--primary)]'

/**
 * O invólucro de cada tabela: clicar numa linha ESCOLHE, a escolhida fica marcada e o mouse em cima
 * acende o pino. Passo a passo:
 * 1. clique simples (sem Ctrl, Cmd, Shift ou Alt) em qualquer ponto de uma linha, inclusive no
 *    código da unidade (que é um link para quem usa teclado), menos na caixa "Comparar" (que só
 *    marca): escolhe a linha e NÃO navega. É feito
 *    na fase de CAPTURA (onClickCapture), que chega antes do clique da linha e do link: a tabela de
 *    vagas (VagasTable) e as colunas de unidade (unitColumns) navegam no clique, e são de outro
 *    arquivo. Ctrl ou Cmd + clique continua abrindo o link em outra aba (escolha explícita);
 * 2. a linha escolhida ganha o atributo data-escolhida (a DataTable não tem "linha escolhida"; a
 *    conta é pela posição, como no "mouse em cima"). Quem marca é o RowMarker, que é o único a ler a
 *    escolha do endereço: escolher não redesenha a tabela;
 * 3. mouse em cima de uma linha acende o pino do imóvel dela (pelo canal do mapa, sem desenhar a página).
 */
// atalho: escolher e marcar a linha por fora da DataTable (captura + atributo no DOM); quando a DataTable e a VagasTable aceitarem onRowClick e selectedKey, passar por elas.
function useTableRows<T>(rows: T[] | undefined, toEscolha: (r: T) => Escolha, pick: TablePick) {
  const ref = useRef<HTMLDivElement>(null)
  return {
    ref,
    className: PICKED_ROW,
    // Passo 1.
    onClickCapture: (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
      // A caixa "Comparar" é outra coisa: marcar não escolhe a linha nem muda a página.
      if (e.target instanceof Element && e.target.closest('[data-comparar]')) return
      const row = rowAt(e.target, rows)
      if (!row) return
      e.preventDefault() // o link da célula não navega
      e.stopPropagation() // nem o clique da linha (VagasTable) roda
      pick.onPick(toEscolha(row))
    },
    // Passo 3.
    onMouseOver: (e: MouseEvent) => {
      const row = rowAt(e.target, rows)
      pick.onHover(row ? toEscolha(row).propertyId : null)
    },
    onMouseLeave: () => pick.onHover(null),
  }
}

/**
 * Passo 2 do useTableRows, num pedaço que não desenha nada: lê do endereço só o campo da escolha
 * (?imovel= na tabela de imóveis, ?unidade= nas de unidades e vagas) e marca a linha. Refaz depois
 * de cada desenho (página, ordem ou filtro novos trazem outras linhas).
 */
function RowMarker<T>({ rootRef, rows, keyOf, field }: { rootRef: RefObject<HTMLDivElement | null>; rows: T[] | undefined; keyOf: (r: T) => string; field: 'imovel' | 'unidade' }) {
  const picked = useSearch({ from: '/imoveis/', select: (q) => q[field] })
  useEffect(() => {
    rootRef.current?.querySelectorAll('tbody > tr').forEach((tr, i) => {
      const row = rows?.[i]
      tr.toggleAttribute('data-escolhida', !!row && !!picked && keyOf(row) === picked)
    })
  })
  return null
}

/* ---------------------------------------------------------------- categoria Imóveis: um imóvel por linha */

function usePropertiesView(list: ListState, active: boolean, pick: TablePick): CategoryView {
  const s = useSession()
  const team = !isPortal(s)
  const q = useRepo('imoveis:lista', (sess) => listMapProperties(sess, list.params), [list.params], { enabled: active })
  const toEscolha = (p: MapPropertyRow): Escolha => ({ propertyId: p.id })
  const rowsProps = useTableRows(q.data?.rows, toEscolha, pick)
  const opts = useRepo('imoveis:opcoes', listPlaceOptions)

  const filters: FilterDef[] = [
    { key: 'kind', label: 'Tipo', options: Object.entries(PROPERTY_KIND).map(([value, label]) => ({ value, label })) },
    // Situação de imóvel = tem pelo menos uma unidade nessa situação ("Disponível" = imóveis com vaga).
    { key: 'status', label: 'Situação', options: STATUS_ORDER.map((v) => ({ value: v, label: UNIT_STATUS[v] })) },
    ...(team && hasFeature(s, 'portfolios') ? [{ key: 'portfolio', label: 'Carteira', options: opts.data?.portfolios ?? [] }] : []),
    { key: 'district', label: 'Bairro', options: opts.data?.districts ?? [] },
    ...(team && hasFeature(s, 'team') ? [{ key: 'manager', label: 'Responsável', options: opts.data?.managers ?? [] }] : []),
  ]

  // A caixa de comparar é a primeira coluna; as "optional" ficam no menu "Colunas" (desligadas por padrão).
  const compare = useCompare('imoveis')
  const allColumns: Column<MapPropertyRow>[] = [
    compareColumn<MapPropertyRow>(compare, (p) => p.id, (p) => p.name),
    {
      key: 'name', header: 'Imóvel', sortable: true, firstDir: 'asc', className: 'max-w-80', locked: true,
      export: [
        { label: 'Imóvel', value: (p) => p.name },
        { label: 'Endereço', value: (p) => `${p.address.street}, ${p.address.number}${p.address.complement ? ` ${p.address.complement}` : ''}` },
      ],
      cell: (p) => (
        <span className="flex min-w-0 flex-col items-start">
          {/* A linha inteira escolhe o imóvel; o nome é botão para quem usa teclado (a linha não recebe foco) e faz o MESMO. */}
          <button type="button" className="text-left font-medium hover:underline" aria-label={`Escolher ${p.name}`}>
            {p.name}
          </button>
          <span className="truncate text-xs text-muted">
            {p.address.street}, {p.address.number}
          </span>
        </span>
      ),
    },
    { key: 'kind', header: 'Tipo', hideBelow: 'md', export: [{ label: 'Tipo', value: (p) => PROPERTY_KIND[p.kind] }], cell: (p) => PROPERTY_KIND[p.kind] },
    { key: 'district', header: 'Bairro', hideBelow: 'lg', export: [{ label: 'Bairro', value: (p) => p.address.district }], cell: (p) => p.address.district },
    { key: 'city', header: 'Cidade', optional: true, hideBelow: 'lg', export: [{ label: 'Cidade', value: (p) => `${p.address.city}/${p.address.state}` }], cell: (p) => `${p.address.city}/${p.address.state}` },
    { key: 'units', header: 'Unidades', sortable: true, firstDir: 'desc', align: 'right', export: [{ label: 'Unidades', value: (p) => p.units_total }], cell: (p) => p.units_total },
    { key: 'occupied', header: 'Ocupadas', optional: true, align: 'right', hideBelow: 'md', export: [{ label: 'Ocupadas', value: (p) => p.units_occupied }], cell: (p) => p.units_occupied },
    { key: 'available', header: 'Disponíveis', optional: true, align: 'right', hideBelow: 'md', export: [{ label: 'Disponíveis', value: (p) => p.units_available }], cell: (p) => p.units_available || '' },
    { key: 'occupancy', header: 'Ocupação', sortable: true, firstDir: 'desc', export: [{ label: 'Ocupação (%)', value: (p) => p.occupancy_pct.toLocaleString('pt-BR') }], cell: (p) => <OccupancyBar pct={p.occupancy_pct} /> },
    {
      key: 'spots', header: 'Vagas', menuLabel: 'Vagas de garagem', optional: true, align: 'right', hideBelow: 'md',
      export: [{ label: 'Vagas', value: (p) => p.spots_total }, { label: 'Vagas alugadas', value: (p) => p.spots_rented }],
      cell: (p) => (p.spots_total ? <span title={`${p.spots_rented} de ${p.spots_total} alugadas`}>{p.spots_total}</span> : ''),
    },
    { key: 'rent_roll', header: 'Aluguel em vigor', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'sm', export: [{ label: 'Aluguel em vigor (R$)', value: (p) => csvMoney(p.rent_roll_cents) }], cell: (p) => formatBRL(p.rent_roll_cents) },
    // Proprietário independente não tem equipe nem carteira: as colunas só existem na imobiliária.
    ...(hasFeature(s, 'team') ? [{ key: 'manager', header: 'Responsável', hideBelow: 'lg', export: [{ label: 'Responsável', value: (p) => p.manager_name }], cell: (p) => p.manager_name ?? <span className="text-muted">Sem responsável</span> } satisfies Column<MapPropertyRow>] : []),
    ...(team && hasFeature(s, 'portfolios') ? [{ key: 'portfolio', header: 'Carteira', optional: true, hideBelow: 'lg', export: [{ label: 'Carteira', value: (p) => p.portfolio_name }], cell: (p) => p.portfolio_name ?? '' } satisfies Column<MapPropertyRow>] : []),
    { key: 'owners', header: 'Donos', optional: true, hideBelow: 'lg', className: 'max-w-56', export: [{ label: 'Donos', value: (p) => p.owners_label }], cell: (p) => <span className="line-clamp-2 text-muted">{p.owners_label}</span> },
  ]
  const { visible: columns, chooser } = useColumnChooser('imoveis', allColumns)

  // Exportar: todas as páginas do que a busca e os filtros mostram, com as colunas à vista.
  const exportList = async (format: ExportFormat) => {
    const all = await listMapProperties(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable('imoveis', all.rows, exportColumnsOf(columns), format)
  }

  const noData = q.data && q.data.totalAll === 0
  return {
    toolbar: {
      filters,
      facets: q.data?.facets,
      total: q.data?.total,
      totalAll: q.data?.totalAll,
      noun: ['imóvel', 'imóveis'],
      onExport: exportList,
      columns: chooser,
      searchPlaceholder: 'Buscar por nome, rua, bairro ou dono',
    },
    table: (
      <>
        <RowMarker rootRef={rowsProps.ref} rows={q.data?.rows} keyOf={(p) => p.id} field="imovel" />
        <div {...rowsProps}>
          <DataTable
            caption="Imóveis"
            columns={columns}
            rows={q.data?.rows}
            rowKey={(p) => p.id}
            sort={list.sort}
            onSort={list.toggleSort}
            // Quem escolhe é o invólucro (useTableRows, na captura); aqui só liga o cursor e o fundo da linha.
            onRowClick={(p) => pick.onPick(toEscolha(p))}
            loading={q.isFetching}
            error={q.error}
            onRetry={() => q.refetch()}
            empty={
              noData ? (
                <EmptyState
                  title="Nenhum imóvel cadastrado"
                  description={can(s, 'properties:edit') ? 'Cadastre o primeiro imóvel em etapas ou traga a planilha que você já usa.' : 'Quando houver imóvel ligado a você, ele aparece aqui.'}
                  action={
                    can(s, 'properties:edit') && (
                      <div className="flex flex-wrap justify-center gap-2">
                        <Link to="/imoveis/novo" className="text-sm font-medium text-primary hover:underline">
                          Cadastrar primeiro imóvel
                        </Link>
                        {can(s, 'data:import') && (
                          <Link to="/dados/importar" className="text-sm font-medium text-primary hover:underline">
                            Importar planilha
                          </Link>
                        )}
                      </div>
                    )
                  }
                />
              ) : (
                <EmptyState title="Nenhum imóvel encontrado" description="Nenhum imóvel passa na busca e nos filtros ligados. Limpe os filtros para ver todos." />
              )
            }
          />
        </div>
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </>
    ),
  }
}

/* ---------------------------------------------------------------- categoria Unidades: uma unidade por linha */

function useUnitsView(list: ListState, active: boolean, pick: TablePick): CategoryView {
  const s = useSession()
  const team = !isPortal(s)
  // Sem as vagas (homesOnly): elas têm a categoria Vagas, com as colunas que respondem "de quem é".
  const q = useRepo('imoveis:unidades', (sess) => listUnits(sess, homesOnly(list.params)), [list.params], { enabled: active })
  const toEscolha = (u: UnitRow): Escolha => ({ propertyId: u.property_id, unitId: u.id })
  const rowsProps = useTableRows(q.data?.rows, toEscolha, pick)
  const opts = useRepo('imoveis:opcoes', listPlaceOptions)
  const archived = useRepo('imoveis:unidades-arquivadas', (sess) => listUnits(sess, homesOnly({ filters: { archived: ['sim'] }, pageSize: 1 })), [], { enabled: team && active })
  const showArchived = (list.filters.archived ?? []).length > 0

  const filters: FilterDef[] = [
    { key: 'status', label: 'Situação', options: STATUS_ORDER.map((v) => ({ value: v, label: UNIT_STATUS[v] })) },
    { key: 'kind', label: 'Tipo', options: Object.entries(UNIT_KIND).filter(([value]) => value !== 'parking').map(([value, label]) => ({ value, label })) },
    { key: 'property', label: 'Imóvel', options: opts.data?.properties ?? [] },
    ...(team && hasFeature(s, 'portfolios') ? [{ key: 'portfolio', label: 'Carteira', options: opts.data?.portfolios ?? [] }] : []),
    { key: 'district', label: 'Bairro', options: opts.data?.districts ?? [] },
  ]

  // Colunas: a caixa de comparar e as da tabela de unidades (components.tsx), com a escolha lembrada.
  const compare = useCompare('unidades')
  const { visible: columns, chooser } = useColumnChooser('unidades', [
    compareColumn<UnitRow>(compare, (u) => u.id, (u) => `${u.code}, ${u.property_name}`),
    ...unitColumns({ showProperty: true, linkPeople: can(s, 'people:view') }),
  ])
  const exportList = async (format: ExportFormat) => {
    const all = await listUnits(s, homesOnly({ ...list.params, page: 1, pageSize: 100_000 }))
    await downloadTable('unidades', all.rows, exportColumnsOf(columns), format)
  }

  const archivedCount = archived.data?.total ?? 0
  return {
    toolbar: {
      filters,
      facets: q.data?.facets,
      total: q.data?.total,
      totalAll: q.data?.totalAll,
      noun: ['unidade', 'unidades'],
      onExport: exportList,
      columns: chooser,
      searchPlaceholder: 'Buscar por código, imóvel, dono ou inquilino',
      // "Mostrar arquivadas" mora no painel de Filtros (era uma caixa solta na linha da barra).
      toggles:
        team && (archivedCount > 0 || showArchived)
          ? [{ key: 'archived', label: `Mostrar arquivadas (${archivedCount})`, chip: 'Com arquivadas', on: showArchived, onChange: (on) => list.setFilter('archived', on ? ['sim', 'nao'] : []) }]
          : [],
    },
    table: (
      <>
        <RowMarker rootRef={rowsProps.ref} rows={q.data?.rows} keyOf={(u) => u.id} field="unidade" />
        <div {...rowsProps}>
          <DataTable
            caption="Unidades"
            columns={columns}
            rows={q.data?.rows}
            rowKey={(u) => u.id}
            sort={list.sort}
            onSort={list.toggleSort}
            // A linha escolhe a unidade (o código, link para quem usa teclado, também escolhe: useTableRows).
            onRowClick={(u) => pick.onPick(toEscolha(u))}
            loading={q.isFetching}
            error={q.error}
            onRetry={() => q.refetch()}
            empty={<EmptyState title="Nenhuma unidade encontrada" description={list.activeFilterCount ? 'Nenhuma unidade passa na busca e nos filtros ligados. Limpe os filtros para ver todas.' : 'As unidades aparecem aqui quando um imóvel é cadastrado.'} />}
          />
        </div>
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </>
    ),
  }
}

/* ---------------------------------------------------------------- categoria Vagas: uma vaga de garagem por linha */

/**
 * Vagas de todos os imóveis (pedido de 06/11: "de quem é aquela vaga"). A barra única tem os filtros
 * das vagas; a tabela é a VagasTable com a coluna Imóvel, lendo a MESMA consulta (useSpotList) que
 * dá à barra o total e as contagens. Os pinos (listSpotPins) seguem a mesma busca e os mesmos filtros.
 */
function useSpotsView(list: ListState, active: boolean, pick: TablePick): CategoryView {
  const s = useSession()
  const q = useSpotList(list.params, {}, active)
  // As colunas da VagasTable com a escolha lembrada ("Colunas" da barra única); a tabela recebe só as à vista.
  const { visible: columns, chooser } = useColumnChooser('vagas', spotColumns({ showProperty: true, linkPeople: can(s, 'people:view') }))
  // A VagasTable lê a MESMA consulta (mesma chave), então as linhas daqui são as linhas dela, na mesma ordem.
  const rowsProps = useTableRows(q.data?.rows, (r: SpotRow): Escolha => ({ propertyId: r.property_id, unitId: r.id }), pick)
  const opts = useRepo('imoveis:opcoes', listPlaceOptions)
  // Área ou andar: as opções saem das próprias contagens (só existem os lugares que têm vaga).
  const places = Object.keys(q.data?.facets.place ?? {}).sort((a, b) => a.localeCompare(b, 'pt-BR')).map((v) => ({ value: v, label: v }))

  const filters: FilterDef[] = [
    { key: 'status', label: 'Situação', options: STATUS_ORDER.map((v) => ({ value: v, label: UNIT_STATUS[v] })) },
    { key: 'property', label: 'Imóvel', options: opts.data?.properties ?? [] },
    { key: 'place', label: 'Área ou andar', options: places },
    { key: 'renter', label: 'Locatário', options: Object.entries(RENTER_KIND).map(([value, label]) => ({ value, label })) },
    { key: 'district', label: 'Bairro', options: opts.data?.districts ?? [] },
  ]

  return {
    toolbar: {
      filters,
      facets: q.data?.facets,
      total: q.data?.total,
      totalAll: q.data?.totalAll,
      noun: ['vaga', 'vagas'],
      onExport: (format) => exportSpots(s, list.params, format, {}, columns),
      columns: chooser,
      searchPlaceholder: 'Buscar por vaga, imóvel, locatário ou apartamento',
    },
    // O invólucro escolhe a vaga no clique (a VagasTable sozinha abriria a página dela) e acende o pino.
    table: active ? (
      <>
        <RowMarker rootRef={rowsProps.ref} rows={q.data?.rows} keyOf={(r) => r.id} field="unidade" />
        <div {...rowsProps}>
          <VagasTable list={list} showProperty columns={columns} />
        </div>
      </>
    ) : null,
  }
}
