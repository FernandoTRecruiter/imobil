// Testes do módulo Dados: leitura de planilha, adivinhação de coluna, validação com causa e
// conserto, importar + desfazer (e o desfazer recusado quando o lote já foi usado), edição na
// célula que fura regra e ação em lote. Rodar: npx vitest run src/modules/dados
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession } from '@/auth/session'
import { AccessError, RuleError } from '@/data/api'
import { ORG, USER } from '@/data/seed'
import { getDb, resetForTest, upsertRows } from '@/data/store'
import type { Id } from '@/data/types'
import { cpfFromBase } from '@/lib/documents'
import { fieldsFor, readDate, readDocument, readMoney, type ImportKind } from './campos'
import { previewUndo, runImport, undoImport, validateImport, type ImportInput } from './importacao'
import { templateSheets } from './modelo'
import { decodeText, detectDelimiter, findHeaderRow, guessMapping, parseCsv, parseCsvRecords, readCsvBytes, readWorkbookBytes, type Cell } from './planilha'
import { listDmUnits, previewBulk, runBulk, updatePerson, updateProperty, updateUnit } from './repo'

const TODAY = '2026-11-04'
const session = (userId: string) => {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}
beforeEach(() => {
  resetForTest(TODAY)
})

/** Monta a entrada da importação como a tela monta (mapeamento sugerido pelos cabeçalhos). */
function input(kind: ImportKind, headers: string[], rows: Cell[][], extra: Partial<ImportInput> = {}): ImportInput {
  return {
    kind, propertyId: null, fileName: 'teste.csv', headers, rows, lines: rows.map((_, i) => i + 2),
    mapping: guessMapping(headers, fieldsFor(kind, true)), rules: { empty: 'ignore', defaults: {}, duplicate: 'skip' }, ...extra,
  }
}

/** CPF válido que não existe nos dados fictícios. */
function freshCpf(base: string): string {
  const doc = cpfFromBase(base)
  expect(getDb().people.some((p) => p.document === doc)).toBe(false)
  return doc
}

describe('adivinhação de coluna por sinônimo normalizado', () => {
  it('"CPF", "CPF/CNPJ" e "Documento" vão para o documento; acento e caixa não importam', () => {
    const people = fieldsFor('people', true)
    const m = guessMapping(['Nome completo', 'CPF/CNPJ', 'E-MAIL', 'Celular', 'Bairro', 'Coluna estranha'], people)
    expect([m.name, m.document, m.email, m.phone, m.district]).toEqual([0, 1, 2, 3, 4])
    expect(guessMapping(['Documento'], people).document).toBe(0)
    expect(guessMapping(['cpf'], people).document).toBe(0)
    expect(guessMapping(['Coluna estranha'], people).name).toBeNull()
  })
  it('imóvel: endereço, Nº, metragem, aluguel e documento do proprietário', () => {
    const m = guessMapping(['Endereço', 'Nº', 'Bairro', 'Cidade', 'UF', 'Tipo', 'Metragem', 'Valor do aluguel', 'CPF do proprietário'], fieldsFor('properties', true))
    expect([m.street, m.number, m.district, m.city, m.state, m.kind, m.area, m.rent, m.owner]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
  it('a última escolha lembrada vence a adivinhação, e uma coluna não vai para dois campos', () => {
    const people = fieldsFor('people', true)
    const m = guessMapping(['Doc do cliente', 'CPF'], people, { document: 'Doc do cliente' })
    expect(m.document).toBe(0)
    expect(Object.values(m).filter((v) => v === 0)).toHaveLength(1)
  })
  it('o modelo baixado é reconhecido inteiro pela própria tela', () => {
    for (const kind of ['people', 'properties', 'units'] as const) {
      const [data] = templateSheets(kind, true)
      const header = data.rows[0] as string[]
      const m = guessMapping(header, fieldsFor(kind, true))
      fieldsFor(kind, true).forEach((f, i) => expect(m[f.key], `${kind}.${f.key}`).toBe(i))
    }
  })
})

describe('CSV do Excel brasileiro', () => {
  it('separador ";" com vírgula decimal e Windows-1252 importa sem caractere quebrado', () => {
    const text = 'Nome;CPF/CNPJ;Aluguel\r\n"Ação; Ltda";123.456.789-09;"1.234,56"\r\nJoão Conceição;;2.000,00\r\n'
    // Windows-1252 coincide com o Latin-1 nas letras acentuadas: cada letra vira um byte.
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0))
    const { sheet, encoding, delimiter } = readCsvBytes(bytes)
    expect(encoding).toBe('windows-1252')
    expect(delimiter).toBe(';')
    expect(sheet.rows[1][0]).toBe('Ação; Ltda')
    expect(sheet.rows[2][0]).toBe('João Conceição')
    const money = readMoney(sheet.rows[1][2], 'Aluguel')
    expect(money).toEqual({ value: 123456 })
  })
  it('UTF-8 com BOM: lido como UTF-8 e sem a marca no primeiro cabeçalho', () => {
    const bytes = new TextEncoder().encode(`${String.fromCharCode(0xfeff)}Nome;Cidade\nAna;São Paulo\n`)
    const { text, encoding } = decodeText(bytes)
    expect(encoding).toBe('utf-8')
    expect(parseCsv(text)).toEqual([['Nome', 'Cidade'], ['Ana', 'São Paulo']])
  })
  it('acha o separador pela constância (título no topo e decimais com vírgula não enganam)', () => {
    expect(detectDelimiter('Nome,CPF\nAna,123')).toBe(',')
    expect(detectDelimiter('Nome\tCPF\nAna\t123')).toBe('\t')
    expect(detectDelimiter('Relatório de imóveis, 2026\nNome,CPF,Email\nAna,1,a@b.c\nBia,2,b@c.d')).toBe(',')
    expect(detectDelimiter('Nome;Valor;Outro;Mais\nA;1,5;2,5;3,5\nB;1,5;2,5;3,5')).toBe(';')
  })
  it('aspas: separador e aspa dobrada dentro do campo; aspa no meio da célula sem aspas é texto', () => {
    expect(parseCsv('"Rua ""A"", 10";x\nRua "B";y', ';')).toEqual([['Rua "A", 10', 'x'], ['Rua "B"', 'y']])
  })
  it('linha vazia some, mas a numeração continua a do arquivo', () => {
    expect(parseCsvRecords('Nome;CPF\n\nAna;1\n"Linha\ncom quebra";2\nBia;3', ';').map((r) => r.line)).toEqual([1, 3, 4, 6])
  })
})

describe('XLSX', () => {
  it('lê número como número, acha o cabeçalho abaixo de um título e guarda a linha do Excel', async () => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([['Cadastro de pessoas'], [], ['Nome', 'CPF/CNPJ', 'Aluguel'], ['Ana', 1234567890, 1234.567]])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Pessoas')
    const [sheet] = await readWorkbookBytes(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer))
    expect(sheet.lines).toEqual([1, 3, 4])
    const syn = fieldsFor('people', true).flatMap((f) => [f.label, ...f.synonyms])
    expect(findHeaderRow(sheet.rows, syn)).toBe(1)
    // CPF que o Excel guardou como número perdeu o zero: volta com aviso.
    const doc = readDocument(sheet.rows[2][1])
    expect(doc).toMatchObject({ value: '01234567890' })
    expect('warning' in doc && doc.warning).toMatch(/zero da frente/)
    expect(readMoney(sheet.rows[2][2], 'Aluguel')).toEqual({ value: 123457 })
  })
})

describe('validação: cada linha diz a causa e o conserto', () => {
  it('CPF, e-mail, obrigatório e linha de exemplo do modelo', async () => {
    const s = session(USER.admin)
    const ok = freshCpf('900800701')
    const plan = await validateImport(
      s,
      input('people', ['Nome', 'Documento', 'E-mail'], [
        ['Ana Teste', '123.456.789-08', 'ana@'],
        ['', ok, ''],
        ['Pessoa Exemplo Fictícia', freshCpf('900800702'), ''],
        ['Bruno Teste', freshCpf('900800703'), 'bruno@example.com'],
      ]),
    )
    const [r1, r2, r3, r4] = plan.rows
    expect(r1.level).toBe('error')
    expect(r1.messages.map((m) => m.message).join(' | ')).toMatch(/CPF inválido: dígito verificador não confere/)
    expect(r1.messages.find((m) => m.message.includes('E-mail'))?.column).toBe('E-mail')
    expect(r1.messages.find((m) => m.message.includes('CPF'))?.column).toBe('Documento') // o nome da coluna NO ARQUIVO
    expect(r2.messages[0].message).toMatch(/Nome vazio: preencha na planilha ou defina um padrão/)
    expect(r3.messages[0].message).toMatch(/Linha de exemplo do modelo/)
    expect(r4.level).toBe('ok')
    expect(plan.counts).toMatchObject({ total: 4, ok: 1, error: 3, create: 1 })
  })

  it('data, valor e referência inexistente (carteira, proprietário, responsável)', async () => {
    const s = session(USER.admin)
    const headers = ['Tipo', 'Rua', 'Número', 'Bairro', 'Cidade', 'UF', 'Área (m²)', 'Aluguel pedido', 'Carteira', 'Responsável', 'Proprietário (CPF/CNPJ)', 'Proprietário desde']
    const plan = await validateImport(
      s,
      input('properties', headers, [
        ['Casa', 'Rua Nova', '10', 'Centro', 'Belo Horizonte', 'MG', '90', 'abc', 'Luxo', 'ninguem@example.com', freshCpf('700600501'), '31/02/2026'],
        ['Mansão', 'Rua Nova', '11', 'Centro', 'Belo Horizonte', 'MGG', '90', '1.500,00', '', '', '', ''],
      ]),
    )
    const text = (i: number) => plan.rows[i].messages.map((m) => `${m.column}: ${m.message}`).join(' | ')
    expect(text(0)).toMatch(/Aluguel pedido "abc" não é valor em reais: use 1\.234,56/)
    expect(text(0)).toMatch(/Carteira "Luxo" não existe: use Residencial, Comercial/)
    expect(text(0)).toMatch(/não é da equipe ativa/)
    expect(text(0)).toMatch(/não está cadastrado: importe a pessoa antes/)
    expect(text(0)).toMatch(/Proprietário desde "31\/02\/2026" não é uma data que existe: use DD\/MM\/AAAA/)
    expect(text(1)).toMatch(/Tipo "Mansão" não reconhecido/)
    expect(text(1)).toMatch(/UF "MGG" inválida/)
    expect(plan.counts.error).toBe(2)
    expect(readDate('05/11/2026', 'Data', TODAY)).toEqual({ error: expect.stringMatching(/futuro/) })
  })

  it('unidade: bloco e andar precisam existir; "Ocupada" não entra; código repetido com "importar mesmo assim" é recusado', async () => {
    const s = session(USER.admin)
    // Mount Juic: blocos A a F; o Bloco A tem térreo (só volume) e 4 andares.
    const condo = getDb().properties.find((p) => p.name === 'Condomínio Mount Juic')!
    const plan = await validateImport(
      s,
      input('units', ['Código', 'Tipo', 'Bloco', 'Andar', 'Área (m²)', 'Situação'], [
        ['G-101', 'Apartamento', 'Bloco G', '1', '64', 'Disponível'],
        ['A-901', 'Apartamento', 'A', '9', '64', ''],
        ['A-101', 'Apartamento', 'A', '1', '64', ''],
        ['A-109', 'Apartamento', 'A', '1º andar', '64', 'Ocupada'],
        ['A-110', 'Apartamento', 'Bloco A', 'Cobertura', '64,5', ''],
        ['A-111', 'Apartamento', 'Bloco A', '2', '64,5', ''],
      ], { propertyId: condo.id, rules: { empty: 'ignore', defaults: {}, duplicate: 'create' } }),
    )
    const msg = (i: number) => plan.rows[i].messages.map((m) => m.message).join(' | ')
    expect(msg(0)).toMatch(/Bloco "Bloco G" não existe neste imóvel \(existem: Bloco A, Bloco B, Bloco C/)
    expect(msg(1)).toMatch(/Andar "9" não existe no Bloco A/)
    expect(msg(2)).toMatch(/Já existe a unidade A-101 neste imóvel: dois códigos iguais/)
    expect(msg(3)).toMatch(/Ocupada vem do contrato vigente/)
    expect(msg(4)).toMatch(/Andar "Cobertura" não existe/)
    expect(plan.rows[5]).toMatchObject({ level: 'ok', action: 'create' })
  })
})

describe('importar e desfazer', () => {
  it('cria o lote e as pessoas com import_batch_id, audita, e o desfazer apaga só o lote', async () => {
    const s = session(USER.admin)
    const before = getDb().people.length
    const docs = [freshCpf('100200301'), freshCpf('100200302')]
    const inp = input('people', ['Nome', 'CPF', 'E-mail', 'Papéis'], [
      ['Pessoa Teste Um', docs[0], 'um@example.com', 'Prestador, Síndico'],
      ['Pessoa Teste Dois', docs[1], '', 'Inquilino'],
      ['Pessoa Repetida', docs[0], '', ''],
    ])
    const r = await runImport(s, inp)
    expect(r.batch).toMatchObject({ entity: 'people', rows_total: 3, rows_ok: 1, rows_warning: 2, rows_error: 0, undone_at: null })
    const created = getDb().people.filter((p) => p.import_batch_id === r.batch.id)
    expect(created.map((p) => p.name).sort()).toEqual(['Pessoa Teste Dois', 'Pessoa Teste Um'])
    expect(created.find((p) => p.name === 'Pessoa Teste Um')?.tags).toEqual(['vendor', 'syndic'])
    expect(r.batch.errors.some((e) => e.row === 4 && /Repete a linha 2/.test(e.message))).toBe(true)
    expect(getDb().audit_logs.some((a) => a.entity === 'import_batches' && a.entity_id === r.batch.id && a.action === 'import')).toBe(true)
    expect(getDb().audit_logs.filter((a) => a.entity === 'people' && a.action === 'import')).toHaveLength(2)

    // Repetir a mesma planilha (regra "pular") não duplica: nada novo para gravar.
    await expect(runImport(s, inp)).rejects.toThrow(/Nada para importar/)

    const pre = await previewUndo(s, r.batch.id)
    expect(pre).toMatchObject({ blockers: [], created: { people: 2, properties: 0, units: 0 } })
    await undoImport(s, r.batch.id)
    expect(getDb().people.length).toBe(before)
    expect(getDb().import_batches.find((b) => b.id === r.batch.id)?.undone_at).toBeTruthy()
    expect(getDb().audit_logs.some((a) => a.entity_id === r.batch.id && a.action === 'undo')).toBe(true)
    await expect(undoImport(s, r.batch.id)).rejects.toThrow(/já foi desfeito/)
  })

  it('"atualizar" muda só o que veio preenchido, e o desfazer devolve o valor de antes', async () => {
    const s = session(USER.admin)
    const target = getDb().people.find((p) => p.organization_id === ORG.agency && !p.deleted_at && p.tags.length === 0 && p.phone)!
    const inp = input('people', ['CPF', 'Telefone'], [[target.document, '(31) 98888-7777']], { rules: { empty: 'ignore', defaults: {}, duplicate: 'update' } })
    const r = await runImport(s, inp)
    const after = getDb().people.find((p) => p.id === target.id)!
    expect(after.phone).toBe('31988887777')
    expect(after.name).toBe(target.name)
    expect(r.batch.updated_records).toHaveLength(1)
    await undoImport(s, r.batch.id)
    expect(getDb().people.find((p) => p.id === target.id)?.phone).toBe(target.phone)
  })

  it('"importar mesmo assim" com CPF já cadastrado é recusado (documento único na conta)', async () => {
    const s = session(USER.admin)
    const existing = getDb().people.find((p) => p.organization_id === ORG.agency)!
    const plan = await validateImport(s, input('people', ['Nome', 'CPF'], [['Outra Pessoa', existing.document]], { rules: { empty: 'ignore', defaults: {}, duplicate: 'create' } }))
    expect(plan.rows[0].level).toBe('error')
    expect(plan.rows[0].messages[0].message).toMatch(/a conta não aceita dois cadastros com o mesmo documento/)
  })

  it('imóvel avulso: cria imóvel + unidade + dono; contrato na unidade depois impede o desfazer', async () => {
    const s = session(USER.admin)
    const owner = getDb().people.find((p) => p.organization_id === ORG.agency && p.kind === 'PF' && !p.deleted_at)!
    const headers = ['Tipo', 'Rua', 'Número', 'Bairro', 'Cidade', 'UF', 'Área (m²)', 'Aluguel pedido', 'Proprietário (CPF/CNPJ)', 'Carteira']
    const r = await runImport(s, input('properties', headers, [['Casa', 'Rua do Teste', '77', 'Centro', 'Belo Horizonte', 'MG', '120', '2.500,00', owner.document, 'Residencial']]))
    const prop = getDb().properties.find((p) => p.import_batch_id === r.batch.id)!
    const unit = getDb().units.find((u) => u.import_batch_id === r.batch.id)!
    expect(prop.name).toBe('Casa Teste, 77') // nome automático igual ao dos dados de exemplo ("Rua do" sai)
    expect(unit).toMatchObject({ code: 'Casa', kind: 'house', area_m2: 120, asking_rent_cents: 250000, property_id: prop.id })
    expect(getDb().property_owners.some((o) => o.property_id === prop.id && o.person_id === owner.id && o.share_pct === 100)).toBe(true)

    // A unidade ganhou um contrato: o lote foi USADO, desfazer recusa e diz o que impede.
    const k = getDb().contracts[0]
    upsertRows('contracts', [{ ...k, id: 'k-teste' as Id, unit_id: unit.id, property_id: prop.id, code: 'LOC-TESTE-0001' }])
    await expect(undoImport(s, r.batch.id)).rejects.toThrow(RuleError)
    await expect(undoImport(s, r.batch.id)).rejects.toThrow(/LOC-TESTE-0001/)
    expect(getDb().properties.some((p) => p.id === prop.id)).toBe(true)
  })

  it('o lote antigo do gerador aparece e o desfazer dele é recusado (as vagas já têm contrato)', async () => {
    const s = session(USER.admin)
    // As 36 vagas do estacionamento do Lynx vieram de planilha.
    const old = getDb().import_batches.find((b) => b.file_name === 'planilha-vagas-lynx.xlsx')!
    const pre = await previewUndo(s, old.id)
    expect(pre.created).toMatchObject({ properties: 0, units: 36 })
    expect(pre.blockers.length).toBeGreaterThan(0)
    expect(pre.blockers.join(' ')).toMatch(/contratos? LOC-/)
    await expect(undoImport(s, old.id)).rejects.toThrow(/Não dá para desfazer/)
    expect(getDb().units.filter((u) => u.import_batch_id === old.id && u.kind === 'parking')).toHaveLength(36)
  })

  it('quem não tem "importar" ou é de outra conta não importa nem desfaz', async () => {
    const old = getDb().import_batches.find((b) => b.organization_id === ORG.agency)!
    await expect(previewUndo(session(USER.staff), old.id)).rejects.toThrow(AccessError)
    await expect(previewUndo(session(USER.landlord), old.id)).rejects.toThrow(AccessError) // lote de outra organização
    await expect(validateImport(session(USER.staff), input('people', ['Nome'], [['X']]))).rejects.toThrow(AccessError)
  })
})

describe('Data Manager: edição na célula passa pela regra', () => {
  it('recusa "Ocupada" à mão, área negativa e campo fora da lista; aceita o resto e audita o antes e depois', async () => {
    const s = session(USER.admin)
    const unit = getDb().units.find((u) => u.organization_id === ORG.agency && !u.deleted_at)!
    await expect(updateUnit(s, { id: unit.id, patch: { manual_status: 'occupied' } })).rejects.toThrow(/Ocupada vem do contrato vigente/)
    await expect(updateUnit(s, { id: unit.id, patch: { area_m2: -5 } })).rejects.toThrow(/maior que zero/)
    await expect(updateUnit(s, { id: unit.id, patch: { code: 'X-1' } })).rejects.toThrow(/não se edita no Data Manager/)
    await updateUnit(s, { id: unit.id, patch: { area_m2: 99.5 } })
    const log = getDb().audit_logs.find((a) => a.entity === 'units' && a.entity_id === unit.id && a.action === 'update')
    expect(log?.changes?.area_m2).toEqual({ from: unit.area_m2, to: 99.5 })
  })

  it('tirar "prestador" de quem tem chamado aberto é recusado; carteira inexistente também', async () => {
    const s = session(USER.admin)
    const db = getDb()
    const job = db.maintenance_requests.find((r) => r.organization_id === ORG.agency && r.vendor_person_id && !['done', 'canceled'].includes(r.status))!
    await expect(updatePerson(s, { id: job.vendor_person_id!, patch: { tags: [] } })).rejects.toThrow(/prestador em \d+ chamados? abertos?/)
    await expect(updatePerson(s, { id: job.vendor_person_id!, patch: { email: 'sem-arroba' } })).rejects.toThrow(/E-mail incompleto/)
    const prop = db.properties.find((p) => p.organization_id === ORG.agency)!
    await expect(updateProperty(s, { id: prop.id, patch: { portfolio_id: 'nao-existe' } })).rejects.toThrow(/carteira não existe/)
  })

  it('escopo: outra conta não acha o registro; colaborador sem "importar" não usa o Data Manager', async () => {
    const unit = getDb().units.find((u) => u.organization_id === ORG.agency)!
    await expect(updateUnit(session(USER.landlord), { id: unit.id, patch: { area_m2: 50 } })).rejects.toThrow(AccessError)
    await expect(updateUnit(session(USER.staff), { id: unit.id, patch: { area_m2: 50 } })).rejects.toThrow(AccessError)
    await expect(listDmUnits(session(USER.staff), {})).rejects.toThrow(AccessError)
    const marina = await listDmUnits(session(USER.landlord), { pageSize: 500 })
    expect(marina.rows.every((u) => getDb().units.find((x) => x.id === u.id)?.organization_id === ORG.landlord)).toBe(true)
  })

  it('lote: a prévia separa o que muda do que fica de fora (locação vigente não arquiva)', async () => {
    const s = session(USER.admin)
    const db = getDb()
    const leased = db.contracts.find((k) => k.organization_id === ORG.agency && k.kind === 'lease' && k.status === 'active' && k.end_date >= TODAY)!
    const busy = new Set(db.contracts.filter((k) => ['active', 'awaiting_signature'].includes(k.status)).map((k) => k.unit_id))
    const free = db.units.find((u) => u.organization_id === ORG.agency && !busy.has(u.id) && !u.deleted_at)!
    const plan = await previewBulk(s, { entity: 'units', ids: [leased.unit_id!, free.id], action: { kind: 'archive' } })
    expect(plan.change.map((c) => c.id)).toEqual([free.id])
    expect(plan.skip[0].reason).toMatch(/locação vigente/)
    await expect(previewBulk(s, { entity: 'units', ids: [free.id], action: { kind: 'status', status: 'occupied' } })).rejects.toThrow(/Ocupada/)
    const done = await runBulk(s, { entity: 'units', ids: [leased.unit_id!, free.id], action: { kind: 'archive' } })
    expect(done.change).toHaveLength(1)
    expect(getDb().units.find((u) => u.id === free.id)?.deleted_at).toBeTruthy()
    expect(getDb().units.find((u) => u.id === leased.unit_id)?.deleted_at).toBeNull()
  })
})
