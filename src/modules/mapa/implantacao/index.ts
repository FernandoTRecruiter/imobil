/* =============================================================================
   Implantações: a porta de entrada. Diz qual desenho cada imóvel usa:
   - o imóvel tem implantação feita à mão (os 4 exemplos de exemplos.ts)? Usa ela;
   - não tem (cadastrado pela pessoa, ou antigo)? O desenho automático (layout.ts), que
     divide cada andar pela quantidade de unidades.
   O imóvel é achado pelo NOME (o mesmo de exemplos.ts), nunca pelo id: o id muda a cada
   semente nova, o nome é o que a pessoa vê.
   ============================================================================= */
import { EXEMPLOS, type Exemplo } from '@/data/seed/exemplos'
import { buildLayout, type Layout } from '../layout'
import type { MapScene } from '../repo'
import { LEPLAZA } from './leplaza'
import { LUAR } from './luar'
import { LYNX } from './lynx'
import { buildImplantacao } from './montar'
import { MONTJUIC } from './montjuic'
import type { Implantacao } from './tipos'

export const IMPLANTACOES: Record<Exemplo['key'], Implantacao> = { luar: LUAR, montjuic: MONTJUIC, leplaza: LEPLAZA, lynx: LYNX }

/** A implantação do imóvel com este nome (null = não tem: vale o desenho automático). */
export function implantacaoFor(propertyName: string): Implantacao | null {
  const ex = EXEMPLOS.find((e) => e.name === propertyName)
  return ex ? IMPLANTACOES[ex.key] : null
}

/** O layout da cena: pela implantação, quando o imóvel tem; senão, o automático. */
export function layoutFor(scene: MapScene): Layout {
  const spec = implantacaoFor(scene.title)
  return spec ? buildImplantacao(scene, spec) : buildLayout(scene)
}
