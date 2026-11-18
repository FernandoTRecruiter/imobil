/* =============================================================================
   modelo.ts: o "Baixar modelo" de cada tipo de importação.

   O modelo sai da MESMA lista de campos que a validação usa (campos.ts): cabeçalho igual ao
   que a tela reconhece, uma linha de exemplo claramente fictícia e uma aba "Instruções" com
   o que é obrigatório e como preencher. Assim o modelo nunca fica velho em relação à tela.
   ============================================================================= */
import { fieldsFor, IMPORT_KIND_LABEL, type ImportKind } from './campos'
import { downloadXlsx } from './planilha'

/** Valores do exemplo que dependem da conta (carteira que existe, e-mail de alguém da equipe, bloco do imóvel). */
export type ExampleOverrides = Partial<Record<string, string>>

const DUPLICATE_RULE: Record<ImportKind, string> = {
  people: 'Pessoa repetida = mesmo CPF/CNPJ (a conta não aceita dois cadastros com o mesmo documento).',
  properties: 'Imóvel repetido = mesma rua, número e complemento. Cada linha vira um imóvel com uma unidade.',
  units: 'Unidade repetida = mesmo código dentro do imóvel escolhido. Bloco e andar precisam existir no imóvel.',
}

/** Linhas das duas abas (pura: dá para testar sem navegador). */
export function templateSheets(kind: ImportKind, agency: boolean, overrides: ExampleOverrides = {}): { name: string; rows: (string | number | null)[][] }[] {
  const fields = fieldsFor(kind, agency)
  const header = fields.map((f) => f.label)
  const example = fields.map((f) => overrides[f.key] ?? f.example)
  const instructions: (string | null)[][] = [
    ['Coluna', 'Obrigatória para criar', 'Como preencher'],
    ...fields.map((f) => [f.label, f.required ? 'Sim' : 'Não', f.hint]),
    [null, null, null],
    ['Regras', null, 'Uma linha por registro, começando na linha 2 da aba de dados. A linha de exemplo é fictícia: apague antes de importar.'],
    [null, null, DUPLICATE_RULE[kind]],
    [null, null, 'CPF, CNPJ e CEP: formate a coluna como texto no Excel, senão ele apaga o zero da frente.'],
  ]
  return [
    { name: IMPORT_KIND_LABEL[kind], rows: [header, example] },
    { name: 'Instruções', rows: instructions },
  ]
}

const FILE_NAME: Record<ImportKind, string> = { people: 'modelo-pessoas.xlsx', properties: 'modelo-imoveis-avulsos.xlsx', units: 'modelo-unidades.xlsx' }

export async function downloadTemplate(kind: ImportKind, agency: boolean, overrides: ExampleOverrides = {}): Promise<void> {
  await downloadXlsx(FILE_NAME[kind], templateSheets(kind, agency, overrides))
}
