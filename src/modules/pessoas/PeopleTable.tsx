/* =============================================================================
   Categoria Pessoas de "Contratos e pessoas" (07/11/2026): as colunas da tabela e a linha aberta.

   Por que Pessoas continua existindo ao lado dos Contratos: uma tabela só de contratos faria sumir
   quem não tem contrato (dono de unidade vaga, prestador, ex-fiador, interessado).

   Os PAPÉIS da tabela não são marcados à mão (com exceção de prestador, contato, zelador e
   síndico): proprietário sai de property_owners e inquilino e fiador saem dos contratos. Assim o
   papel nunca fica velho (quem deixou de alugar deixa de aparecer como inquilino).

   O documento aparece com o miolo escondido (***.456.789-**): lista é tela que muita gente vê por
   cima do ombro. O número inteiro fica na ficha curta da pessoa escolhida.

   Colunas opcionais (07/11/2026, menu "Colunas"): dependentes, animais, veículos, ocupação,
   cliente desde, tempo como cliente e pontualidade (views/cliente.ts). Começam desligadas: a lista
   continua enxuta, e o dado pessoal só aparece para quem pede (a lista é só da equipe).

   A linha aberta (PersonExpansion) responde "o que liga esta pessoa aos imóveis": contratos com o
   papel dela, unidades de que é dona, vagas que aluga e os documentos dela (extrato de repasse...).
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { PanelRight } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can } from '@/auth/permissions'
import { Badge, UnitStatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { useRepo } from '@/data/hooks'
import { CONTRACT_STATUS, CONTRACT_STATUS_TONE, PARTY_ROLE } from '@/data/labels'
import type { PartyRole } from '@/data/types'
import { formatMonths } from '@/components/ui/compare-model'
import { csvMoney } from '@/lib/csv'
import { formatDate } from '@/lib/dates'
import { formatPhone, maskDocument } from '@/lib/documents'
import { formatBRL } from '@/lib/money'
import { plural } from '@/lib/text'
import type { ExpandColumn } from '@/modules/contratos/ExpandTable'
import { DocumentList } from '@/modules/documentos/parts'
import { formatPct } from '@/modules/financeiro/ui'
import { getPersonLinks, type PersonListRow } from './repo'
import { ROLE_LABEL, ROLE_ORDER, RoleBadges } from './roles'

/** Número que pode faltar: vazio (não informado) é diferente de zero. */
const count = (n: number | null | undefined) => (n === null || n === undefined ? '' : n)

/* ---------------------------------------------------------------- colunas */

export function personColumns(): ExpandColumn<PersonListRow>[] {
  return [
    {
      key: 'name', header: 'Nome', sortable: true, firstDir: 'asc', locked: true,
      export: [
        { label: 'Nome', value: (p) => p.name },
        { label: 'Tipo', value: (p) => (p.kind === 'PF' ? 'Pessoa física' : 'Pessoa jurídica') },
        // Documento sai mascarado também no arquivo: planilha circula mais que a tela.
        { label: 'Documento', value: (p) => maskDocument(p.document) },
        { label: 'Arquivada', value: (p) => (p.deleted_at ? 'sim' : '') },
      ],
      cell: (p) => (
        <span className="flex max-w-[12rem] min-w-0 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{p.name}</span>
            {p.deleted_at && <Badge>Arquivada</Badge>}
          </span>
          <span className="num text-xs text-muted">{p.document ? maskDocument(p.document) : 'Sem documento'}</span>
        </span>
      ),
    },
    {
      key: 'roles', header: 'Papéis', className: 'max-w-[10rem]',
      export: [{ label: 'Papéis', value: (p) => ROLE_ORDER.filter((r) => p.roles.includes(r)).map((r) => ROLE_LABEL[r]).join(', ') }],
      cell: (p) => <RoleBadges roles={p.roles} />,
    },
    {
      // Entre 1280 e 1536 px a tabela divide a largura com a ficha curta, que já mostra o contato.
      key: 'contact', header: 'Contato', visibleClass: 'hidden lg:table-cell xl:hidden 2xl:table-cell',
      export: [{ label: 'Telefone', value: (p) => formatPhone(p.phone) }, { label: 'E-mail', value: (p) => p.email }],
      cell: (p) => (
        <span className="flex max-w-[11rem] min-w-0 flex-col text-xs">
          {p.phone && <span className="num">{formatPhone(p.phone)}</span>}
          {p.email && <span className="truncate text-muted">{p.email}</span>}
          {!p.phone && !p.email && <span className="text-muted">Sem contato</span>}
        </span>
      ),
    },
    { key: 'units_owned', header: 'Unidades', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md', export: [{ label: 'Unidades', value: (p) => p.units_owned }], cell: (p) => (p.units_owned ? p.units_owned : '') },
    {
      key: 'active_contracts', header: 'Contratos vigentes', headerWrap: true, className: 'w-24', align: 'right', hideBelow: 'sm',
      export: [{ label: 'Contratos vigentes', value: (p) => p.active_contracts }],
      cell: (p) => <span title="Contratos vigentes em que a pessoa é locadora, locatária ou fiadora">{p.active_contracts || ''}</span>,
    },
    {
      key: 'client_since', header: 'Cliente desde', optional: true, sortable: true, firstDir: 'asc', align: 'right', hideBelow: 'md',
      export: [{ label: 'Cliente desde', value: (p) => formatDate(p.client_since) }],
      cell: (p) => <span title="Início do primeiro contrato com a conta, em qualquer papel">{formatDate(p.client_since)}</span>,
    },
    {
      key: 'client_months', header: 'Tempo como cliente', headerWrap: true, optional: true, hideBelow: 'md',
      export: [{ label: 'Tempo como cliente (meses)', value: (p) => count(p.client_months) }],
      cell: (p) => <span className="text-[13px] whitespace-nowrap">{formatMonths(p.client_months)}</span>,
    },
    {
      key: 'punctuality', header: 'Pontualidade', optional: true, sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md',
      export: [{ label: 'Pontualidade (%)', value: (p) => (p.punctuality_pct === null ? '' : p.punctuality_pct.toLocaleString('pt-BR')) }],
      cell: (p) =>
        p.punctuality_pct === null ? '' : (
          <span title="Cobranças dos últimos 12 meses pagas até o vencimento" className={cn(p.punctuality_pct < 80 && 'text-danger-fg')}>
            {p.punctuality_pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
          </span>
        ),
    },
    { key: 'dependents', header: 'Dependentes', optional: true, sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md', export: [{ label: 'Dependentes', value: (p) => count(p.dependents) }], cell: (p) => count(p.dependents) },
    { key: 'pets', header: 'Animais', menuLabel: 'Animais de estimação', optional: true, hideBelow: 'md', export: [{ label: 'Animais de estimação', value: (p) => p.pets }], cell: (p) => <span className="text-[13px] whitespace-nowrap">{p.pets}</span> },
    { key: 'vehicles', header: 'Veículos', optional: true, sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md', export: [{ label: 'Veículos', value: (p) => count(p.vehicles) }], cell: (p) => count(p.vehicles) },
    { key: 'occupation', header: 'Ocupação', optional: true, hideBelow: 'lg', export: [{ label: 'Ocupação', value: (p) => p.occupation }], cell: (p) => <span className="text-[13px] whitespace-nowrap">{p.occupation}</span> },
    {
      key: 'overdue', header: 'Em atraso', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md',
      export: [{ label: 'Em atraso (R$)', value: (p) => csvMoney(p.overdue_cents) }],
      cell: (p) => (p.overdue_cents > 0 ? <span className="font-medium text-danger-fg">{formatBRL(p.overdue_cents)}</span> : ''),
    },
  ]
}

/* ---------------------------------------------------------------- a linha aberta */

function Block({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <h3 className="text-[13px] font-medium text-muted">{title}</h3>
      {children}
    </div>
  )
}

/** Quantas linhas cada lista mostra antes do "Mostrar todos" (dona de prédio inteiro tem dezenas de unidades). */
const SHOWN = 8

/** Lista curta com "Mostrar todos (N)": a linha aberta não vira uma página inteira para quem tem muita coisa. */
function ShortList<T>({ items, render, empty }: { items: T[]; render: (t: T) => ReactNode; empty: string }) {
  const [all, setAll] = useState(false)
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>
  const shown = all ? items : items.slice(0, SHOWN)
  return (
    <>
      <ul className="flex flex-col divide-y divide-border">{shown.map(render)}</ul>
      {items.length > SHOWN && (
        <button type="button" className="w-fit text-sm font-medium text-primary hover:underline" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'Mostrar menos' : `Mostrar todos (${items.length})`}
        </button>
      )}
    </>
  )
}

const ROLE_TONE: Record<PartyRole, 'primary' | 'success' | 'warning' | 'neutral'> = { lessor: 'primary', lessee: 'success', guarantor: 'warning', representative: 'neutral' }

/**
 * O que a linha aberta da pessoa mostra. Cada código leva à coisa no lugar dela (contrato escolhido
 * em Contratos e pessoas, unidade escolhida na ficha do imóvel): link para outra coisa é explícito.
 *   onShowFicha: abaixo de 1280 px a ficha curta fica depois da tabela; o botão leva até ela.
 */
export function PersonExpansion({ personId, personName, pinned = false, onShowFicha }: { personId: string; personName: string; pinned?: boolean; onShowFicha?: () => void }) {
  const s = useSession()
  const q = useRepo('pessoa:vinculos', (sess) => getPersonLinks(sess, personId), [personId])
  const d = q.data
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!d || q.isPlaceholderData) return <Skeleton className="h-32" />
  const openContracts = can(s, 'contracts:view')
  const openUnits = can(s, 'properties:view')
  const nothing = !d.contracts.length && !d.units.length && !d.spots.length && !d.ownedSpots

  return (
    <div className="flex flex-col gap-4">
      {pinned && <p className="text-xs text-muted">Esta pessoa não está nesta página da lista ou não passa nos filtros ligados: aparece aqui porque foi escolhida.</p>}
      {nothing && <p className="text-sm text-muted">Sem contrato, unidade ou vaga ligada a esta pessoa.</p>}
      <div className="grid gap-4 @2xl:grid-cols-2">
        {d.contracts.length > 0 && (
          <Block title={`Contratos (${d.contracts.length})`} className="@2xl:col-span-2">
            <ShortList
              items={d.contracts}
              empty=""
              render={(k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                      {openContracts ? (
                        <Link to="/contratos" search={{ contrato: k.id }} className="font-medium text-primary hover:underline">
                          {k.code}
                        </Link>
                      ) : (
                        <span className="font-medium">{k.code}</span>
                      )}
                      {k.roles.map((r) => (
                        <Badge key={r} tone={ROLE_TONE[r]}>
                          {k.kind === 'management' && r === 'lessor' ? 'Proprietário' : PARTY_ROLE[r]}
                        </Badge>
                      ))}
                    </span>
                    <span className="truncate text-xs text-muted">{k.unit_label ?? `${k.property_name} (imóvel inteiro)`}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="num text-muted">
                      {formatDate(k.start_date)} a {formatDate(k.end_date)}
                    </span>
                    <Badge tone={CONTRACT_STATUS_TONE[k.status]}>{CONTRACT_STATUS[k.status]}</Badge>
                  </span>
                </li>
              )}
            />
          </Block>
        )}
        {(d.units.length > 0 || d.ownedSpots > 0) && (
          <Block title={`Unidades de que é dona (${d.units.length})`}>
            <ShortList
              items={d.units}
              empty="Nenhuma casa, apartamento ou sala."
              render={(u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    {openUnits ? (
                      <Link to="/imoveis/$propertyId" params={{ propertyId: u.property_id }} search={{ unidade: u.id }} className="font-medium text-primary hover:underline">
                        {u.code}
                      </Link>
                    ) : (
                      <span className="font-medium">{u.code}</span>
                    )}
                    <span className="block truncate text-xs text-muted">
                      {u.property_name}
                      {u.share_pct < 100 ? ` · fatia de ${formatPct(u.share_pct)}` : ''}
                    </span>
                  </span>
                  <UnitStatusBadge status={u.status} />
                </li>
              )}
            />
            {d.ownedSpots > 0 && <p className="text-xs text-muted">Dona também de {plural(d.ownedSpots, 'vaga de garagem', 'vagas de garagem')}.</p>}
          </Block>
        )}
        {d.spots.length > 0 && (
          <Block title={`Vagas que aluga (${d.spots.length})`}>
            <ShortList
              items={d.spots}
              empty=""
              render={(v) => (
                <li key={v.id} className="py-1.5 first:pt-0 last:pb-0">
                  {openUnits ? (
                    <Link to="/imoveis/$propertyId" params={{ propertyId: v.property_id }} search={{ unidade: v.id }} className="font-medium text-primary hover:underline">
                      Vaga {v.code}
                    </Link>
                  ) : (
                    <span className="font-medium">Vaga {v.code}</span>
                  )}
                  <span className="block truncate text-xs text-muted">{[v.property_name, v.place].filter(Boolean).join(' · ')}</span>
                </li>
              )}
            />
          </Block>
        )}
      </div>
      <Block title="Documentos da pessoa">
        <DocumentList
          docs={d.documents}
          loading={false}
          error={null}
          onRetry={() => q.refetch()}
          attach={{ target: `person:${personId}`, label: personName }}
          empty="Nenhum documento ligado à pessoa. Os do contrato ficam na linha do contrato."
        />
      </Block>
      {onShowFicha && (
        <div className="border-t border-border pt-3 xl:hidden">
          <Button size="sm" icon={<PanelRight className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={onShowFicha}>
            Ver ficha e ações
          </Button>
        </div>
      )}
    </div>
  )
}
