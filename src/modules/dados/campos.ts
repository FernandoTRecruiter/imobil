/* =============================================================================
   campos.ts: o que cada tipo de importação espera (campos, sinônimos, exemplo) e os
   leitores de valor que dizem a CAUSA e o CONSERTO quando a célula está errada.

   Por que um arquivo só para isso: o modelo de planilha (Baixar modelo), a adivinhação de
   colunas, a tela de mapeamento e a validação leem a MESMA lista. Mudar um rótulo aqui muda
   nos quatro lugares; sem isso, o modelo baixado deixaria de bater com o que a tela espera.
   ============================================================================= */
import { addDays, parseDateBR } from '@/lib/dates'
import { documentError, normalizeDocument, onlyDigits } from '@/lib/documents'
import { parseBRL } from '@/lib/money'
import type { Cents, IsoDate, ManualUnitStatus, PersonTag, PropertyKind, UnitKind } from '@/data/types'
import { cellText, excelSerialToIso, headerKey, type Cell } from './planilha'

export type ImportKind = 'people' | 'properties' | 'units'

export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  properties: 'Imóveis avulsos',
  people: 'Pessoas',
  units: 'Unidades de um imóvel',
}

export interface FieldDef {
  key: string
  /** Nome da coluna no modelo (e o primeiro sinônimo). */
  label: string
  /** Obrigatório para CRIAR. Ao atualizar, célula vazia mantém o que já estava. */
  required?: boolean
  synonyms: string[]
  /** Como preencher: vai para a aba "Instruções" do modelo e para a tela de mapeamento. */
  hint: string
  /** Valor da linha de exemplo do modelo (claramente fictício). */
  example: string
  /** Padrão sugerido para "célula vazia: usar padrão". Sem esta chave, o campo não aceita padrão. */
  defaultValue?: string
  /** Opções do padrão (vira um select na tela de regras). */
  choices?: string[]
  /** Só aparece na conta de imobiliária (carteira, responsável). */
  agencyOnly?: boolean
}

/** Marca que o modelo põe na linha de exemplo: se ela vier na planilha, a linha é recusada. */
export const EXAMPLE_MARK = 'Linha de exemplo: apague antes de importar'

const ADDRESS_FIELDS: FieldDef[] = [
  { key: 'cep', label: 'CEP', synonyms: ['codigo postal'], hint: '8 números; com ou sem traço.', example: '30000-000' },
  { key: 'street', label: 'Rua', synonyms: ['logradouro', 'endereco', 'endereço', 'avenida'], hint: 'Rua, avenida ou praça, sem o número.', example: 'Rua Exemplo' },
  { key: 'number', label: 'Número', synonyms: ['numero', 'nº', 'num', 'n'], hint: 'Número do imóvel na rua (S/N vale).', example: '100' },
  { key: 'complement', label: 'Complemento', synonyms: ['compl', 'complemento do endereco'], hint: 'Apartamento, bloco, sala. Pode ficar vazio.', example: '' },
  { key: 'district', label: 'Bairro', synonyms: [], hint: 'Nome do bairro.', example: 'Centro' },
  { key: 'city', label: 'Cidade', synonyms: ['municipio', 'município'], hint: 'Nome da cidade.', example: 'Belo Horizonte', defaultValue: 'Belo Horizonte' },
  { key: 'state', label: 'UF', synonyms: ['estado', 'sigla do estado'], hint: 'Sigla com 2 letras (MG, SP...).', example: 'MG', defaultValue: 'MG' },
]

const UNIT_MEASURES: FieldDef[] = [
  { key: 'area', label: 'Área (m²)', required: true, synonyms: ['area', 'metragem', 'area util', 'm2', 'tamanho'], hint: 'Área em metros quadrados; aceita vírgula (64,5).', example: '64' },
  { key: 'bedrooms', label: 'Quartos', synonyms: ['dormitorios', 'dorms', 'qtd quartos'], hint: 'Número inteiro (0 para sala ou loja).', example: '2', defaultValue: '0' },
  { key: 'bathrooms', label: 'Banheiros', synonyms: ['wc', 'banheiro'], hint: 'Número inteiro.', example: '1', defaultValue: '1' },
  { key: 'parking', label: 'Vagas', synonyms: ['garagem', 'vagas de garagem', 'vaga'], hint: 'Número inteiro.', example: '1', defaultValue: '0' },
  { key: 'rent', label: 'Aluguel pedido', synonyms: ['aluguel', 'valor', 'valor do aluguel', 'preco', 'preço', 'valor pedido'], hint: 'Em reais: 1.900,00 ou 1900. Pode ficar vazio.', example: '1.900,00' },
]

export const FIELDS: Record<ImportKind, FieldDef[]> = {
  people: [
    { key: 'name', label: 'Nome', required: true, synonyms: ['nome completo', 'razao social', 'razão social', 'nome/razao social', 'cliente', 'pessoa'], hint: 'Nome completo ou razão social.', example: 'Pessoa Exemplo Fictícia' },
    { key: 'document', label: 'CPF/CNPJ', required: true, synonyms: ['cpf', 'cnpj', 'documento', 'doc', 'cpf ou cnpj', 'cpf cnpj'], hint: 'CPF (11) ou CNPJ (14), com ou sem pontuação. É a chave que acha a pessoa repetida.', example: '123.456.789-09' },
    { key: 'kind', label: 'Tipo de pessoa', synonyms: ['tipo', 'pf/pj', 'pessoa fisica ou juridica', 'natureza'], hint: 'PF ou PJ. Vazio: sai do tamanho do documento.', example: 'PF' },
    { key: 'email', label: 'E-mail', synonyms: ['email', 'correio eletronico', 'mail'], hint: 'nome@exemplo.com.br. Pode ficar vazio.', example: 'pessoa@example.com' },
    { key: 'phone', label: 'Telefone', synonyms: ['celular', 'fone', 'whatsapp', 'tel', 'telefone celular'], hint: 'Com DDD: (31) 99999-0000.', example: '(31) 00000-0000' },
    { key: 'tags', label: 'Papéis', synonyms: ['papel', 'funcao', 'função', 'categoria', 'perfil'], hint: 'Prestador, Contato, Zelador ou Síndico, separados por vírgula. Proprietário e inquilino vêm das ligações com imóvel e contrato.', example: 'Contato' },
    ...ADDRESS_FIELDS,
    { key: 'notes', label: 'Observações', synonyms: ['obs', 'observacao', 'observação', 'notas', 'comentario'], hint: 'Texto livre, até 1.000 caracteres.', example: EXAMPLE_MARK },
  ],
  properties: [
    { key: 'name', label: 'Nome do imóvel', synonyms: ['nome', 'imovel', 'imóvel', 'apelido', 'descricao do imovel'], hint: 'Vazio: vira "Casa Rua, número".', example: 'Casa Exemplo, 100' },
    { key: 'kind', label: 'Tipo', required: true, synonyms: ['tipo do imovel', 'tipo de imovel', 'categoria'], hint: 'Casa, Apartamento, Loja, Sala ou Galpão (imóvel avulso, com uma unidade).', example: 'Casa', defaultValue: 'Casa', choices: ['Casa', 'Apartamento', 'Loja', 'Sala', 'Galpão'] },
    ...ADDRESS_FIELDS.map((f) => (['street', 'number', 'district', 'city', 'state'].includes(f.key) ? { ...f, required: true } : f)),
    { key: 'portfolio', label: 'Carteira', synonyms: ['portfolio', 'segmento'], hint: 'Nome de uma carteira já criada em Configurações.', example: 'Residencial', agencyOnly: true },
    { key: 'manager', label: 'Responsável', synonyms: ['gestor', 'corretor', 'administrador', 'e-mail do responsavel'], hint: 'E-mail ou nome de alguém da equipe ativa.', example: '', agencyOnly: true },
    { key: 'unit_code', label: 'Código da unidade', synonyms: ['codigo', 'código', 'unidade', 'cod'], hint: 'Vazio: Casa, Apto, Loja, Sala ou Galpão, conforme o tipo.', example: 'Casa' },
    ...UNIT_MEASURES,
    { key: 'owner', label: 'Proprietário (CPF/CNPJ)', synonyms: ['proprietario', 'dono', 'cpf do proprietario', 'documento do proprietario', 'cpf/cnpj do proprietario', 'cpf', 'cnpj'], hint: 'Documento de uma pessoa JÁ cadastrada (importe as pessoas antes).', example: '123.456.789-09' },
    { key: 'owner_since', label: 'Proprietário desde', synonyms: ['desde', 'data de aquisicao', 'aquisicao', 'data da compra'], hint: 'DD/MM/AAAA. Vazio: hoje.', example: '01/01/2026' },
    { key: 'notes', label: 'Observações', synonyms: ['obs', 'observacao', 'notas', 'comentario'], hint: 'Texto livre, até 2.000 caracteres.', example: EXAMPLE_MARK },
  ],
  units: [
    { key: 'code', label: 'Código', required: true, synonyms: ['codigo', 'unidade', 'apto', 'apartamento', 'numero da unidade', 'cod'], hint: 'Como a unidade é chamada (101, A-302, Loja 2). Único no imóvel.', example: '101' },
    { key: 'kind', label: 'Tipo', required: true, synonyms: ['tipo da unidade'], hint: 'Apartamento, Casa, Quarto, Sala, Loja, Galpão ou Vaga.', example: 'Apartamento', defaultValue: 'Apartamento', choices: ['Apartamento', 'Casa', 'Quarto', 'Sala', 'Loja', 'Galpão', 'Vaga'] },
    { key: 'building', label: 'Bloco', synonyms: ['torre', 'predio', 'prédio'], hint: 'Nome de um bloco que já existe no imóvel. Imóvel com um bloco só: pode ficar vazio.', example: 'Bloco A' },
    { key: 'floor', label: 'Andar', synonyms: ['pavimento', 'piso'], hint: 'Número do andar (3) ou nome (Térreo). O andar precisa existir.', example: '1' },
    { key: 'position', label: 'Posição no andar', synonyms: ['posicao', 'ordem', 'posicao no andar'], hint: 'Ordem da unidade no andar (1, 2, 3...). Vazio: depois da última.', example: '1' },
    ...UNIT_MEASURES,
    { key: 'status', label: 'Situação', synonyms: ['status', 'situacao'], hint: 'Disponível, Reservada, Em manutenção ou Bloqueada. Ocupada vem do contrato.', example: 'Disponível', defaultValue: 'Disponível', choices: ['Disponível', 'Reservada', 'Em manutenção', 'Bloqueada'] },
    { key: 'notes', label: 'Observações', synonyms: ['obs', 'observacao', 'notas'], hint: 'Texto livre, até 1.000 caracteres.', example: EXAMPLE_MARK },
  ],
}

/** Campos que a organização usa (a conta de proprietário não tem carteira nem equipe). */
export function fieldsFor(kind: ImportKind, agency: boolean): FieldDef[] {
  return FIELDS[kind].filter((f) => agency || !f.agencyOnly)
}

/* ---------------------------------------------------------------- leitores de valor */

/** Resultado de ler uma célula: valor ou mensagem (erro trava a linha; aviso só informa). */
export type Read<T> = { value: T; warning?: string } | { error: string }

/** A leitura falhou? (atalho de tipo: depois do "if", o TypeScript sabe que existe "error"). */
export function isErr<T>(r: Read<T>): r is { error: string } {
  return 'error' in r
}

/** Texto obrigatório ou opcional com limite de tamanho. */
export function readText(c: Cell, label: string, max: number): Read<string> {
  const t = cellText(c).replace(/\s+/g, ' ')
  if (t.length > max) return { error: `${label} com ${t.length} caracteres: o limite é ${max}. Encurte o texto.` }
  return { value: t }
}

/**
 * CPF ou CNPJ. Célula numérica do Excel perde o zero da frente (012.345.678-90 vira 1234567890):
 * completamos com zero à esquerda e AVISAMOS, porque o certo é formatar a coluna como texto.
 */
export function readDocument(c: Cell, label = 'CPF/CNPJ'): Read<string> {
  let doc = normalizeDocument(cellText(c))
  let warning: string | undefined
  if (typeof c === 'number' && (doc.length === 9 || doc.length === 10 || doc.length === 12 || doc.length === 13)) {
    doc = doc.padStart(doc.length <= 10 ? 11 : 14, '0')
    warning = `${label} veio como número (o Excel apaga o zero da frente): completado com zero. Formate a coluna como texto.`
  }
  // A mensagem de documents.ts já diz qual documento ("CPF inválido: ..."); a coluna aparece ao lado na prévia.
  const err = documentError(doc)
  if (err) return { error: err }
  return { value: doc, warning }
}

export function readEmail(c: Cell): Read<string> {
  const t = cellText(c).toLowerCase()
  if (!t) return { value: '' }
  if (!t.includes('@')) return { error: `E-mail "${t}" sem @: use nome@exemplo.com.br.` }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return { error: `E-mail "${t}" incompleto: falta o domínio (ex.: nome@empresa.com.br).` }
  return { value: t }
}

export function readPhone(c: Cell): Read<string> {
  const d = onlyDigits(cellText(c)).replace(/^55(?=\d{10,11}$)/, '') // +55 do Brasil sai
  if (!d) return { value: '' }
  if (d.length < 10) return { error: `Telefone com ${d.length} dígitos: inclua o DDD (ex.: 31 99999-0000).` }
  if (d.length > 11) return { error: `Telefone com ${d.length} dígitos: o máximo é 11 (DDD + 9 dígitos).` }
  return { value: d }
}

export function readCep(c: Cell): Read<string> {
  let d = onlyDigits(cellText(c))
  if (!d) return { value: '' }
  let warning: string | undefined
  if (typeof c === 'number' && d.length === 7) {
    d = d.padStart(8, '0')
    warning = 'CEP veio como número (o Excel apaga o zero da frente): completado com zero.'
  }
  if (d.length !== 8) return { error: `CEP com ${d.length} dígitos: ${d.length < 8 ? `falta${8 - d.length > 1 ? 'm' : ''} ${8 - d.length}` : 'sobra'}. O CEP tem 8 números.` }
  return { value: d, warning }
}

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

export function readUf(c: Cell): Read<string> {
  const t = cellText(c).toUpperCase()
  if (!t) return { value: '' }
  if (!UFS.includes(t)) return { error: `UF "${t}" inválida: use a sigla com 2 letras (ex.: MG).` }
  return { value: t }
}

/** Inteiro de 0 a max (quartos, vagas). Aceita 3 do Excel e "3" do CSV; recusa 2,5. */
export function readInt(c: Cell, label: string, max: number): Read<number | null> {
  const t = cellText(c)
  if (!t) return { value: null }
  const n = typeof c === 'number' ? c : Number(t.replace(',', '.'))
  if (!Number.isFinite(n)) return { error: `${label} "${t}" não é número: use só algarismos (ex.: 2).` }
  if (!Number.isInteger(n)) return { error: `${label} "${t}" precisa ser número inteiro.` }
  if (n < 0) return { error: `${label} negativo: use 0 ou mais.` }
  if (n > max) return { error: `${label} ${n} passa do limite de ${max}: confira a coluna.` }
  return { value: n }
}

/** Área em m², com vírgula ou ponto decimal ("64,5" ou 64.5). */
export function readArea(c: Cell, label = 'Área'): Read<number | null> {
  const t = cellText(c)
  if (!t) return { value: null }
  const n = typeof c === 'number' ? c : Number(t.replace(/\s|m²|m2/gi, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  if (!Number.isFinite(n)) return { error: `${label} "${t}" não é número: use 64 ou 64,5.` }
  if (n <= 0) return { error: `${label} precisa ser maior que zero.` }
  if (n > 100_000) return { error: `${label} de ${n.toLocaleString('pt-BR')} m² passa do limite: confira a coluna.` }
  return { value: Math.round(n * 100) / 100 }
}

/** Valor em reais -> centavos. "1.234,56", "1234,56", "R$ 1.234,56", 1234.56 (Excel). */
export function readMoney(c: Cell, label: string): Read<Cents | null> {
  const t = cellText(c)
  if (!t) return { value: null }
  const cents = parseBRL(typeof c === 'number' ? c : t)
  if (cents === null) return { error: `${label} "${t}" não é valor em reais: use 1.234,56.` }
  if (cents < 0) return { error: `${label} negativo: informe o valor sem sinal.` }
  if (cents > 100_000_000_00) return { error: `${label} acima de R$ 100 milhões: confira a coluna.` }
  return { value: cents }
}

/** Data: DD/MM/AAAA, AAAA-MM-DD ou data do Excel (número de série). Não aceita o futuro. */
export function readDate(c: Cell, label: string, today: IsoDate): Read<IsoDate | null> {
  const t = cellText(c)
  if (!t) return { value: null }
  const iso = typeof c === 'number' ? excelSerialToIso(c) : parseDateBR(t)
  if (!iso) return { error: `${label} "${t}" não é uma data que existe: use DD/MM/AAAA (ex.: 04/11/2026).` }
  if (iso > today) return { error: `${label} ${t} está no futuro: use hoje ou uma data passada.` }
  if (iso < addDays(today, -365 * 120)) return { error: `${label} ${t} é antiga demais: confira o ano.` }
  return { value: iso }
}

/* ---------------------------------------------------------------- listas de palavras */

/** Escolhe a opção cujo nome normalizado bate com a célula. */
function pick<T>(c: Cell, table: [string[], T][]): T | null {
  const k = headerKey(cellText(c))
  if (!k) return null
  for (const [words, value] of table) if (words.some((w) => headerKey(w) === k)) return value
  return null
}

/** Tipo do imóvel avulso: dá o tipo do imóvel E o da unidade (Loja = comercial com uma loja). */
export const PROPERTY_KIND_WORDS: [string[], { property: PropertyKind; unit: UnitKind; code: string; label: string }][] = [
  [['casa', 'residencia', 'sobrado'], { property: 'house', unit: 'house', code: 'Casa', label: 'Casa' }],
  [['apartamento', 'apto', 'ap', 'apt', 'flat', 'kitnet', 'studio'], { property: 'apartment', unit: 'apartment', code: 'Apto', label: 'Apartamento' }],
  [['loja', 'comercial', 'ponto comercial'], { property: 'commercial', unit: 'store', code: 'Loja', label: 'Loja' }],
  [['sala', 'sala comercial', 'escritorio', 'conjunto'], { property: 'commercial', unit: 'office', code: 'Sala', label: 'Sala' }],
  [['galpao', 'galpão', 'deposito', 'armazem'], { property: 'commercial', unit: 'warehouse', code: 'Galpão', label: 'Galpão' }],
]

export function readPropertyKind(c: Cell): Read<(typeof PROPERTY_KIND_WORDS)[number][1] | null> {
  const t = cellText(c)
  if (!t) return { value: null }
  const v = pick(c, PROPERTY_KIND_WORDS)
  if (v) return { value: v }
  if (['condominio', 'edificio', 'predio'].includes(headerKey(t)))
    return { error: `"${t}" tem várias unidades: cadastre o imóvel pela tela de Imóveis e importe as unidades dele depois.` }
  if (headerKey(t) === 'terreno') return { error: 'Terreno não tem unidade alugável no cadastro atual: cadastre como Galpão ou deixe de fora.' }
  return { error: `Tipo "${t}" não reconhecido: use Casa, Apartamento, Loja, Sala ou Galpão.` }
}

export const UNIT_KIND_WORDS: [string[], UnitKind][] = [
  [['apartamento', 'apto', 'ap', 'apt', 'flat', 'kitnet', 'studio'], 'apartment'],
  [['casa', 'sobrado'], 'house'],
  [['quarto', 'suite'], 'room'],
  [['sala', 'sala comercial', 'escritorio', 'conjunto'], 'office'],
  [['loja'], 'store'],
  [['galpao', 'galpão', 'deposito'], 'warehouse'],
  [['vaga', 'garagem', 'box'], 'parking'],
]

export function readUnitKind(c: Cell): Read<UnitKind | null> {
  const t = cellText(c)
  if (!t) return { value: null }
  const v = pick(c, UNIT_KIND_WORDS)
  return v ? { value: v } : { error: `Tipo "${t}" não reconhecido: use Apartamento, Casa, Quarto, Sala, Loja, Galpão ou Vaga.` }
}

export const STATUS_WORDS: [string[], ManualUnitStatus][] = [
  [['disponivel', 'livre', 'vaga', 'desocupada'], 'available'],
  [['reservada', 'reservado'], 'reserved'],
  [['em manutencao', 'manutencao', 'reforma', 'em reforma'], 'maintenance'],
  [['bloqueada', 'bloqueado', 'indisponivel'], 'blocked'],
]

export function readStatus(c: Cell): Read<ManualUnitStatus | null> {
  const t = cellText(c)
  if (!t) return { value: null }
  if (['ocupada', 'ocupado', 'alugada', 'alugado'].includes(headerKey(t)))
    return { error: 'Ocupada vem do contrato vigente, não da planilha: use Disponível (a unidade fica ocupada quando a locação começar).' }
  const v = pick(c, STATUS_WORDS)
  return v ? { value: v } : { error: `Situação "${t}" não reconhecida: use Disponível, Reservada, Em manutenção ou Bloqueada.` }
}

export function readPersonKind(c: Cell): Read<'PF' | 'PJ' | null> {
  const t = cellText(c)
  if (!t) return { value: null }
  const v = pick<'PF' | 'PJ'>(c, [
    [['pf', 'fisica', 'pessoa fisica', 'f'], 'PF'],
    [['pj', 'juridica', 'pessoa juridica', 'empresa', 'j'], 'PJ'],
  ])
  return v ? { value: v } : { error: `Tipo de pessoa "${t}" não reconhecido: use PF ou PJ.` }
}

const TAG_WORDS: [string[], PersonTag][] = [
  [['prestador', 'prestadora', 'fornecedor', 'prestador de servico'], 'vendor'],
  [['contato'], 'contact'],
  [['zelador', 'zeladora', 'porteiro'], 'caretaker'],
  [['sindico', 'sindica'], 'syndic'],
]

/** Papéis declarados separados por vírgula. Proprietário e inquilino viram aviso (vêm das ligações). */
export function readTags(c: Cell): Read<PersonTag[] | null> {
  const t = cellText(c)
  if (!t) return { value: null }
  const out = new Set<PersonTag>()
  const ignored: string[] = []
  for (const part of t.split(/[,;/|]/).map((p) => p.trim()).filter(Boolean)) {
    const v = pick(part, TAG_WORDS)
    if (v) out.add(v)
    else if (['proprietario', 'proprietaria', 'dono', 'inquilino', 'inquilina', 'locatario', 'locador', 'fiador'].includes(headerKey(part))) ignored.push(part)
    else return { error: `Papel "${part}" não existe: use Prestador, Contato, Zelador ou Síndico.` }
  }
  return { value: [...out], warning: ignored.length ? `${ignored.join(', ')}: proprietário, inquilino e fiador vêm das ligações com imóvel e contrato, não da planilha (ignorado).` : undefined }
}
