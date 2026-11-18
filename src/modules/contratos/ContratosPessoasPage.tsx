/* =============================================================================
   "Contratos e pessoas" (07/11/2026): UMA tela no lugar de Pessoas e Contratos.

   Pedido do Fernando: "pessoas e contratos podia ser quase a mesma coisa? ... uma tabela única que
   tem contratos que tu expande e mostra as pessoas envolvidas? aí tem filtros e busca". Juntou, mas
   com a troca "Mostrar: Contratos | Pessoas": uma tabela só de contratos faria sumir quem não tem
   contrato (dono de unidade vaga, prestador, ex-fiador, interessado). Lida de cima para baixo:
     1. indicadores dos contratos (clicar liga o filtro que mostra exatamente o que ele conta);
     2. "Mostrar: Contratos | Pessoas" (só aparece para quem vê as duas);
     3. UMA barra de busca e filtros, da categoria aberta;
     4. a linha principal: a TABELA (cada linha abre no lugar: partes, imóvel, documentos; ou, na
        pessoa, contratos, unidades, vagas, documentos) e, à direita, a ficha CURTA do escolhido com
        os botões explícitos. Abaixo de 1280 px a ficha desce para depois da tabela;
     5. os detalhes do escolhido (no máximo 3 abas), que trocam só no clique da aba.

   Navegação (CONVENCOES, "Lógica de navegação"): clicar numa linha só ESCOLHE (abre a linha, enche
   a ficha e os detalhes); clicar de novo nela, "Limpar escolha" ou "limpar" soltam. Trocar de página
   é só por botão com o nome do destino ("Abrir imóvel", "Novo contrato"). A categoria, a escolha e
   a aba moram no endereço (endereco.ts), gravados com replace (o Voltar não refaz clique por clique)
   e sem rolar a página.

   Portal: o proprietário e o inquilino veem a mesma tela como "Meus contratos", só com os contratos
   deles (o escopo do repositório corta o resto; a tela não filtra nada à mão). Sem nada escolhido,
   embaixo fica a lista inteira dos documentos deles: a tela Documentos saiu do menu.

   Barra (07/11/2026): a mesma de toda lista. "Mostrar: Contratos | Pessoas" foi para o começo da
   linha da barra (como em Imóveis), "Mostrar arquivadas" para dentro de Filtros, e cada categoria
   tem o botão "Colunas" (imobil:colunas:contratos e :pessoas) e o "Exportar" com as colunas à vista.
   ============================================================================= */
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus, UserPlus } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import { Button } from '@/components/ui/Button'
import { exportColumnsOf, useColumnChooser } from '@/components/ui/columns'
import { PageHeader, Section } from '@/components/ui/Layout'
import { ListToolbar, type FilterDef } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, NoAccess } from '@/components/ui/States'
import { useRepo } from '@/data/hooks'
import { ADJUSTMENT_INDEX, CONTRACT_KIND, CONTRACT_STATUS, GUARANTEE } from '@/data/labels'
import type { AdjustmentIndex, ContractKind, ContractStatus, GuaranteeType } from '@/data/types'
import { listPeople } from '@/data/views/contracts'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatBRLShort } from '@/lib/money'
import { plural } from '@/lib/text'
import { useListState, type ListState } from '@/lib/useListState'
import { MyDocuments } from '@/modules/documentos/parts'
import { listPropertyOptions } from '@/modules/financeiro/repo'
import { FilterKpi, LinkButton } from '@/modules/financeiro/ui'
import { PersonDialog } from '@/modules/pessoas/PersonDialog'
import { PersonExpansion, personColumns } from '@/modules/pessoas/PeopleTable'
import { listPeopleForScreen } from '@/modules/pessoas/repo'
import { ROLE_LABEL, ROLE_ORDER } from '@/modules/pessoas/roles'
import { PersonDetails, PersonFicha, usePersonView } from '@/modules/pessoas/PersonSelected'
import { ContractDetails, ContractFicha, useContractActions, useContractView } from './ContractSelected'
import { contractColumns, ContractExpansion } from './ContractsTable'
import { LISTAS, type ContratosSearch, type Lista } from './endereco'
import { ExpandTable } from './ExpandTable'
import { contractKpis, listContractsForScreen } from './repo'
import { FichaFrame } from './ui'

const STATUSES = Object.keys(CONTRACT_STATUS) as ContractStatus[]
const LISTA_LABEL: Record<Lista, string> = { contratos: 'Contratos', pessoas: 'Pessoas' }

/** A ficha curta: ao lado da tabela a partir de 1280 px, grudada no alto enquanto a tabela rola (abaixo das duas barras do topo, 36 + 56 px). */
const FICHA_COL = 'min-w-0 scroll-mt-28 xl:sticky xl:top-26 xl:max-h-[calc(100dvh-7.5rem)] xl:overflow-y-auto'
/** Tabela e ficha: a ficha fica estreita entre 1280 e 1536 px, para a tabela caber sem rolar para o lado. */
const STAGE = 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_340px]'

export function ContratosPessoasPage({ search }: { search: ContratosSearch }) {
  const s = useSession()
  // Porta da tela: quem vê contratos OU pessoas entra (o colaborador da manutenção vê pessoas sem ver
  // contratos). Cada categoria confere a própria permissão; o repositório confere de novo.
  const kinds = LISTAS.filter((k) => (k === 'contratos' ? can(s, 'contracts:view') : can(s, 'people:view') && !isPortal(s)))
  if (!kinds.length) return <NoAccess what="os contratos e as pessoas" />
  return <Screen search={search} kinds={kinds} />
}

function Screen({ search: url, kinds }: { search: ContratosSearch; kinds: Lista[] }) {
  const s = useSession()
  const navigate = useNavigate()
  const portal = isPortal(s)
  const lessee = portal && s.roles.includes('lessee') && !s.roles.includes('owner')
  const kind: Lista = url.lista && kinds.includes(url.lista) ? url.lista : kinds[0]
  const contractList = useListState('contratos')
  const peopleList = useListState('pessoas')
  const [creating, setCreating] = useState(false)
  const fichaRef = useRef<HTMLDivElement>(null)

  /* Endereço: só a busca do endereço muda (mesma página), sem empilhar e sem rolar ao topo. A troca
     parte do endereço de agora (url) e muda só o que foi pedido; chave com undefined sai do endereço. */
  const go = (patch: Partial<ContratosSearch>) => void navigate({ to: '/contratos', search: { ...url, ...patch }, replace: true, resetScroll: false })
  // "lista=contratos" é o padrão e não vai para o endereço; a escolha de cada categoria fica guardada nele.
  const switchKind = (k: Lista) => go({ lista: k === 'contratos' ? undefined : k, aba: undefined })
  // Escolher outra coisa (ou soltar) volta à primeira aba dos detalhes: tira o ?aba=.
  const chooseContract = (id: string | null) => go({ contrato: id ?? undefined, aba: undefined })
  const choosePerson = (id: string | null) => go({ pessoa: id ?? undefined, aba: undefined })
  const setTab = (aba: string) => go({ aba })
  /** "Ver ficha e ações" (abaixo de 1280 px a ficha fica depois da tabela). */
  const showFicha = () => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    fichaRef.current?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  }

  // Indicadores dos contratos: clicar liga o filtro (e traz a categoria Contratos, se estava em Pessoas).
  const showContracts = can(s, 'contracts:view')
  const kq = useRepo('contratos:indicadores', contractKpis, [], { enabled: showContracts && !lessee })
  const k = kq.data
  const only = (key: string, v: string) => (contractList.filters[key] ?? []).length === 1 && contractList.filters[key][0] === v
  const toggle = (key: string, v: string) => {
    contractList.setFilter(key, only(key, v) ? [] : [v])
    if (kind !== 'contratos') switchKind('contratos')
  }

  const title = portal ? 'Meus contratos' : kinds.length === 2 ? 'Contratos e pessoas' : LISTA_LABEL[kinds[0]]
  // "Mostrar: Contratos | Pessoas" no começo da linha da barra (só para quem vê as duas).
  const categorySwitch = kinds.length > 1 ? <Segmented value={kind} options={kinds.map((v) => ({ value: v, label: LISTA_LABEL[v] }))} onChange={switchKind} /> : undefined
  return (
    <>
      <PageHeader
        eyebrow={portal ? (lessee ? 'Portal do inquilino' : 'Portal do proprietário') : 'Contratos e pessoas'}
        title={title}
        description={
          portal
            ? 'Os contratos de que você é parte. Abra uma linha para ver as partes e os documentos dele.'
            : 'Cada contrato abre com as partes e os documentos. Quem não tem contrato fica em Pessoas.'
        }
        actions={
          !portal && (
            <>
              {can(s, 'people:edit') && (
                <Button icon={<UserPlus className="size-4" aria-hidden="true" />} onClick={() => setCreating(true)}>
                  Nova pessoa
                </Button>
              )}
              {can(s, 'contracts:edit') && (
                <LinkButton to="/contratos/novo" variant="primary" icon={<Plus className="size-4" aria-hidden="true" />}>
                  Nova locação
                </LinkButton>
              )}
            </>
          )
        }
      />

      {showContracts && !lessee && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicadores dos contratos">
          <FilterKpi
            label="Vigentes" value={k ? k.active.toLocaleString('pt-BR') : '…'} hint="locações em vigor hoje"
            info="Locações com situação Vigente. A unidade conta como ocupada enquanto hoje está entre o início e o fim."
            active={kind === 'contratos' && only('status', 'active')} onToggle={() => toggle('status', 'active')}
          />
          <FilterKpi
            label="Vencem em 60 dias" value={k ? k.ending60.toLocaleString('pt-BR') : '…'} hint="hora de falar em renovação"
            info="Vigentes cujo fim cai entre hoje e daqui a 60 dias. É o mesmo filtro 'Vence em: até 60 dias'."
            active={kind === 'contratos' && only('ending', '60')} onToggle={() => toggle('ending', '60')}
          />
          <FilterKpi
            label="Aguardando assinatura" value={k ? k.awaitingSignature.toLocaleString('pt-BR') : '…'} hint="aprovados, falta assinar"
            info="Aprovados e ainda sem assinatura registrada. Já seguram a unidade no período (outra locação não pode cruzar)."
            active={kind === 'contratos' && only('status', 'awaiting_signature')} onToggle={() => toggle('status', 'awaiting_signature')}
          />
          <FilterKpi
            label="Em atraso" value={k ? formatBRLShort(k.overdueCents) : '…'} tone={k && k.overdueCents > 0 ? 'danger' : undefined}
            hint={k ? plural(k.overdueContracts, 'contrato', 'contratos') : undefined}
            info="Soma do saldo em aberto das cobranças a receber já vencidas (vencimento antes de hoje), de todas as locações. Clicar ordena a lista pelo maior atraso."
            active={kind === 'contratos' && contractList.sort?.key === 'overdue' && contractList.sort.dir === 'desc'}
            // toggleSort com o "primeiro sentido" trocado devolve a ordem declarada (ver useListState).
            onToggle={() => {
              if (contractList.sort?.key === 'overdue' && contractList.sort.dir === 'desc') contractList.toggleSort('overdue', 'asc')
              else contractList.toggleSort('overdue', 'desc')
              if (kind !== 'contratos') switchKind('contratos')
            }}
          />
        </section>
      )}

      {kind === 'contratos' ? (
        <ContractsArea list={contractList} selectedId={url.contrato ?? null} tab={url.aba} lessee={lessee} portal={portal} onChoose={chooseContract} onTab={setTab} fichaRef={fichaRef} onShowFicha={showFicha} leading={categorySwitch} />
      ) : (
        <PeopleArea list={peopleList} selectedId={url.pessoa ?? null} tab={url.aba} onChoose={choosePerson} onTab={setTab} fichaRef={fichaRef} onShowFicha={showFicha} onCreate={() => setCreating(true)} leading={categorySwitch} />
      )}

      {creating && (
        <PersonDialog
          onClose={() => setCreating(false)}
          // A pessoa nova aparece escolhida na categoria Pessoas (a mesma tela, sem página nova).
          onSaved={(p) => go({ lista: 'pessoas', pessoa: p.id, aba: undefined })}
        />
      )}
    </>
  )
}

/* ---------------------------------------------------------------- categoria Contratos */

interface AreaProps {
  list: ListState
  selectedId: string | null
  tab?: string
  onChoose: (id: string | null) => void
  onTab: (t: string) => void
  fichaRef: RefObject<HTMLDivElement | null>
  onShowFicha: () => void
  /** A troca "Mostrar: Contratos | Pessoas", no começo da linha da barra. */
  leading?: ReactNode
}

function ContractsArea({ list, selectedId, tab, lessee, portal, onChoose, onTab, fichaRef, onShowFicha, leading }: AreaProps & { lessee: boolean; portal: boolean }) {
  const s = useSession()
  const agency = s.org.kind === 'agency'
  const q = useRepo('contratos', (sess) => listContractsForScreen(sess, list.params), [list.params])
  const props = useRepo('contratos:imoveis', listPropertyOptions, [], { enabled: !lessee })
  const { q: sel, view } = useContractView(selectedId)
  const actions = useContractActions()
  // O escolhido que não está na página (link antigo, filtro lembrado): entra em cima da tabela, aberto.
  const pinned = view && q.data && !q.data.rows.some((r) => r.id === view.contract.id) ? view.contract : undefined

  // Colunas com a escolha lembrada (as opcionais no menu "Colunas") e o Exportar com as colunas à vista.
  const { visible: columns, chooser } = useColumnChooser('contratos', contractColumns())
  const exportList = async (format: ExportFormat) => {
    const all = await listContractsForScreen(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable('contratos', all.rows, exportColumnsOf(columns), format)
  }

  // Filtro por unidade chega de outras telas (Visão geral: "reajuste no mês"); ganha chip com o código.
  const unitFilter = list.filters.unit ?? []
  const filters: FilterDef[] = [
    { key: 'status', label: 'Situação', options: STATUSES.map((v) => ({ value: v, label: CONTRACT_STATUS[v] })) },
    ...(agency && !lessee ? [{ key: 'kind', label: 'Tipo', options: (['lease', 'management'] as ContractKind[]).map((v) => ({ value: v, label: CONTRACT_KIND[v] })) }] : []),
    { key: 'ending', label: 'Vence em', options: ['30', '60', '90'].map((d) => ({ value: d, label: `Até ${d} dias` })) },
    { key: 'index', label: 'Índice', options: (Object.keys(ADJUSTMENT_INDEX) as AdjustmentIndex[]).map((v) => ({ value: v, label: ADJUSTMENT_INDEX[v] })) },
    { key: 'guarantee', label: 'Garantia', options: (Object.keys(GUARANTEE) as GuaranteeType[]).map((v) => ({ value: v, label: GUARANTEE[v] })) },
    ...(lessee ? [] : [{ key: 'property', label: 'Imóvel', options: props.data ?? [] }]),
    ...(unitFilter.length
      ? [{ key: 'unit', label: 'Unidade', options: unitFilter.map((id) => ({ value: id, label: q.data?.rows.find((r) => r.unit_id === id)?.unit_code ?? 'escolhida' })) }]
      : []),
  ]

  return (
    <>
      <ListToolbar
        state={list}
        leading={leading}
        noun={['contrato', 'contratos']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        columns={chooser}
        searchPlaceholder="Buscar por código, unidade, imóvel ou pessoa"
        filters={filters}
      />
      <div className={STAGE}>
        <div className="flex min-w-0 flex-col gap-3">
          <ExpandTable
            caption="Contratos"
            columns={columns}
            rows={q.data?.rows}
            rowKey={(r) => r.id}
            rowLabel={(r) => `contrato ${r.code}`}
            openKey={selectedId}
            onToggle={(r) => onChoose(r.id === selectedId ? null : r.id)}
            renderExpansion={(r, isPinned) => <ContractExpansion contractId={r.id} pinned={isPinned} onShowFicha={onShowFicha} />}
            pinned={pinned}
            sort={list.sort}
            onSort={list.toggleSort}
            loading={q.isFetching}
            error={q.error}
            onRetry={() => q.refetch()}
            empty={
              <EmptyState
                title="Nenhum contrato encontrado"
                description={list.activeFilterCount ? 'Nenhum contrato passa nos filtros ligados. Limpe os filtros para ver todos.' : portal ? 'Quando houver contrato ligado a você, ele aparece aqui.' : 'As locações aparecem aqui assim que são criadas, ainda em rascunho.'}
                action={
                  list.activeFilterCount ? (
                    <Button onClick={list.clearFilters}>Limpar filtros</Button>
                  ) : can(s, 'contracts:edit') && !portal ? (
                    <LinkButton to="/contratos/novo" variant="primary">
                      Nova locação
                    </LinkButton>
                  ) : undefined
                }
              />
            }
          />
          {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
        </div>
        <div ref={fichaRef} className={FICHA_COL}>
          {selectedId ? (
            <ContractFicha view={view} error={sel.error} onRetry={() => sel.refetch()} onClear={() => onChoose(null)} onAction={actions.open} />
          ) : (
            <NothingChosen noun={['contrato', 'contratos']} total={q.data?.total} filtered={list.activeFilterCount > 0} hint="Clique numa linha para ver as partes, o imóvel e os documentos do contrato. Aqui aparecem a situação, os prazos e as ações." />
          )}
        </div>
      </div>
      {selectedId && view && <ContractDetails view={view} tab={tab} onTab={onTab} onClear={() => onChoose(null)} onAction={actions.open} />}
      {!selectedId && portal && (
        <Section title="Meus documentos" info="Tudo o que a administração liberou para você: contratos, laudos de vistoria, extratos e anexos.">
          <MyDocuments />
        </Section>
      )}
      {actions.dialogs(view)}
    </>
  )
}

/* ---------------------------------------------------------------- categoria Pessoas */

function PeopleArea({ list, selectedId, tab, onChoose, onTab, fichaRef, onShowFicha, onCreate, leading }: AreaProps & { onCreate: () => void }) {
  const s = useSession()
  const q = useRepo('pessoas:lista', (sess) => listPeopleForScreen(sess, list.params), [list.params])
  // Quantas arquivadas existem (para o "Mostrar arquivadas (N)" dizer a verdade antes do clique).
  const archived = useRepo('pessoas:arquivadas', (sess) => listPeople(sess, { filters: { archived: ['sim'] }, pageSize: 1 }))
  const showArchived = (list.filters.archived ?? []).length > 0
  const archivedCount = archived.data?.total ?? 0
  const { q: sel, person } = usePersonView(selectedId)
  // A coluna "Contratos vigentes" do escolhido fora da página fica vazia (0): os contratos dele estão na linha aberta.
  const pinned = person && q.data && !q.data.rows.some((r) => r.id === person.id) ? { ...person, active_contracts: 0 } : undefined

  // Colunas com a escolha lembrada; as de moradia e relacionamento começam desligadas (menu "Colunas").
  const { visible: columns, chooser } = useColumnChooser('pessoas', personColumns())
  const exportList = async (format: ExportFormat) => {
    const all = await listPeopleForScreen(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable('pessoas', all.rows, exportColumnsOf(columns), format)
  }

  return (
    <>
      <ListToolbar
        state={list}
        leading={leading}
        noun={['pessoa', 'pessoas']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        columns={chooser}
        searchPlaceholder="Buscar por nome, documento, e-mail ou telefone"
        filters={[
          { key: 'role', label: 'Papel', options: ROLE_ORDER.map((r) => ({ value: r, label: ROLE_LABEL[r] })) },
          { key: 'kind', label: 'Tipo', options: [{ value: 'PF', label: 'Pessoa física' }, { value: 'PJ', label: 'Pessoa jurídica' }] },
        ]}
        // "Mostrar arquivadas" mora no painel de Filtros (era uma caixa solta na linha da barra).
        toggles={archivedCount > 0 || showArchived ? [{ key: 'archived', label: `Mostrar arquivadas (${archivedCount})`, chip: 'Com arquivadas', on: showArchived, onChange: (on) => list.setFilter('archived', on ? ['sim', 'nao'] : []) }] : []}
      />
      <div className={STAGE}>
        <div className="flex min-w-0 flex-col gap-3">
          <ExpandTable
            caption="Pessoas"
            columns={columns}
            rows={q.data?.rows}
            rowKey={(p) => p.id}
            rowLabel={(p) => p.name}
            openKey={selectedId}
            onToggle={(p) => onChoose(p.id === selectedId ? null : p.id)}
            renderExpansion={(p, isPinned) => <PersonExpansion personId={p.id} personName={p.name} pinned={isPinned} onShowFicha={onShowFicha} />}
            pinned={pinned}
            sort={list.sort}
            onSort={list.toggleSort}
            loading={q.isFetching}
            error={q.error}
            onRetry={() => q.refetch()}
            empty={
              q.data?.totalAll === 0 ? (
                <EmptyState
                  title="Nenhuma pessoa cadastrada"
                  description="Cadastre proprietários, inquilinos e prestadores, ou traga a planilha que você já usa."
                  action={
                    can(s, 'people:edit') && (
                      <Button variant="primary" onClick={onCreate}>
                        Cadastrar primeira pessoa
                      </Button>
                    )
                  }
                />
              ) : (
                <EmptyState title="Ninguém encontrado" description="Nenhuma pessoa passa na busca e nos filtros ligados. Limpe os filtros para ver todas." action={<Button onClick={list.clearFilters}>Limpar filtros</Button>} />
              )
            }
          />
          {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
        </div>
        <div ref={fichaRef} className={FICHA_COL}>
          {selectedId ? (
            <PersonFicha person={person} error={sel.error} onRetry={() => sel.refetch()} onClear={() => onChoose(null)} />
          ) : (
            <NothingChosen noun={['pessoa', 'pessoas']} total={q.data?.total} filtered={list.activeFilterCount > 0} hint="Clique numa linha para ver os contratos, as unidades, as vagas e os documentos da pessoa. Aqui aparecem os dados e as ações." />
          )}
        </div>
      </div>
      {selectedId && person && <PersonDetails person={person} tab={tab} onTab={onTab} onClear={() => onChoose(null)} />}
    </>
  )
}

/* ---------------------------------------------------------------- ficha sem escolha */

/** A ficha quando nada está escolhido: quantos há na lista agora e o que fazer. */
function NothingChosen({ noun, total, filtered, hint }: { noun: [string, string]; total: number | undefined; filtered: boolean; hint: string }) {
  return (
    <FichaFrame label={`Resumo da lista de ${noun[1]}`} eyebrow={filtered ? 'Com a busca e os filtros ligados' : 'Nada escolhido'} title={total === undefined ? '…' : plural(total, noun[0], noun[1])} items={[]}>
      <p className="text-sm text-muted">{hint}</p>
    </FichaFrame>
  )
}
