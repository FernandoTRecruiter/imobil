/* =============================================================================
   Importar planilha (Dados): o assistente do fluxo 3 da seção D do plano.

   1 Tipo -> 2 Arquivo -> 3 Mapeamento -> 4 Regras -> 5 Validação e prévia -> 6 Importar -> 7 Relatório.
   Cada passo só guarda escolhas na tela; quem decide o que entra é o repositório
   (importacao.ts), que refaz a validação na hora de gravar.

   Por que passo a passo e não "escolhe o arquivo e pronto": planilha de outro sistema quase
   nunca vem com o nome de coluna que esperamos, e o erro mais caro é o silencioso (CPF sem o
   zero da frente, valor com vírgula lido como milhar). A prévia mostra cada linha com a causa
   e o conserto ANTES de gravar.
   ============================================================================= */
import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, CircleCheck, Download, FileSpreadsheet, Upload, Undo2 } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { downloadText, toCsv } from '@/lib/csv'
import { formatDateTime } from '@/lib/dates'
import { readJSON, writeJSON } from '@/lib/storage'
import { plural } from '@/lib/text'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Field, Select } from '@/components/ui/Field'
import { Card, KpiTile, PageHeader, Stepper } from '@/components/ui/Layout'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { fieldsFor, IMPORT_KIND_LABEL, type FieldDef, type ImportKind } from './campos'
import { openDataManagerOn } from './memoria'
import { importContext, runImport, validateImport, type ImportContext, type ImportInput, type ImportPlan, type ImportResult, type ImportRules, type PlannedRow } from './importacao'
import { BatchesSection, UndoDialog } from './Lotes'
import { downloadTemplate } from './modelo'
import { cellText, DELIMITER_LABEL, findHeaderRow, guessMapping, MAX_ROWS, readSpreadsheetFile, type Cell, type ReadResult } from './planilha'

const STEPS = ['Tipo', 'Arquivo', 'Mapeamento', 'Regras', 'Validação', 'Importar', 'Relatório']
const MAP_KEY = (kind: ImportKind) => `imobil:importar:mapa:${kind}`

export function ImportPage() {
  return (
    <Guard action="data:import" what="a importação de planilhas">
      <ImportWizard />
    </Guard>
  )
}

/** Tudo o que sai do arquivo escolhido: a aba, o cabeçalho achado e as linhas de dados. */
interface Loaded {
  fileName: string
  read: ReadResult
  sheetIndex: number
}

function sheetData(loaded: Loaded, kind: ImportKind, agency: boolean) {
  const sheet = loaded.read.sheets[loaded.sheetIndex] ?? { name: '', rows: [], lines: [] }
  const synonyms = fieldsFor(kind, agency).flatMap((f) => [f.label, ...f.synonyms])
  const headerIdx = findHeaderRow(sheet.rows, synonyms)
  const width = Math.max(0, ...sheet.rows.slice(headerIdx, headerIdx + 200).map((r) => r.length))
  const headerCells = sheet.rows[headerIdx] ?? []
  const headers = Array.from({ length: width }, (_, i) => cellText(headerCells[i]) || `Coluna ${i + 1}`)
  return { sheet, headerIdx, headers, rows: sheet.rows.slice(headerIdx + 1), lines: sheet.lines.slice(headerIdx + 1), headerLine: sheet.lines[headerIdx] ?? 1 }
}

function defaultsFor(kind: ImportKind, agency: boolean): Record<string, string> {
  return Object.fromEntries(fieldsFor(kind, agency).filter((f) => f.defaultValue !== undefined).map((f) => [f.key, f.defaultValue!]))
}

function ImportWizard() {
  const s = useSession()
  const navigate = useNavigate()
  const ctxQ = useRepo('importar:contexto', importContext)
  const ctx = ctxQ.data
  const agency = ctx?.agency ?? true
  const [step, setStep] = useState(0)
  const [kind, setKind] = useState<ImportKind | null>(null)
  const [propertyId, setPropertyId] = useState<string>('')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [mapping, setMapping] = useState<Record<string, number | null>>({})
  const [guessed, setGuessed] = useState<Record<string, number | null>>({})
  const [rules, setRules] = useState<ImportRules>({ empty: 'ignore', defaults: {}, duplicate: 'skip' })
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [validating, setValidating] = useState(false)
  const [validateError, setValidateError] = useState<unknown>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [undoOpen, setUndoOpen] = useState(false)
  const [undone, setUndone] = useState(false)
  const run = useRepoMutation(runImport, {
    success: (r) => `Importação gravada: ${plural(r.plan.counts.create, 'registro criado', 'registros criados')}.`,
    onSuccess: (r) => {
      setResult(r)
      setStep(6)
    },
  })

  const fields = kind ? fieldsFor(kind, agency) : []
  const data = kind && loaded ? sheetData(loaded, kind, agency) : null

  /** Sugestão de colunas: a última escolha desta entidade vale primeiro, depois os sinônimos. */
  const remap = (k: ImportKind, l: Loaded) => {
    const d = sheetData(l, k, agency)
    const g = guessMapping(d.headers, fieldsFor(k, agency), readJSON<Record<string, string>>(MAP_KEY(k)) ?? {})
    setMapping(g)
    setGuessed(g)
  }

  const chooseKind = (k: ImportKind) => {
    setKind(k)
    setRules({ empty: 'ignore', defaults: defaultsFor(k, agency), duplicate: 'skip' })
    setPlan(null)
    if (loaded) remap(k, loaded)
  }

  const onFile = async (file: File | undefined) => {
    if (!file || !kind) return
    setReading(true)
    setFileError(null)
    setPlan(null)
    try {
      const read = await readSpreadsheetFile(file)
      const first = Math.max(0, read.sheets.findIndex((sh) => sh.rows.length > 0))
      const l: Loaded = { fileName: file.name, read, sheetIndex: first }
      const d = sheetData(l, kind, agency)
      if (!d.rows.length) throw new Error('Não achei linhas de dados abaixo do cabeçalho: confira se a planilha tem os registros a partir da linha 2.')
      if (d.rows.length > MAX_ROWS) throw new Error(`A planilha tem ${d.rows.length.toLocaleString('pt-BR')} linhas: o limite é ${MAX_ROWS.toLocaleString('pt-BR')} por lote. Divida em partes.`)
      setLoaded(l)
      remap(kind, l)
    } catch (e) {
      setLoaded(null)
      setFileError(e instanceof Error ? e.message : 'Não consegui ler o arquivo.')
    } finally {
      setReading(false)
    }
  }

  const chooseSheet = (i: number) => {
    if (!loaded || !kind) return
    const l = { ...loaded, sheetIndex: i }
    setLoaded(l)
    setPlan(null)
    remap(kind, l)
  }

  const input = (): ImportInput | null =>
    kind && data && loaded ? { kind, propertyId: kind === 'units' ? propertyId || null : null, fileName: loaded.fileName, headers: data.headers, rows: data.rows, lines: data.lines, mapping, rules } : null

  /** Valida chamando o repositório direto (a entrada pode ter milhares de linhas: não vira chave de cache). */
  const validate = async () => {
    const inp = input()
    if (!inp) return
    setStep(4)
    setValidating(true)
    setValidateError(null)
    try {
      setPlan(await validateImport(s, inp))
    } catch (e) {
      setPlan(null)
      setValidateError(e)
    } finally {
      setValidating(false)
    }
  }

  const rememberMapping = () => {
    if (!kind || !data) return
    const byName: Record<string, string> = {}
    for (const [field, idx] of Object.entries(mapping)) if (idx !== null && data.headers[idx]) byName[field] = data.headers[idx]
    writeJSON(MAP_KEY(kind), byName)
  }

  const restart = () => {
    setStep(0)
    setLoaded(null)
    setPlan(null)
    setResult(null)
    setUndone(false)
    setFileError(null)
  }

  const canNext =
    step === 0 ? !!kind && (kind !== 'units' || !!propertyId)
    : step === 1 ? !!data && data.rows.length > 0
    : step === 4 ? !!plan && plan.counts.create + plan.counts.update > 0
    : true

  const next = () => {
    if (step === 2) rememberMapping()
    if (step === 3) return void validate()
    setStep(step + 1)
  }

  return (
    <>
      <PageHeader
        eyebrow="Dados"
        title="Importar planilha"
        description="Traga imóveis, pessoas ou unidades de uma planilha (CSV ou XLSX). Nada é gravado antes da prévia, e o lote pode ser desfeito enquanto ninguém usar o que ele criou."
        actions={
          <Link to="/dados" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-border-strong hover:bg-surface-2">
            <ArrowLeft className="size-4" aria-hidden="true" /> Data Manager
          </Link>
        }
      />
      <Card className="flex flex-col gap-5 p-4 sm:p-5">
        <Stepper steps={STEPS} current={step} />
        {ctxQ.error ? (
          <ErrorState error={ctxQ.error} onRetry={() => ctxQ.refetch()} />
        ) : !ctx ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="min-w-0">
            {step === 0 && <StepKind ctx={ctx} kind={kind} propertyId={propertyId} onKind={chooseKind} onProperty={(id) => { setPropertyId(id); setPlan(null) }} />}
            {step === 1 && kind && (
              <StepFile kind={kind} loaded={loaded} data={data} reading={reading} error={fileError} onFile={(f) => void onFile(f)} onSheet={chooseSheet} />
            )}
            {step === 2 && kind && data && (
              <StepMapping
                fields={fields}
                headers={data.headers}
                rows={data.rows}
                mapping={mapping}
                guessed={guessed}
                onChange={(key, idx) => {
                  setMapping({ ...mapping, [key]: idx })
                  setPlan(null)
                }}
              />
            )}
            {step === 3 && kind && (
              <StepRules
                kind={kind}
                fields={fields}
                rules={rules}
                onChange={(r) => {
                  setRules(r)
                  setPlan(null)
                }}
              />
            )}
            {step === 4 && (
              <StepPreview plan={plan} validating={validating} error={validateError} fileName={loaded?.fileName ?? ''} onRetry={() => void validate()} />
            )}
            {step === 5 && plan && kind && <StepConfirm kind={kind} plan={plan} />}
            {step === 6 && result && (
              <StepReport
                result={result}
                undone={undone}
                onUndo={() => setUndoOpen(true)}
                onOpenManager={() => {
                  openDataManagerOn(result.batch.entity === 'people' ? 'people' : result.batch.entity === 'properties' ? 'properties' : 'units')
                  void navigate({ to: '/dados' })
                }}
                onRestart={restart}
              />
            )}
          </div>
        )}
        {step < 6 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <Button icon={<ArrowLeft className="size-4" aria-hidden="true" />} disabled={step === 0 || run.isPending} onClick={() => setStep(step - 1)}>
              Voltar
            </Button>
            {step < 5 ? (
              <Button variant="primary" disabled={!canNext || validating} onClick={next}>
                {step === 3 ? 'Validar' : 'Continuar'}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={<Upload className="size-4" aria-hidden="true" />}
                loading={run.isPending}
                loadingText="Importando…"
                disabled={!plan || plan.counts.create + plan.counts.update === 0}
                onClick={() => {
                  const inp = input()
                  if (inp) run.mutate(inp)
                }}
              >
                Importar {plan ? plural(plan.counts.create + plan.counts.update, 'linha', 'linhas') : ''}
              </Button>
            )}
          </div>
        )}
      </Card>
      <BatchesSection />
      {undoOpen && result && <UndoDialog batchId={result.batch.id} fileName={result.batch.file_name} onClose={() => setUndoOpen(false)} onDone={() => setUndone(true)} />}
    </>
  )
}

/* ---------------------------------------------------------------- 1. tipo */

const KIND_TEXT: Record<ImportKind, string> = {
  properties: 'Casas, apartamentos, lojas e salas avulsos: cada linha vira um imóvel com uma unidade. O proprietário (CPF/CNPJ) precisa estar cadastrado.',
  people: 'Proprietários, inquilinos, fiadores e prestadores. A chave é o CPF/CNPJ: a mesma pessoa não entra duas vezes.',
  units: 'Unidades de um condomínio ou prédio que já existe (o bloco e o andar precisam existir no cadastro do imóvel).',
}

function StepKind({ ctx, kind, propertyId, onKind, onProperty }: { ctx: ImportContext; kind: ImportKind | null; propertyId: string; onKind: (k: ImportKind) => void; onProperty: (id: string) => void }) {
  const s = useSession()
  const [downloading, setDownloading] = useState<ImportKind | null>(null)
  const prop = ctx.properties.find((p) => p.id === propertyId)
  const allowed: Record<ImportKind, string | null> = {
    properties: ctx.canProperties ? null : 'Pede a permissão "Imóveis: editar".',
    people: ctx.canPeople ? null : 'Pede a permissão "Pessoas: editar".',
    units: ctx.canProperties ? null : 'Pede a permissão "Imóveis: editar".',
  }
  const template = async (k: ImportKind) => {
    setDownloading(k)
    try {
      const b = prop?.buildings[0]
      await downloadTemplate(k, ctx.agency, {
        portfolio: ctx.portfolios[0] ?? '',
        manager: ctx.agency ? s.user.email : '',
        building: k === 'units' ? (b?.name ?? '') : undefined,
        floor: k === 'units' ? (b?.floors[1] ?? b?.floors[0] ?? '') : undefined,
      })
    } finally {
      setDownloading(null)
    }
  }
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">O que você vai importar?</legend>
      <div className="grid gap-3 lg:grid-cols-3">
        {(['properties', 'people', 'units'] as const).map((k) => {
          const block = allowed[k]
          return (
            <div key={k} className={cn('flex flex-col gap-3 rounded-xl border p-4', kind === k ? 'border-primary bg-primary-soft/50' : 'border-border', block && 'opacity-60')}>
              <label className={cn('flex items-start gap-3', block ? 'cursor-not-allowed' : 'cursor-pointer')}>
                <input type="radio" name="tipo" className="mt-1 size-4 accent-[var(--primary)]" checked={kind === k} disabled={!!block} onChange={() => onKind(k)} />
                <span className="min-w-0">
                  <span className="block font-semibold">{IMPORT_KIND_LABEL[k]}</span>
                  <span className="mt-0.5 block text-sm text-muted">{block ?? KIND_TEXT[k]}</span>
                </span>
              </label>
              {k === 'units' && kind === 'units' && (
                <Field label="Imóvel que recebe as unidades" required hint={prop ? (prop.buildings.length ? `Blocos: ${prop.buildings.map((b) => b.name).join(', ')}` : 'Sem blocos: as unidades entram soltas no imóvel.') : undefined}>
                  {({ id, describedBy }) => (
                    <Select id={id} aria-describedby={describedBy} value={propertyId} onChange={(e) => onProperty(e.target.value)}>
                      <option value="">Escolha o imóvel</option>
                      {ctx.properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({plural(p.units, 'unidade', 'unidades')})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Button size="sm" variant="ghost" className="self-start" icon={<Download className="size-4" aria-hidden="true" />} loading={downloading === k} loadingText="Gerando…" onClick={() => void template(k)}>
                Baixar modelo
              </Button>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted">Contratos e lançamentos ainda não entram por planilha: dependem das regras de locação sobreposta, partes e cobrança, que chegam com o módulo de contratos.</p>
    </fieldset>
  )
}

/* ---------------------------------------------------------------- 2. arquivo */

function StepFile({ kind, loaded, data, reading, error, onFile, onSheet }: { kind: ImportKind; loaded: Loaded | null; data: ReturnType<typeof sheetData> | null; reading: boolean; error: string | null; onFile: (f: File | undefined) => void; onSheet: (i: number) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Field label={`Planilha de ${IMPORT_KIND_LABEL[kind].toLowerCase()}`} hint="CSV (separado por ponto e vírgula, vírgula ou tabulação) ou XLSX. Até 5.000 linhas e 10 MB." error={error}>
        {({ id, describedBy, invalid }) => (
          // O botão nativo do arquivo vem no idioma do navegador ("Choose File"): o input fica
          // invisível (mas focável) e o rótulo em português faz o papel do botão.
          <span className="flex flex-wrap items-center gap-3">
            <input
              id={id}
              type="file"
              accept=".csv,.txt,.xlsx,.xls,.ods,text/csv"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              className="peer sr-only"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <label htmlFor={id} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-border-strong hover:bg-surface-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]">
              <Upload className="size-4" aria-hidden="true" /> Escolher arquivo
            </label>
            <span className="min-w-0 truncate text-sm text-muted">{loaded?.fileName ?? 'Nenhum arquivo escolhido'}</span>
          </span>
        )}
      </Field>
      {reading && <Skeleton className="h-20" />}
      {loaded && data && !reading && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <FileSpreadsheet className="size-4 text-primary" aria-hidden="true" /> {loaded.fileName}
          </p>
          <ul className="flex flex-col gap-1 text-muted">
            {loaded.read.kind === 'csv' ? (
              <li>
                CSV lido como {loaded.read.encoding === 'windows-1252' ? 'Windows-1252 (padrão do Excel antigo: os acentos foram convertidos)' : 'UTF-8'}, separador {DELIMITER_LABEL[loaded.read.delimiter!]}.
              </li>
            ) : (
              <li>{plural(loaded.read.sheets.length, 'aba', 'abas')} no arquivo.</li>
            )}
            <li>
              Cabeçalho na linha {data.headerLine}: {plural(data.headers.length, 'coluna', 'colunas')} e {plural(data.rows.length, 'linha de dados', 'linhas de dados')}.
            </li>
          </ul>
          {loaded.read.sheets.length > 1 && (
            <Field label="Aba com os dados" className="max-w-sm">
              {({ id }) => (
                <Select id={id} value={loaded.sheetIndex} onChange={(e) => onSheet(Number(e.target.value))}>
                  {loaded.read.sheets.map((sh, i) => (
                    <option key={sh.name + i} value={i}>
                      {sh.name} ({plural(Math.max(0, sh.rows.length - 1), 'linha', 'linhas')})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- 3. mapeamento */

function StepMapping({ fields, headers, rows, mapping, guessed, onChange }: { fields: FieldDef[]; headers: string[]; rows: Cell[][]; mapping: Record<string, number | null>; guessed: Record<string, number | null>; onChange: (key: string, idx: number | null) => void }) {
  const sample = rows.slice(0, 5)
  const used = new Set(Object.values(mapping).filter((v): v is number => v !== null))
  const missingRequired = fields.filter((f) => f.required && mapping[f.key] === null)
  const unused = headers.filter((_, i) => !used.has(i))
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="amostra">
        <h2 id="amostra" className="mb-2 text-sm font-semibold">
          Amostra do arquivo <span className="font-normal text-muted">(primeiras {sample.length} linhas)</span>
        </h2>
        <div className="max-h-64 overflow-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-xs">
            <caption className="sr-only">Primeiras linhas do arquivo</caption>
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i} scope="col" className={cn('sticky top-0 border-b border-border bg-surface-2 px-2.5 py-2 text-left font-semibold whitespace-nowrap', used.has(i) ? 'text-text' : 'text-muted')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.map((r, ri) => (
                <tr key={ri}>
                  {headers.map((_, ci) => (
                    <td key={ci} className="max-w-48 truncate border-b border-border bg-surface px-2.5 py-1.5 whitespace-nowrap">
                      {cellText(r[ci])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {missingRequired.length > 0 && (
        <p className="rounded-xl border border-warning/40 bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-sm text-warning-fg" role="status">
          Sem coluna: {missingRequired.map((f) => f.label).join(', ')}. Cada linha nova vai dar erro, a não ser que você defina um valor padrão no próximo passo.
        </p>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Qual coluna do arquivo vai para cada campo</legend>
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          {fields.map((f) => {
            const idx = mapping[f.key] ?? null
            const example = idx !== null ? sample.map((r) => cellText(r[idx])).find(Boolean) : undefined
            const auto = idx !== null && guessed[f.key] === idx
            return (
              <Field key={f.key} label={f.label} required={f.required} hint={idx !== null ? `${auto ? 'Sugestão automática. ' : ''}${example ? `Ex.: ${example}` : 'Coluna vazia nas primeiras linhas.'}` : f.hint}>
                {({ id, describedBy }) => (
                  <Select id={id} aria-describedby={describedBy} value={idx === null ? '' : String(idx)} onChange={(e) => onChange(f.key, e.target.value === '' ? null : Number(e.target.value))}>
                    <option value="">Não importar</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                        {used.has(i) && i !== idx ? ' (já usada)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )
          })}
        </div>
      </fieldset>
      {unused.length > 0 && <p className="text-xs text-muted">Colunas que ficam de fora: {unused.join(', ')}.</p>}
    </div>
  )
}

/* ---------------------------------------------------------------- 4. regras */

const DUP_KEY: Record<ImportKind, string> = {
  people: 'mesmo CPF/CNPJ',
  properties: 'mesma rua, número e complemento',
  units: 'mesmo código no imóvel escolhido',
}

function StepRules({ kind, fields, rules, onChange }: { kind: ImportKind; fields: FieldDef[]; rules: ImportRules; onChange: (r: ImportRules) => void }) {
  const defaultable = fields.filter((f) => f.defaultValue !== undefined)
  const radio = 'mt-0.5 size-4 accent-[var(--primary)]'
  const createNote = kind === 'properties' ? 'cria outro imóvel no mesmo endereço.' : kind === 'people' ? 'recusado: a conta não aceita dois cadastros com o mesmo CPF/CNPJ.' : 'recusado: dois códigos iguais no mesmo imóvel confundem contrato e espelho.'
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Célula vazia</legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="radio" name="vazio" className={radio} checked={rules.empty === 'ignore'} onChange={() => onChange({ ...rules, empty: 'ignore' })} />
          <span>
            <span className="font-medium">Ignorar</span>
            <span className="block text-muted">O campo fica vazio; ao atualizar, mantém o que já estava. Campo obrigatório vazio vira erro.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="radio" name="vazio" className={radio} checked={rules.empty === 'default'} onChange={() => onChange({ ...rules, empty: 'default' })} />
          <span>
            <span className="font-medium">Usar um valor padrão</span>
            <span className="block text-muted">Vale só para a célula vazia; a preenchida continua valendo.</span>
          </span>
        </label>
        {rules.empty === 'default' && (
          <div className="mt-2 grid gap-3 rounded-xl border border-border bg-surface-2 p-3 sm:grid-cols-2">
            {defaultable.map((f) => (
              <Field key={f.key} label={`${f.label} vazio vira`}>
                {({ id }) =>
                  f.choices ? (
                    <Select id={id} value={rules.defaults[f.key] ?? ''} onChange={(e) => onChange({ ...rules, defaults: { ...rules.defaults, [f.key]: e.target.value } })}>
                      <option value="">Sem padrão</option>
                      {f.choices.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <input
                      id={id}
                      className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                      value={rules.defaults[f.key] ?? ''}
                      onChange={(e) => onChange({ ...rules, defaults: { ...rules.defaults, [f.key]: e.target.value } })}
                    />
                  )
                }
              </Field>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Registro que já existe ({DUP_KEY[kind]})</legend>
        {(
          [
            ['skip', 'Pular a linha', 'O cadastro atual fica como está. Repetida no próprio arquivo também é pulada.'],
            ['update', 'Atualizar o existente', 'Só as células preenchidas mudam. O desfazer devolve os valores de antes.'],
            ['create', 'Importar mesmo assim', `Para ${IMPORT_KIND_LABEL[kind].toLowerCase()}: ${createNote}`],
          ] as const
        ).map(([value, title, text]) => (
          <label key={value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="repetido" className={radio} checked={rules.duplicate === value} onChange={() => onChange({ ...rules, duplicate: value })} />
            <span>
              <span className="font-medium">{title}</span>
              <span className="block text-muted">{text}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  )
}

/* ---------------------------------------------------------------- 5. validação e prévia */

const LEVEL_LABEL: Record<PlannedRow['level'], string> = { ok: 'Válida', warning: 'Aviso', error: 'Erro' }
const LEVEL_TONE = { ok: 'success', warning: 'warning', error: 'danger' } as const
const ACTION_LABEL: Record<PlannedRow['action'], string> = { create: 'Criar', update: 'Atualizar', skip: 'Pular', none: 'Fica de fora' }

/** Relatório da prévia em CSV: uma linha por mensagem (ou por linha da planilha, no relatório completo). */
export function planCsv(plan: ImportPlan, onlyProblems: boolean): string {
  const lines = plan.rows.flatMap((r) =>
    r.messages.length ? r.messages.map((m) => ({ r, column: m.column, message: m.message, level: m.level })) : onlyProblems ? [] : [{ r, column: '', message: '', level: r.level }],
  )
  return toCsv(lines, [
    { label: 'Linha', value: (x) => x.r.line },
    { label: 'Situação da linha', value: (x) => LEVEL_LABEL[x.r.level] },
    { label: 'Ação', value: (x) => ACTION_LABEL[x.r.action] },
    { label: 'Registro', value: (x) => x.r.label },
    { label: 'Coluna', value: (x) => x.column },
    { label: 'Nível', value: (x) => (x.level === 'error' ? 'Erro' : x.level === 'warning' ? 'Aviso' : '') },
    { label: 'Mensagem', value: (x) => x.message },
  ])
}

function StepPreview({ plan, validating, error, fileName, onRetry }: { plan: ImportPlan | null; validating: boolean; error: unknown; fileName: string; onRetry: () => void }) {
  const [level, setLevel] = useState<'all' | PlannedRow['level']>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  if (validating) return <Skeleton className="h-64" />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!plan) return <EmptyState title="Nada validado ainda" description="Volte às regras e clique em Validar." />
  const c = plan.counts
  const rows = level === 'all' ? plan.rows : plan.rows.filter((r) => r.level === level)
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)
  const columns: Column<PlannedRow>[] = [
    { key: 'line', header: 'Linha', align: 'right', className: 'w-16', cell: (r) => r.line },
    { key: 'level', header: 'Situação', cell: (r) => <Badge tone={LEVEL_TONE[r.level]}>{LEVEL_LABEL[r.level]}</Badge> },
    { key: 'label', header: 'Registro', cell: (r) => <span className="block max-w-56 truncate font-medium" title={r.label}>{r.label}</span> },
    { key: 'action', header: 'Ação', hideBelow: 'sm', cell: (r) => ACTION_LABEL[r.action] },
    {
      key: 'messages', header: 'Mensagens',
      cell: (r) =>
        r.messages.length ? (
          <ul className="flex min-w-56 flex-col gap-0.5 text-xs">
            {r.messages.map((m, i) => (
              <li key={i} className={m.level === 'error' ? 'text-danger-fg' : 'text-warning-fg'}>
                <span className="font-semibold">{m.column}:</span> {m.message}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-muted">Sem observação</span>
        ),
    },
  ]
  const chip = (value: typeof level, label: string, n: number) => (
    <button
      key={value}
      aria-pressed={level === value}
      onClick={() => {
        setLevel(value)
        setPage(1)
      }}
      className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm', level === value ? 'border-primary bg-primary-soft text-[var(--st-occupied-fg)]' : 'border-border bg-surface hover:border-border-strong')}
    >
      {label} <span className="num text-xs text-muted">{n}</span>
    </button>
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Linhas lidas" value={c.total.toLocaleString('pt-BR')} hint={fileName} emphasis />
        <KpiTile label="Válidas" value={c.ok.toLocaleString('pt-BR')} hint="Entram sem observação" tone="success" />
        <KpiTile label="Com aviso" value={c.warning.toLocaleString('pt-BR')} hint="Entram (ou são puladas) com observação" info="Aviso não trava a linha: diz o que foi ajustado ou pulado (ex.: CPF que perdeu o zero no Excel, linha repetida)." />
        <KpiTile label="Com erro" value={c.error.toLocaleString('pt-BR')} hint="Ficam de fora" tone={c.error ? 'danger' : undefined} />
      </div>
      <p className="text-sm">
        Ao importar: <strong>{plural(c.create, 'criada', 'criadas')}</strong>, <strong>{plural(c.update, 'atualizada', 'atualizadas')}</strong>, {plural(c.skip, 'pulada', 'puladas')} e {plural(c.error, 'linha com erro fica', 'linhas com erro ficam')} de fora.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {chip('all', 'Todas', c.total)}
        {chip('ok', 'Válidas', c.ok)}
        {chip('warning', 'Com aviso', c.warning)}
        {chip('error', 'Com erro', c.error)}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" icon={<Download className="size-4" aria-hidden="true" />} disabled={!c.error && !c.warning} onClick={() => downloadText(`erros-${fileName.replace(/\.[^.]+$/, '')}.csv`, planCsv(plan, true))}>
            Relatório de erros (CSV)
          </Button>
        </span>
      </div>
      <DataTable caption="Prévia da importação, linha a linha" columns={columns} rows={pageRows} rowKey={(r) => String(r.line)} empty={<EmptyState title="Nenhuma linha nesta situação" />} />
      <Pagination page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
    </div>
  )
}

/* ---------------------------------------------------------------- 6. importar */

function StepConfirm({ kind, plan }: { kind: ImportKind; plan: ImportPlan }) {
  const c = plan.counts
  const goes = c.create + c.update
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-base font-semibold">
        Vão entrar {plural(goes, 'linha', 'linhas')} de {plural(c.total, 'linha lida', 'linhas lidas')}.
      </p>
      <ul className="list-disc pl-5">
        <li>
          {plural(c.create, 'registro novo', 'registros novos')}
          {kind === 'properties' && c.create ? ' (cada imóvel ganha a sua unidade)' : ''}.
        </li>
        <li>{plural(c.update, 'registro atualizado', 'registros atualizados')} (o valor de antes fica guardado no lote).</li>
        <li>
          {plural(c.skip, 'linha pulada', 'linhas puladas')} e {plural(c.error, 'linha com erro', 'linhas com erro')} ficam de fora.
        </li>
      </ul>
      <p className="text-muted">Depois de importar dá para desfazer o lote inteiro enquanto nada dele for usado (contrato, chamado, lançamento ou proprietário ligado depois).</p>
    </div>
  )
}

/* ---------------------------------------------------------------- 7. relatório */

function StepReport({ result, undone, onUndo, onOpenManager, onRestart }: { result: ImportResult; undone: boolean; onUndo: () => void; onOpenManager: () => void; onRestart: () => void }) {
  const s = useSession()
  const c = result.plan.counts
  const b = result.batch
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 text-base font-semibold" role="status">
        <CircleCheck className="mt-0.5 size-5 shrink-0 text-success-fg" aria-hidden="true" />
        {undone ? `Importação de ${b.file_name} desfeita.` : `Importação de ${b.file_name} gravada em ${formatDateTime(b.created_at, s.org.timezone)}.`}
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Criados" value={c.create.toLocaleString('pt-BR')} tone="success" />
        <KpiTile label="Atualizados" value={(b.updated_records?.length ?? 0).toLocaleString('pt-BR')} hint={c.update > (b.updated_records?.length ?? 0) ? `${c.update - (b.updated_records?.length ?? 0)} já estavam iguais` : undefined} />
        <KpiTile label="Pulados" value={c.skip.toLocaleString('pt-BR')} />
        <KpiTile label="Com erro" value={c.error.toLocaleString('pt-BR')} tone={c.error ? 'danger' : undefined} hint="Não entraram" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onOpenManager} disabled={undone}>
          Ver no Data Manager
        </Button>
        <Button icon={<Download className="size-4" aria-hidden="true" />} onClick={() => downloadText(`relatorio-${b.file_name.replace(/\.[^.]+$/, '')}.csv`, planCsv(result.plan, false))}>
          Baixar relatório (CSV)
        </Button>
        {!undone && (
          <Button variant="danger" icon={<Undo2 className="size-4" aria-hidden="true" />} onClick={onUndo}>
            Desfazer importação
          </Button>
        )}
        <Button variant="ghost" onClick={onRestart}>
          Importar outra planilha
        </Button>
      </div>
    </div>
  )
}
