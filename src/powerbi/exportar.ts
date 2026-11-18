/* =============================================================================
   exportar.ts: os dados de EXEMPLO do Power BI, gerados dos dados fictícios.

   Quem usa: scripts/gera-powerbi.mjs (grava os CSVs e o teste_csv.html) e o teste
   powerbi.test.ts. Não entra no HTML do Power BI (o main.tsx não importa este arquivo).

   A prova que este arquivo permite, em 3 passos:
   1. dados fictícios -> linhas Lite (o mesmo tradutor da tela) -> indicadores DIRETOS;
   2. as mesmas linhas -> CSV -> o que a medida DAX faria -> adaptador -> indicadores;
   3. os dois conjuntos de indicadores têm de ser idênticos.
   Se forem, quem importar os CSVs no Power BI e colar a medida vê os números do app.
   ============================================================================= */
import type { IsoDate } from '@/data/types'
import { computeMacro, type Macro } from '@/modules/visao-geral/macro'
import { PERIOD_KEYS } from '@/modules/visao-geral/metrics'
import { exampleLite } from './dados'
import { csvToDadosBrutos, fromDadosBrutos, liteToCsv, type CsvFile, type DadosBrutos } from './schema'

export interface PowerBiExample {
  hoje: IsoDate
  organizacao: string
  csv: CsvFile[]
  /** O que a medida montaria a partir dos CSVs (vai para o teste_csv.html). */
  raw: DadosBrutos
  direct: Macro[]
  fromCsv: Macro[]
  warnings: string[]
}

/**
 * Indicadores dos 4 períodos a partir de CSVs (do jeito que o Power BI leria): CSV -> o que a
 * medida escreve -> adaptador -> fórmulas. O gerador chama com os arquivos que acabou de gravar.
 */
export function overviewFromCsv(files: Pick<CsvFile, 'table' | 'text'>[], hoje: IsoDate, organizacao: string): { raw: DadosBrutos; overviews: Macro[]; warnings: string[] } {
  const raw = csvToDadosBrutos(files, { hoje, organizacao })
  const back = fromDadosBrutos(raw)
  return { raw, overviews: PERIOD_KEYS.map((k) => computeMacro(back.data, back.hoje ?? hoje, k)), warnings: back.warnings }
}

export function powerBiExample(hoje: IsoDate): PowerBiExample {
  const { lite, organizacao } = exampleLite(hoje)
  const csv = liteToCsv(lite)
  const back = overviewFromCsv(csv, hoje, organizacao)
  return {
    hoje,
    organizacao,
    csv,
    raw: back.raw,
    direct: PERIOD_KEYS.map((k) => computeMacro(lite, hoje, k)),
    fromCsv: back.overviews,
    warnings: back.warnings,
  }
}
