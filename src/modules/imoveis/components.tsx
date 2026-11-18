/* =============================================================================
   Peças de tela do módulo Imóveis usadas em mais de uma página:
     - OccupancyBar: barra de ocupação com o número ao lado (cor nunca sozinha);
     - unitColumns: as colunas da tabela de unidades (lista de Imóveis). Desde 07/11/2026 cada
       coluna diz o que vira no "Exportar" (export) e há colunas opcionais, desligadas até a pessoa
       ligar em "Colunas": bloco e andar, contrato, locatário desde, tempo de contrato, R$/m²,
       dependentes e animais do locatário (útil em prédio com regra de animal).
   O espelho andar x unidade (Espelho) saiu em 06/11/2026: a ficha do imóvel mostra o 3D com a
   tabela das unidades embaixo (IsoView, no módulo mapa), e o espelho repetia os dois.
   ============================================================================= */
import type { MouseEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Badge, UnitStatusBadge } from '@/components/ui/Badge'
import { formatMonths } from '@/components/ui/compare-model'
import type { Column } from '@/components/ui/DataTable'
import { UNIT_KIND, UNIT_STATUS } from '@/data/labels'
import type { UnitStatus } from '@/data/types'
import type { UnitRow } from '@/data/views/units'
import { csvMoney } from '@/lib/csv'
import { formatDate } from '@/lib/dates'
import { formatBRL } from '@/lib/money'

/** Ordem fixa das situações em toda legenda (a mesma do mapa). */
export const STATUS_ORDER: UnitStatus[] = ['occupied', 'available', 'reserved', 'maintenance', 'blocked']

export function formatPctNumber(n: number): string {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

export function OccupancyBar({ pct }: { pct: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-[var(--border)]" aria-hidden="true">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="num text-[13px]">{formatPctNumber(pct)}</span>
    </span>
  )
}

/** "3º andar · Bloco A" (o que o código sozinho não diz). */
export function placeLine(u: Pick<UnitRow, 'floor_label' | 'building_name'>): string {
  return [u.floor_label, u.building_name].filter(Boolean).join(' · ')
}

/** Aluguel por m² (o vigente; sem locação, o pedido), em centavos. Sem área ou sem valor: sem número. */
export function rentPerM2(u: Pick<UnitRow, 'area_m2' | 'lease' | 'asking_rent_cents'>): number | null {
  const rent = u.lease?.rent_cents ?? u.asking_rent_cents
  return rent && u.area_m2 > 0 ? Math.round(rent / u.area_m2) : null
}

/** "1 ano e 4 meses de 2 anos e 6 meses": quanto passou da locação vigente e a duração dela. */
export function leaseTermText(u: Pick<UnitRow, 'lease_elapsed_months' | 'lease_duration_months'>): string {
  if (u.lease_elapsed_months === null || u.lease_duration_months === null) return ''
  return `${formatMonths(u.lease_elapsed_months)} de ${formatMonths(u.lease_duration_months)}`
}

/** Número que pode faltar: vazio (não informado) é diferente de zero. */
const count = (n: number | null) => (n === null ? '' : n)

/**
 * Colunas da tabela de unidades. "showProperty" liga a coluna Imóvel (na lista geral);
 * no detalhe do imóvel ela some e o andar aparece embaixo do código.
 * "linkPeople": inquilino vira link só para quem pode abrir o cadastro de pessoas.
 * As colunas "optional" ficam no menu "Colunas" (components/ui/columns.ts), desligadas por padrão.
 */
export function unitColumns({ showProperty, linkPeople }: { showProperty: boolean; linkPeople: boolean }): Column<UnitRow>[] {
  // O clique no link não pode disparar também o clique da linha (abriria a página duas vezes).
  const stop = (e: MouseEvent) => e.stopPropagation()
  return [
    {
      key: 'code', header: 'Unidade', sortable: true, firstDir: 'asc', locked: true,
      export: [{ label: 'Unidade', value: (u) => u.code }, { label: 'Arquivada', value: (u) => (u.deleted_at ? 'sim' : '') }],
      cell: (u) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5">
            <Link to="/unidades/$unitId" params={{ unitId: u.id }} className="font-medium hover:underline" onClick={stop}>
              {u.code}
            </Link>
            {u.deleted_at && <Badge>Arquivada</Badge>}
          </span>
          {!showProperty && placeLine(u) && <span className="text-xs text-muted">{placeLine(u)}</span>}
          {/* No celular a coluna Imóvel some: o nome vem embaixo do código ("Casa" sozinho não diz qual). */}
          {showProperty && <span className="line-clamp-1 text-xs text-muted sm:hidden">{u.property_name}</span>}
        </span>
      ),
    },
    ...(showProperty
      ? [
          {
            key: 'property', header: 'Imóvel', sortable: true, firstDir: 'asc', hideBelow: 'sm', className: 'max-w-64',
            export: [{ label: 'Imóvel', value: (u) => u.property_name }],
            cell: (u) => <span className="line-clamp-2">{u.property_name}</span>,
          } satisfies Column<UnitRow>,
        ]
      : []),
    {
      key: 'place', header: 'Bloco e andar', optional: true, hideBelow: 'md',
      export: [{ label: 'Bloco', value: (u) => u.building_name }, { label: 'Andar', value: (u) => u.floor_label }],
      cell: (u) => <span className="whitespace-nowrap text-muted">{placeLine(u)}</span>,
    },
    { key: 'status', header: 'Situação', sortable: true, firstDir: 'asc', export: [{ label: 'Situação', value: (u) => UNIT_STATUS[u.status] }], cell: (u) => <UnitStatusBadge status={u.status} /> },
    { key: 'kind', header: 'Tipo', hideBelow: 'lg', export: [{ label: 'Tipo', value: (u) => UNIT_KIND[u.kind] }], cell: (u) => UNIT_KIND[u.kind] },
    {
      key: 'area', header: 'Área', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'lg',
      export: [{ label: 'Área (m²)', value: (u) => u.area_m2.toLocaleString('pt-BR') }],
      cell: (u) => <span className="whitespace-nowrap">{u.area_m2.toLocaleString('pt-BR')} m²</span>,
    },
    // Sala e vaga: vazio, não "0".
    { key: 'bedrooms', header: 'Quartos', align: 'right', hideBelow: 'lg', export: [{ label: 'Quartos', value: (u) => u.bedrooms || '' }], cell: (u) => u.bedrooms || '' },
    {
      key: 'rent', header: 'Aluguel', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'sm',
      export: [
        { label: 'Aluguel vigente (R$)', value: (u) => csvMoney(u.lease?.rent_cents) },
        { label: 'Aluguel pedido (R$)', value: (u) => (u.lease ? '' : csvMoney(u.asking_rent_cents)) },
      ],
      cell: (u) =>
        u.lease ? (
          formatBRL(u.lease.rent_cents)
        ) : u.asking_rent_cents ? (
          <span className="flex flex-col items-end text-muted" title="Valor pedido no anúncio (sem contrato vigente)">
            <span className="whitespace-nowrap">{formatBRL(u.asking_rent_cents)}</span>
            <span className="text-[11px]">pedido</span>
          </span>
        ) : null,
    },
    {
      key: 'rent_m2', header: 'R$/m²', menuLabel: 'Aluguel por m²', optional: true, align: 'right', hideBelow: 'md',
      export: [{ label: 'Aluguel por m² (R$)', value: (u) => csvMoney(rentPerM2(u)) }],
      cell: (u) => {
        const v = rentPerM2(u)
        // Sem locação, o R$/m² é do valor pedido: cinza, como o aluguel pedido.
        return v === null ? null : <span className={u.lease ? undefined : 'text-muted'}>{formatBRL(v)}</span>
      },
    },
    {
      key: 'lessee', header: 'Inquilino', hideBelow: 'md', className: 'max-w-56',
      export: [{ label: 'Inquilino', value: (u) => u.lease?.lessee_name }],
      cell: (u) =>
        u.lease?.lessee_id && linkPeople ? (
          <Link to="/pessoas/$personId" params={{ personId: u.lease.lessee_id }} className="line-clamp-2 hover:underline" onClick={stop}>
            {u.lease.lessee_name}
          </Link>
        ) : (
          <span className="line-clamp-2">{u.lease?.lessee_name}</span>
        ),
    },
    {
      key: 'lessee_since', header: 'Locatário desde', optional: true, align: 'right', hideBelow: 'md',
      export: [{ label: 'Locatário desde', value: (u) => formatDate(u.lessee_since) }],
      cell: (u) => formatDate(u.lessee_since),
    },
    {
      key: 'lease_term', header: 'Tempo de contrato', optional: true, hideBelow: 'md',
      export: [
        { label: 'Tempo de contrato (meses)', value: (u) => count(u.lease_elapsed_months) },
        { label: 'Duração do contrato (meses)', value: (u) => count(u.lease_duration_months) },
      ],
      cell: (u) => <span className="text-[13px] whitespace-nowrap">{leaseTermText(u)}</span>,
    },
    { key: 'contract', header: 'Contrato', optional: true, hideBelow: 'md', export: [{ label: 'Contrato', value: (u) => u.lease?.code }], cell: (u) => <span className="num text-[13px]">{u.lease?.code}</span> },
    {
      key: 'end_date', header: 'Fim do contrato', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md',
      export: [{ label: 'Fim do contrato', value: (u) => formatDate(u.lease?.end_date) }],
      cell: (u) => formatDate(u.lease?.end_date),
    },
    {
      key: 'dependents', header: 'Dependentes', menuLabel: 'Dependentes do locatário', optional: true, align: 'right', hideBelow: 'md',
      export: [{ label: 'Dependentes do locatário', value: (u) => count(u.lessee_dependents) }],
      cell: (u) => count(u.lessee_dependents),
    },
    {
      key: 'pets', header: 'Animais', menuLabel: 'Animais do locatário', optional: true, hideBelow: 'md',
      export: [{ label: 'Animais do locatário', value: (u) => u.lessee_pets }],
      cell: (u) => <span className="text-[13px] whitespace-nowrap">{u.lessee_pets}</span>,
    },
    { key: 'owners', header: 'Donos', hideBelow: 'lg', className: 'max-w-56', export: [{ label: 'Donos', value: (u) => u.owners_label }], cell: (u) => <span className="line-clamp-2 text-muted">{u.owners_label}</span> },
    { key: 'district', header: 'Bairro', optional: true, hideBelow: 'lg', export: [{ label: 'Bairro', value: (u) => u.district }], cell: (u) => u.district },
  ]
}
