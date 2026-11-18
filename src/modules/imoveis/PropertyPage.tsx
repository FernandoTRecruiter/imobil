/* =============================================================================
   Ficha do imóvel: a ÚNICA página com tudo do imóvel e das unidades dele (regra do app: uma ficha
   por coisa). Desde 07/11/2026 o MAPA é o foco e nada troca de página por gesto simples (pedido
   do Fernando: "quero que o mapa seja sempre o foco, tabela pequena à direita com informações
   simples, abaixo tabelas e históricos mais detalhados"). De cima para baixo:
     1. cabeçalho curto: trilha, nome, tipo, endereço, "Ver no Google Maps", Editar dados e Arquivar;
     2. o desenho 3D (uns 2/3 da largura, com o filtro único em cima) e, à direita, o painel curto:
        - nada escolhido: o resumo do imóvel (ocupação, unidades, aluguel, vencido, responsável,
          carteira, donos e a equipe do prédio, com "Gerenciar equipe" numa janela);
        - unidade ou vaga escolhida: a ficha curta dela (UnitPage.tsx: UnitFicha);
     3. os detalhes, que seguem a escolha (no máximo 4 abas, nunca aba dentro de aba):
        - nada escolhido (07/11/2026, "o imóvel é o centro": dele se vê tudo que está ligado a ele):
          Unidades (a tabela, com os filtros do desenho, e "Mostrar: Unidades | Vagas" dentro) |
          Contratos (os do imóvel, com a linha que abre: partes e documentos; "Novo contrato") |
          Manutenção | Documentos e histórico (todos os documentos do imóvel, das unidades e dos
          contratos, com "Anexar documento" escolhendo a que ele pertence; embaixo, a linha do tempo);
        - unidade escolhida: Contratos e cobranças | Chamados | Histórico e documentos (UnitDetails).
   Escolher: clique numa unidade no desenho ou numa linha de tabela (unidades ou vagas). Clicar de
   novo na mesma, Esc, "Limpar escolha" ou o nome do imóvel na trilha da ficha soltam.
   A escolha e a aba moram no endereço (?unidade=<id>&aba=<aba>), trocado sem empilhar ("replace":
   o voltar do navegador não refaz clique por clique) e sem rolar a página para o topo. A aba muda
   SÓ no clique da pessoa; escolher outra coisa volta para a primeira aba daquele assunto.
   Endereço antigo continua valendo: ?aba=pessoas, equipe, estrutura, vagas... (PROPERTY_OLD_TABS;
   ?aba=vagas abre Unidades já em "Vagas") e a página da unidade (/unidades/<id>), que vem para cá
   com a unidade escolhida.

   O proprietário convidado vê a mesma ficha, filtrada pelo escopo do repositório e sem botões.
   Arquivar o imóvel é recusado quando alguma unidade tem contrato vigente ou aguardando
   assinatura; a janela mostra a lista ANTES de a pessoa confirmar.
   ============================================================================= */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Archive, ArchiveRestore, ExternalLink, GitCompareArrows, MapPin, Pencil, Users } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, hasFeature, isPortal } from '@/auth/permissions'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { compareColumn, useCompare } from '@/components/ui/Compare'
import { cn } from '@/components/ui/cn'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Dialog } from '@/components/ui/Dialog'
import { DescriptionList, DetailHeader, Section } from '@/components/ui/Layout'
import { EmptyState, ErrorState, PageSkeleton, Skeleton } from '@/components/ui/States'
import { TabPanel, Tabs, type TabDef } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { PROPERTY_KIND, STAFF_ROLE } from '@/data/labels'
import { listEntries, listMaintenance, type MaintenanceRow } from '@/data/views/finance'
import { getPropertyStructure, getUnit, listUnits, type PropertyRow, type UnitRow } from '@/data/views/units'
import { formatDate } from '@/lib/dates'
import { formatCEP } from '@/lib/documents'
import { formatBRL } from '@/lib/money'
import { writeJSON } from '@/lib/storage'
import { plural } from '@/lib/text'
import { ASIDE_H, Property3d, revealMap } from '@/modules/mapa/MapPage'
import { UnitCompareBar } from './CompareViews'
import { formatPctNumber, leaseTermText, unitColumns } from './components'
import { EditPropertyDialog, OwnersDialog } from './dialogs'
import { listPropertyStaff } from './equipe'
import { EquipeImovel, STAFF_QUERY } from './EquipeImovel'
import { getPropertySheet, type ScheduleRow } from './ficha'
import { PropertyTimeline } from './PropertyTimeline'
import { archiveProperty, getPropertyOwners, listPropertyArchiveBlockers, placeCounts } from './repo'
import { formatPct } from './schemas'
import { maintenanceColumns, PlaceDocumentsTab, resolveTab, TabBlock } from './tabs'
import { DetailsHeading, FichaCard, UnitDetails, UnitFicha } from './UnitPage'
import { VagasTable } from './VagasTable'
import { PlaceContracts } from '@/modules/contratos/ContractsTable'
import { getUnitLeaseParties } from '@/modules/contratos/repo'
import { CategorySwitch } from '@/modules/contratos/ui'

/**
 * Abas de antes que viraram outra coisa: link velho e endereço guardado continuam abrindo o lugar
 * certo. "pessoas" (donos e equipe) foi para o painel do resumo, ao lado do desenho: abre a
 * primeira aba; "documentos" é a aba Documentos e histórico; "vagas" (aba própria até 07/11) é a
 * aba Unidades com "Vagas" ligado na troca de dentro.
 */
export const PROPERTY_OLD_TABS: Record<string, string> = { estrutura: 'unidades', pessoas: 'unidades', proprietarios: 'unidades', equipe: 'unidades', documentos: 'historico', vagas: 'unidades' }

export function PropertyPage({ id, tab, unitId }: { id: string; tab?: string; unitId?: string }) {
  return (
    <Guard action="properties:view" what="os imóveis">
      <PropertyDetail id={id} tab={tab} unitId={unitId ?? null} />
    </Guard>
  )
}

/** Esmaecido e sem clique enquanto uma troca não termina (o leitor de tela ouve "ocupado" pelo aria-busy). */
const dim = (busy: boolean) => cn('transition-opacity duration-150 motion-reduce:transition-none', busy && 'pointer-events-none opacity-60')

/**
 * A página. Trocar de imóvel ou escolher uma unidade não pisca esqueleto (07/11, "tá muito travado"):
 *   1. outro imóvel (o endereço mudou e a leitura nova ainda não chegou): a página do imóvel anterior
 *      fica na tela, esmaecida e sem clique, até a nova chegar (useRepo guarda a leitura anterior);
 *   2. unidade escolhida no 3D ou numa tabela: o desenho acende na hora (selected), mas a ficha curta
 *      e os detalhes de baixo continuam os de antes, esmaecidos, até a unidade nova estar lida; aí
 *      trocam juntos, já com os dados (sem o esqueleto de 550 a 730 ms de antes);
 *   3. o painel e os detalhes são memorizados (useMemo/useCallback): mudar o que não é deles
 *      (abrir uma janela, por exemplo) não manda o 3D desenhar de novo.
 */
function PropertyDetail({ id, tab, unitId }: { id: string; tab?: string; unitId: string | null }) {
  const s = useSession()
  const team = !isPortal(s)
  const canEdit = can(s, 'properties:edit')
  const navigate = useNavigate()
  const toast = useToast()
  const q = useRepo('imoveis:estrutura', (sess) => getPropertyStructure(sess, id), [id])
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const archive = useRepoMutation(archiveProperty, { silent: true })
  // Passo 1: a leitura na tela é a do imóvel anterior enquanto a deste não chega.
  const switching = !!q.data && q.isPlaceholderData
  const p = q.data?.property
  const shownId = p?.id ?? id
  const archived = !!p?.deleted_at

  // Passo 2: a unidade cujos ficha e detalhes estão na tela. Ela só troca para a escolhida quando a
  // leitura da escolhida chegou (a mesma chave da ficha curta: a ficha já abre com o dado). Guardar a
  // unidade anterior no estado é o jeito do React de lembrar algo de um desenho para o outro.
  // As leituras que a primeira aba da unidade mostra logo de cara (contagens das abas e locatário e
  // fiador da locação vigente) saem JUNTO com a da unidade (as três em paralelo, uma espera só), com
  // as MESMAS chaves de UnitDetails e UnitPeople: na troca, já estão no cache e nada pisca lá dentro.
  const picked = useRepo('unidade', (sess) => getUnit(sess, unitId!), [unitId], { enabled: !!unitId })
  const counts = useRepo('unidade:contagens', (sess) => placeCounts(sess, { unitId: unitId! }), [unitId], { enabled: !!unitId })
  const parties = useRepo('unidade:partes', (sess) => getUnitLeaseParties(sess, unitId!), [unitId], { enabled: !!unitId })
  const settled = (r: { data?: unknown; isPlaceholderData: boolean; error: unknown }) => (r.data !== undefined && !r.isPlaceholderData) || !!r.error
  const pickedReady = !unitId || !!picked.error || (picked.data?.id === unitId && settled(picked) && settled(counts) && settled(parties))
  const [shownUnit, setShownUnit] = useState<string | null>(unitId)
  if (pickedReady && shownUnit !== unitId) setShownUnit(unitId)
  const pendingUnit = shownUnit !== unitId
  // Trocando de imóvel, a unidade escolhida é do imóvel novo: a página de antes fica no resumo dela.
  const asideUnit = switching ? null : shownUnit

  // Escolher e trocar de aba: só o endereço muda (mesma página), sem empilhar e sem rolar ao topo.
  // Escolha feita numa tabela lá embaixo traz o desenho para a tela antes (no desenho, nada muda).
  const select = useCallback(
    (unit: string | null) => {
      if (unit) revealMap()
      void navigate({ to: '/imoveis/$propertyId', params: { propertyId: id }, search: unit ? { unidade: unit } : {}, replace: true, resetScroll: false })
    },
    [navigate, id],
  )
  const setTab = useCallback(
    (v: string) => void navigate({ to: '/imoveis/$propertyId', params: { propertyId: id }, search: { ...(unitId ? { unidade: unitId } : {}), aba: v }, replace: true, resetScroll: false }),
    [navigate, id, unitId],
  )
  const clear = useCallback(() => select(null), [select])

  // Passo 3: o painel e os detalhes só são refeitos quando o que eles mostram muda.
  const aside = useMemo(
    () => (!p ? null : asideUnit ? <UnitFicha unitId={asideUnit} onClear={clear} /> : <PropertySummary property={p} canEdit={canEdit && !archived} />),
    [p, asideUnit, clear, canEdit, archived],
  )
  const details = useCallback(
    (unitsTable: ReactNode) =>
      !p ? null : asideUnit ? (
        <UnitDetails unitId={asideUnit} tab={pendingUnit ? undefined : tab} onTab={setTab} onClear={clear} />
      ) : (
        <PropertyDetails property={p} tab={pendingUnit ? undefined : tab} onTab={setTab} unitsTable={unitsTable} onSelect={select} />
      ),
    [p, asideUnit, pendingUnit, tab, setTab, clear, select],
  )
  const asideBox = useMemo(
    () => (
      <div className={cn('h-full', dim(pendingUnit))} aria-busy={pendingUnit || undefined}>
        {aside}
      </div>
    ),
    [aside, pendingUnit],
  )
  const detailsBox = useCallback(
    (unitsTable: ReactNode) => (
      <div className={dim(pendingUnit)} aria-busy={pendingUnit || undefined}>
        {details(unitsTable)}
      </div>
    ),
    [details, pendingUnit],
  )

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  // Esqueleto só na primeira leitura (nada para mostrar ainda).
  if (!q.data || !p) return <PageSkeleton />
  // Imóvel arquivado (as unidades saem junto) ou sem unidade ativa: sem desenho, o resto continua.
  const hasUnits = !archived && (q.data.buildings.length > 0 || q.data.looseUnits.length > 0)
  const restore = () => archive.mutate({ id, restore: true }, { onSuccess: () => toast.success(`"${p.name}" restaurado com as unidades.`) })
  const a = p.address

  return (
    // gap-3: o mesmo espaço entre blocos da moldura (main do AppShell), já que a página vira um bloco só.
    <div className={cn('flex flex-col gap-3', dim(switching))} aria-busy={switching || undefined}>
      {/* Cabeçalho curto: os números foram para o painel ao lado do desenho, para o 3D caber na primeira tela. */}
      <DetailHeader
        back={
          <Link to="/imoveis" className="text-sm font-medium text-primary hover:underline">
            ‹ {team ? 'Imóveis' : 'Meus imóveis'}
          </Link>
        }
        title={p.name}
        badge={
          <>
            <Badge>{PROPERTY_KIND[p.kind]}</Badge>
            {archived && <Badge tone="danger">Arquivado</Badge>}
          </>
        }
        meta={
          <>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden="true" />
              {a.street}, {a.number}
              {a.complement ? ` (${a.complement})` : ''} · {a.district} · {a.city}/{a.state} · CEP {formatCEP(a.cep)}
            </span>
            <a href={googleMapsUrl(p)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Ver no Google Maps
              <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              <span className="sr-only">(abre em outra aba)</span>
            </a>
          </>
        }
        actions={
          canEdit &&
          (archived ? (
            <Button variant="primary" icon={<ArchiveRestore className="size-4" aria-hidden="true" />} loading={archive.isPending} onClick={restore}>
              Restaurar
            </Button>
          ) : (
            <>
              <Button icon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(true)}>
                Editar dados
              </Button>
              <Button icon={<Archive className="size-4" aria-hidden="true" />} onClick={() => setArchiving(true)}>
                Arquivar
              </Button>
            </>
          ))
        }
      />
      {archived && (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted" role="status">
          Imóvel arquivado em {formatDate(p.deleted_at!.slice(0, 10))}: ele e as unidades saíram das listas. Contratos, pagamentos e histórico continuam guardados.
        </p>
      )}

      {hasUnits ? (
        // O desenho é o do imóvel na tela (o anterior, enquanto o novo chega): a cena dele já está lida.
        <Property3d propertyId={shownId} selected={switching ? null : unitId} onSelect={select} aside={asideBox} details={detailsBox} />
      ) : (
        // Sem desenho: o aviso no lugar dele, o painel ao lado e os detalhes embaixo, como sempre.
        <div className="flex flex-col gap-4">
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <EmptyState title="Sem unidades ativas" description={archived ? 'As unidades foram arquivadas junto com o imóvel.' : 'Este imóvel ainda não tem unidade cadastrada.'} />
            <div className={ASIDE_H}>{asideBox}</div>
          </div>
          {detailsBox(null)}
        </div>
      )}

      {editing && <EditPropertyDialog property={p} onClose={() => setEditing(false)} />}
      {archiving && (
        <ArchiveDialog
          property={p}
          loading={archive.isPending}
          onClose={() => setArchiving(false)}
          onConfirm={() =>
            archive.mutate(
              { id },
              {
                onSuccess: () => {
                  setArchiving(false)
                  toast.success(`"${p.name}" arquivado com as unidades.`, { label: 'Desfazer', onClick: () => archive.mutate({ id, restore: true }) })
                },
              },
            )
          }
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- o painel curto: resumo do imóvel */

/** Quantas pessoas da equipe o painel lista; o resto fica na janela "Gerenciar equipe". */
const STAFF_SHOWN = 4

/**
 * O resumo do imóvel no painel ao lado do desenho (nada escolhido). Os números que eram a faixa
 * de indicadores do cabeçalho vieram para cá; a equipe do prédio aparece curta (foto ou iniciais,
 * nome e papel) e "Gerenciar equipe" abre a janela com a equipe completa, sem sair da tela.
 * Donos do imóvel inteiro (casa, prédio de um investidor só) também ficam aqui, com o editor das
 * fatias; no condomínio, o dono de cada unidade está na coluna Dono da tabela.
 */
function PropertySummary({ property: p, canEdit }: { property: PropertyRow; canEdit: boolean }) {
  const s = useSession()
  const team = !isPortal(s)
  const navigate = useNavigate()
  const finance = can(s, 'finance:view')
  const overdue = useRepo('imoveis:vencido', (sess) => listEntries(sess, { filters: { property: [p.id], state: ['overdue'] }, pageSize: 1 }), [p.id], { enabled: finance })
  const owners = useRepo('imoveis:donos', (sess) => getPropertyOwners(sess, p.id), [p.id])
  const staff = useRepo(STAFF_QUERY, (sess) => listPropertyStaff(sess, p.id), [p.id])
  const [managing, setManaging] = useState(false)
  const [editingOwners, setEditingOwners] = useState(false)
  const active = (staff.data ?? []).filter((r) => r.active)
  const d = owners.data
  // O editor das fatias do imóvel inteiro aparece quando há dono do imóvel inteiro, ou quando
  // não há dono nenhum (para registrar o primeiro). Condomínio com dono por unidade só mostra.
  const showWhole = !!d && (d.whole.length > 0 || d.perUnit.length === 0)
  const ownersText = !d ? '…' : d.whole.length ? d.whole.map((o) => (o.share_pct < 100 ? `${o.name} (${formatPct(o.share_pct)})` : o.name)).join(', ') : d.perUnit.length ? `Por unidade: ${plural(d.perUnit.length, 'pessoa', 'pessoas')} (coluna Dono da tabela)` : ''
  const openOverdue = () => {
    // Abre o Financeiro já filtrado neste imóvel e no "vencido" (a lista lê os filtros lembrados).
    writeJSON('imobil:list:financeiro', { filters: { property: [p.id], state: ['overdue'] }, sort: null, pageSize: 25 })
    void navigate({ to: '/financeiro' })
  }

  return (
    <FichaCard label="Resumo do imóvel">
      <p className="text-xs text-muted">Nada escolhido · clique numa unidade no desenho ou na tabela</p>
      <h2 className="-mt-1 text-lg font-medium">Resumo do imóvel</h2>
      <DescriptionList
        columns={1}
        items={[
          { label: 'Ocupação', value: <span className="num">{formatPctNumber(p.occupancy_pct)}</span>, info: 'Unidades ocupadas ÷ unidades alugáveis (bloqueada não conta; vaga tem contagem própria). Ocupada = contrato de locação vigente hoje.' },
          { label: 'Unidades', value: <span><span className="num">{p.units_total}</span> · {p.units_occupied} ocupadas · {p.units_available} disponíveis</span> },
          ...(p.spots_total > 0 ? [{ label: 'Vagas de garagem', value: <span><span className="num">{p.spots_total}</span> · {plural(p.spots_rented, 'alugada', 'alugadas')}</span> }] : []),
          { label: 'Aluguel em vigor', value: <span className="num">{formatBRL(p.rent_roll_cents)}</span>, info: 'Soma dos contratos vigentes hoje (unidades e vagas).' },
          ...(finance
            ? [
                {
                  label: 'Vencido',
                  value: !overdue.data ? (
                    '…'
                  ) : overdue.data.total ? (
                    <button type="button" className="text-left text-danger-fg hover:underline" onClick={openOverdue} title="Abrir no Financeiro">
                      <span className="num">{formatBRL(overdue.data.totals.overdue)}</span> · {plural(overdue.data.total, 'cobrança', 'cobranças')}
                    </button>
                  ) : (
                    <span className="text-muted">Nada em atraso</span>
                  ),
                },
              ]
            : []),
          ...(hasFeature(s, 'team') ? [{ label: 'Responsável', value: p.manager_name ?? <span className="text-muted">Sem responsável</span> }] : []),
          ...(hasFeature(s, 'portfolios') && team ? [{ label: 'Carteira', value: p.portfolio_name ?? <span className="text-muted">Sem carteira</span> }] : []),
          { label: d?.whole.length === 1 ? 'Dono' : 'Donos', value: ownersText },
          ...(team && p.notes ? [{ label: 'Observações', value: p.notes }] : []),
        ]}
      />
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-xs font-medium text-muted">Equipe do prédio</p>
        {staff.error ? (
          <ErrorState error={staff.error} onRetry={() => staff.refetch()} />
        ) : !staff.data ? (
          <Skeleton className="h-16" />
        ) : active.length ? (
          <ul className="flex flex-col gap-2">
            {active.slice(0, STAFF_SHOWN).map((r) => (
              <li key={r.id} className="flex items-center gap-2.5">
                <Avatar name={r.name} photo={r.photo} size="sm" color="color-mix(in srgb, var(--st-blocked) 70%, #000)" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{r.name}</span>
                  <span className="text-xs text-muted">{STAFF_ROLE[r.role]}</span>
                </span>
              </li>
            ))}
            {active.length > STAFF_SHOWN && <li className="text-xs text-muted">e mais {plural(active.length - STAFF_SHOWN, 'pessoa', 'pessoas')}</li>}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nenhuma pessoa na equipe.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" icon={<Users className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={() => setManaging(true)}>
          {canEdit ? 'Gerenciar equipe' : 'Ver equipe'}
        </Button>
        {canEdit && showWhole && (
          <Button size="sm" icon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditingOwners(true)}>
            {d!.whole.length ? 'Editar donos' : 'Registrar donos'}
          </Button>
        )}
      </div>

      {/* A equipe completa (adicionar, editar papel, desativar) numa janela: nada de sair da tela. */}
      <Dialog open={managing} onOpenChange={setManaging} title={`Equipe de ${p.name}`} size="lg">
        <EquipeImovel propertyId={p.id} propertyName={p.name} archived={!!p.deleted_at} />
      </Dialog>
      {editingOwners && d && <OwnersDialog propertyId={p.id} propertyName={p.name} current={d.whole} onClose={() => setEditingOwners(false)} />}
    </FichaCard>
  )
}

/* ---------------------------------------------------------------- os detalhes do imóvel (abas de baixo) */

/**
 * As abas do imóvel (nada escolhido): Unidades | Contratos | Manutenção | Documentos e histórico.
 * A aba muda SÓ no clique da pessoa. A tabela das unidades vem pronta do desenho (os mesmos
 * filtros); a de vagas escolhe a vaga no clique da linha, como a de unidades.
 */
function PropertyDetails({ property: p, tab, onTab, unitsTable, onSelect }: { property: PropertyRow; tab?: string; onTab: (v: string) => void; unitsTable: ReactNode; onSelect: (id: string) => void }) {
  const s = useSession()
  const team = !isPortal(s)
  const tabs: TabDef[] = [
    { value: 'unidades', label: 'Unidades', count: p.units_total },
    ...(can(s, 'contracts:view') ? [{ value: 'contratos', label: 'Contratos' }] : []),
    ...(can(s, 'maintenance:view') ? [{ value: 'manutencao', label: 'Manutenção' }] : []),
    { value: 'historico', label: 'Documentos e histórico' },
  ]
  const current = resolveTab(tab, tabs, PROPERTY_OLD_TABS)
  return (
    <section className="flex flex-col gap-2" aria-label="Detalhes do imóvel">
      <DetailsHeading title="Detalhes do imóvel" />
      <Tabs value={current} onValueChange={onTab} tabs={tabs}>
        <TabPanel value="unidades" className="pt-3">
          {/* key: o ?aba=vagas antigo liga "Vagas" ao abrir; depois a troca de dentro é só da pessoa. */}
          <UnitsOrSpots key={p.id} startWithSpots={tab === 'vagas'} spots={p.spots_total} unitsTable={unitsTable} propertyId={p.id} onSelect={onSelect} />
        </TabPanel>
        <TabPanel value="contratos" className="pt-3">
          <PlaceContracts where={{ property: p.id }} storageKey="imovel-contratos" />
        </TabPanel>
        <TabPanel value="manutencao" className="pt-3">
          <PropertyMaintenance propertyId={p.id} />
        </TabPanel>
        <TabPanel value="historico" className="pt-3">
          <div className="flex flex-col gap-8">
            <TabBlock title="Documentos" info="Os do imóvel, das unidades e dos contratos dele, e os anexos de vistoria e de chamado. Cada um pertence a uma coisa só.">
              <PlaceDocumentsTab target={{ propertyId: p.id }} storageKey="imovel-documentos" />
            </TabBlock>
            <TabBlock>
              <Section
                title="Histórico"
                info={
                  team
                    ? 'Uma linha do tempo só: cadastro e equipe do prédio, eventos dos contratos, chamados, comunicados e e-mails simulados ligados a este imóvel, com quem fez e quando.'
                    : 'O que aconteceu nos contratos e chamados das suas unidades e os comunicados enviados a você.'
                }
              >
                <PropertyTimeline propertyId={p.id} />
              </Section>
            </TabBlock>
          </div>
        </TabPanel>
      </Tabs>
    </section>
  )
}

/**
 * Aba Unidades com "Mostrar: Unidades | Vagas" dentro (até 07/11 as vagas eram uma aba à parte; a
 * aba Contratos precisou do lugar, e unidade e vaga respondem à mesma pergunta: o que o imóvel tem).
 * A troca fica só na memória da tela; sem vaga no imóvel, ela não aparece.
 *
 * "Comparar unidades" (07/11/2026): a tabela das unidades embaixo do 3D vem do módulo do mapa e não
 * tem a caixa de marcar. O botão troca, enquanto ligado, aquela tabela por esta lista com a caixa
 * "Comparar" na primeira coluna (as unidades do imóvel, sem os filtros do desenho). Clicar na linha
 * continua escolhendo a unidade, como na outra; marcar não escolhe nada. As marcas são as mesmas da
 * página Imóveis (useCompare('unidades')), então dá para comparar unidades de imóveis diferentes.
 */
function UnitsOrSpots({ startWithSpots, spots, unitsTable, propertyId, onSelect }: { startWithSpots: boolean; spots: number; unitsTable: ReactNode; propertyId: string; onSelect: (id: string) => void }) {
  const [show, setShow] = useState<'unidades' | 'vagas'>(startWithSpots && spots > 0 ? 'vagas' : 'unidades')
  const [comparing, setComparing] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {spots > 0 ? (
          <CategorySwitch
            value={show}
            options={[
              { value: 'unidades', label: 'Unidades' },
              { value: 'vagas', label: `Vagas (${spots})` },
            ]}
            onChange={setShow}
          />
        ) : (
          <span />
        )}
        {show === 'unidades' && unitsTable && (
          <Button size="sm" aria-pressed={comparing} icon={<GitCompareArrows className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={() => setComparing(!comparing)}>
            {comparing ? 'Voltar à tabela do desenho' : 'Comparar unidades'}
          </Button>
        )}
      </div>
      {show === 'vagas' ? (
        <VagasTable propertyId={propertyId} onSelect={onSelect} />
      ) : comparing ? (
        <UnitsToCompare propertyId={propertyId} onSelect={onSelect} />
      ) : (
        (unitsTable ?? <EmptyState title="Sem unidades para listar" description="As unidades ativas do imóvel aparecem aqui, com os mesmos filtros do desenho." />)
      )}
      <UnitCompareBar />
    </div>
  )
}

/**
 * A lista do "Comparar unidades" da ficha: as casas, apartamentos e salas do imóvel (vaga fora,
 * regra 042), com a caixa de marcar e as colunas que mais pesam na comparação.
 */
function UnitsToCompare({ propertyId, onSelect }: { propertyId: string; onSelect: (id: string) => void }) {
  const s = useSession()
  const compare = useCompare('unidades')
  const q = useRepo('imovel:unidades-comparar', (sess) => listUnits(sess, { filters: { property: [propertyId], spot: ['nao'] }, sort: { key: 'code', dir: 'asc' }, pageSize: 1000 }), [propertyId])
  const base = unitColumns({ showProperty: false, linkPeople: can(s, 'people:view') })
  const pickKeys = ['code', 'status', 'area', 'bedrooms', 'rent', 'lessee', 'end_date']
  const columns: Column<UnitRow>[] = [
    compareColumn<UnitRow>(compare, (u) => u.id, (u) => u.code),
    ...base.filter((c) => pickKeys.includes(c.key)).map((c) => (c.key === 'area' || c.key === 'bedrooms' ? { ...c, hideBelow: 'md' as const } : c)),
    { key: 'term', header: 'Tempo de contrato', hideBelow: 'lg', cell: (u) => <span className="text-[13px] whitespace-nowrap">{leaseTermText(u)}</span> },
  ]
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">Marque de 2 a 4 unidades e use "Comparar" no rodapé. Clicar na linha continua escolhendo a unidade.</p>
      <DataTable
        caption="Unidades do imóvel para comparar"
        columns={columns}
        rows={q.data?.rows}
        rowKey={(u) => u.id}
        onRowClick={(u) => onSelect(u.id)}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState title="Sem unidades para comparar" description="O imóvel não tem casa, apartamento ou sala ativa que você possa ver." />}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- cabeçalho: Google Maps */

/**
 * Endereço do imóvel no Google Maps (Street View, rotas, comércio em volta). É o link público do
 * próprio Google, que não pede chave nem conta: com coordenada, vai ao ponto exato; sem ela, busca
 * pelo endereço escrito. O mapa DENTRO do app com o Google exige chave paga (fase 2, item 17).
 */
function googleMapsUrl(p: Pick<PropertyRow, 'lat' | 'lng' | 'address'>): string {
  const a = p.address
  const query = p.lat !== null && p.lng !== null ? `${p.lat},${p.lng}` : `${a.street}, ${a.number}, ${a.district}, ${a.city} - ${a.state}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/* ---------------------------------------------------------------- detalhes do imóvel: aba Manutenção */

/** Quantos chamados em aberto a aba lista; o resto (raro num imóvel só) fica a um clique, na tela Manutenção. */
const OPEN_REQUESTS_MAX = 50

/**
 * Aba Manutenção: o que está quebrado e o que vem por aí, só deste imóvel. Passo a passo:
 *   1. chamados em aberto (nem concluídos nem cancelados), pela mesma lista da tela Manutenção
 *      com o filtro do imóvel: entram os das unidades e os das áreas comuns (chamado sem unidade);
 *   2. rotinas de manutenção do imóvel, pela leitura da ficha (ficha.ts), que já tem a regra de
 *      quem vê rotina (a equipe vê todas; dono e inquilino, as do imóvel deles);
 *   3. atalhos para a tela Manutenção já filtrada neste imóvel: grava o filtro onde a lista de lá
 *      guarda as escolhas (imobil:list:<lista>) antes de navegar, e ela já abre filtrada.
 * Quem vê qual chamado é o escopo do repositório: o proprietário vê os das unidades dele.
 */
function PropertyMaintenance({ propertyId }: { propertyId: string }) {
  const s = useSession()
  const team = !isPortal(s)
  const navigate = useNavigate()
  const open = useRepo('imoveis:chamados-abertos', (sess) => listMaintenance(sess, { filters: { property: [propertyId], open: ['aberto'] }, pageSize: OPEN_REQUESTS_MAX }), [propertyId])
  const sheet = useRepo('imoveis:ficha', (sess) => getPropertySheet(sess, propertyId), [propertyId])

  // No imóvel a coluna Unidade mostra só o código (ou "Áreas comuns"): o nome do imóvel já é o título da página.
  const requestColumns = maintenanceColumns({ linkRequests: true, showUnit: false })
  requestColumns.splice(2, 0, { key: 'unit', header: 'Unidade', hideBelow: 'sm', cell: (r: MaintenanceRow) => r.unit_code })
  const more = open.data ? open.data.total - open.data.rows.length : 0
  const link = 'w-fit text-sm font-medium text-primary hover:underline'

  return (
    <div className="flex flex-col gap-8">
      <TabBlock title="Chamados em aberto">
        <DataTable
          caption="Chamados em aberto do imóvel"
          columns={requestColumns}
          rows={open.data?.rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => void navigate({ to: '/manutencao/$requestId', params: { requestId: r.id } })}
          loading={open.isFetching}
          error={open.error}
          onRetry={() => open.refetch()}
          empty={<EmptyState title="Nenhum chamado em aberto" description="Os chamados das unidades e das áreas comuns deste imóvel aparecem aqui até serem concluídos." />}
        />
        <Link to="/manutencao" className={link} onClick={() => writeJSON('imobil:list:manutencao', { filters: { property: [propertyId] }, sort: null, pageSize: 25 })}>
          {more > 0 ? `Ver mais ${plural(more, 'chamado em aberto', 'chamados em aberto')} e os encerrados, no Manutenção` : 'Ver também os encerrados, no Manutenção'}
        </Link>
      </TabBlock>
      <TabBlock title="Rotinas de manutenção" info="Rotinas abrem o chamado sozinhas na data: caixa d'água, dedetização, extintores. A data atrasada quer dizer que o chamado ainda não foi aberto.">
        {sheet.error ? (
          <ErrorState error={sheet.error} onRetry={() => sheet.refetch()} />
        ) : (
          <DataTable
            caption="Rotinas de manutenção do imóvel"
            columns={routineColumns(team)}
            rows={sheet.data?.property.id === propertyId ? sheet.data.schedules : undefined}
            rowKey={(r) => r.id}
            loading={!sheet.data}
            empty={<EmptyState title="Nenhuma rotina cadastrada" description={team ? "Cadastre rotinas (caixa d'água, dedetização) na tela de rotinas da Manutenção." : 'A administração ainda não cadastrou rotina para este imóvel.'} />}
          />
        )}
        {team && (
          <Link to="/manutencao" search={{ aba: 'rotinas' }} className={link} onClick={() => writeJSON('imobil:list:rotinas', { filters: { imovel: [propertyId] }, sort: null, pageSize: 25 })}>
            Abrir as rotinas deste imóvel no Manutenção
          </Link>
        )}
      </TabBlock>
    </div>
  )
}

/** Colunas das rotinas. O prestador só para a equipe (o portal não abre ficha de prestador; o repositório já manda vazio). */
function routineColumns(team: boolean): Column<ScheduleRow>[] {
  const cols: Column<ScheduleRow>[] = [
    {
      key: 'title', header: 'Rotina',
      cell: (r) => (
        <span className="flex flex-col">
          <span>{r.title}</span>
          <span className="text-xs text-muted">{r.unit_code ? `Unidade ${r.unit_code}` : 'Áreas comuns'}</span>
        </span>
      ),
    },
    { key: 'every', header: 'A cada', hideBelow: 'sm', cell: (r) => plural(r.every_months, 'mês', 'meses') },
    {
      // "Atrasada" já vem calculada do repositório, com o hoje da sessão.
      key: 'next', header: 'Próxima data',
      cell: (r) => (r.late ? <span className="font-medium text-warning-fg">atrasada desde {formatDate(r.next_date)}</span> : formatDate(r.next_date)),
    },
  ]
  if (team) cols.push({ key: 'vendor', header: 'Prestador', hideBelow: 'md', cell: (r) => r.vendor_name ?? <span className="text-muted">A definir</span> })
  return cols
}

/* ---------------------------------------------------------------- arquivar */

/** Mostra o que impede antes de pedir confirmação (melhor que deixar clicar e só então recusar). */
function ArchiveDialog({ property, loading, onClose, onConfirm }: { property: PropertyRow; loading: boolean; onClose: () => void; onConfirm: () => void }) {
  const s = useSession()
  const q = useRepo('imoveis:bloqueios', (sess) => listPropertyArchiveBlockers(sess, property.id), [property.id])
  const blocked = (q.data?.length ?? 0) > 0
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={blocked ? 'Não dá para arquivar ainda' : `Arquivar "${property.name}"?`}
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
        <Skeleton className="h-24" />
      ) : blocked ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            {plural(q.data.length, 'unidade tem', 'unidades têm')} contrato vigente ou aguardando assinatura. Encerre ou rescinda esses contratos antes de arquivar o imóvel.
          </p>
          <ul className="max-h-64 overflow-y-auto rounded-xl border border-border">
            {q.data.map((b) => (
              <li key={b.contract_id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0">
                <span className="font-medium">{b.unit_code}</span>
                <span className="text-muted">
                  {can(s, 'contracts:view') ? (
                    <Link to="/contratos/$contractId" params={{ contractId: b.contract_id }} className="text-primary hover:underline">
                      {b.contract_code}
                    </Link>
                  ) : (
                    b.contract_code
                  )}{' '}
                  · {b.status_label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm">
          O imóvel e {property.units_total === 1 ? 'a unidade dele' : `as ${property.units_total} unidades dele`} saem das listas. Contratos encerrados, pagamentos e histórico continuam guardados, e dá para desfazer.
        </p>
      )}
    </Dialog>
  )
}
