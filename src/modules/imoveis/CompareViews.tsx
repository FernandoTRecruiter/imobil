/* =============================================================================
   CompareViews: a janela do "Comparar" de imóveis e de unidades, ligada aos dados (comparar.ts)
   e ao kit (components/ui/Compare.tsx). Usada na página Imóveis (categorias Imóveis e Unidades)
   e na aba Unidades da ficha do imóvel. As marcadas moram em useCompare('imoveis') e
   useCompare('unidades'): marcar numa tela e abrir a outra mantém as marcas.
   ============================================================================= */
import { useState } from 'react'
import { CompareDialog, CompareTray, useCompare } from '@/components/ui/Compare'
import { buildComparison, comparisonExport } from '@/components/ui/compare-model'
import { useRepo } from '@/data/hooks'
import { placeLine } from './components'
import { getPropertyComparison, getUnitComparison, PROPERTY_METRICS, UNIT_METRICS, unitCompareName, type PropertyCompareItem, type UnitCompareItem } from './comparar'

/** A faixa do rodapé e a janela dos imóveis marcados. */
export function PropertyCompareBar() {
  const compare = useCompare('imoveis')
  const [open, setOpen] = useState(false)
  return (
    <>
      <CompareTray compare={compare} noun={['imóvel', 'imóveis']} onCompare={() => setOpen(true)} />
      {open && compare.ids.length >= 2 && <PropertyCompareDialog ids={compare.ids} onRemove={compare.remove} onClose={() => setOpen(false)} />}
    </>
  )
}

function PropertyCompareDialog({ ids, onRemove, onClose }: { ids: string[]; onRemove: (id: string) => void; onClose: () => void }) {
  const q = useRepo('comparar:imoveis', (s) => getPropertyComparison(s, ids), [ids.join(',')])
  const items: PropertyCompareItem[] = q.data ?? []
  return (
    <CompareDialog
      title={`Comparar ${ids.length} imóveis`}
      items={items.map((p) => ({ id: p.id, name: p.name, sub: p.address.district }))}
      rows={buildComparison(items, PROPERTY_METRICS)}
      loading={!q.data}
      onClose={onClose}
      onRemove={onRemove}
      fileName="comparacao-imoveis"
      exportRows={items}
      exportColumns={comparisonExport((p) => p.name, PROPERTY_METRICS, 'Imóvel')}
    />
  )
}

/** A faixa do rodapé e a janela das unidades marcadas. */
export function UnitCompareBar() {
  const compare = useCompare('unidades')
  const [open, setOpen] = useState(false)
  return (
    <>
      <CompareTray compare={compare} noun={['unidade', 'unidades']} onCompare={() => setOpen(true)} />
      {open && compare.ids.length >= 2 && <UnitCompareDialog ids={compare.ids} onRemove={compare.remove} onClose={() => setOpen(false)} />}
    </>
  )
}

function UnitCompareDialog({ ids, onRemove, onClose }: { ids: string[]; onRemove: (id: string) => void; onClose: () => void }) {
  const q = useRepo('comparar:unidades', (s) => getUnitComparison(s, ids), [ids.join(',')])
  const items: UnitCompareItem[] = q.data ?? []
  return (
    <CompareDialog
      title={`Comparar ${ids.length} unidades`}
      items={items.map((u) => ({ id: u.id, name: u.code, sub: [u.property_name, placeLine(u)].filter(Boolean).join(' · ') }))}
      rows={buildComparison(items, UNIT_METRICS)}
      loading={!q.data}
      onClose={onClose}
      onRemove={onRemove}
      fileName="comparacao-unidades"
      exportRows={items}
      exportColumns={comparisonExport(unitCompareName, UNIT_METRICS, 'Unidade')}
    />
  )
}
