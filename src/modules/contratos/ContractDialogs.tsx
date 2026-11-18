/* =============================================================================
   Janelas do contrato: mudar a situação, registrar reajuste, observação ou aditivo, e renovar.
   Toda janela diz o NOME do contrato e o que vai mudar antes de confirmar (regra da casa).
   ============================================================================= */
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSession } from '@/auth/SessionProvider'
import { useRepoMutation } from '@/data/hooks'
import { ADJUSTMENT_INDEX, CONTRACT_STATUS } from '@/data/labels'
import type { AdjustmentIndex, ContractStatus } from '@/data/types'
import type { ContractRow } from '@/data/views/contracts'
import { addDays, formatDate, formatMonth, monthsBetween, parseDateBR } from '@/lib/dates'
import { applyPct, formatBRL } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { formatPct, parsePct } from '@/modules/financeiro/ui'
import { addContractEvent, changeContractStatus, endDateFor, registerAdjustment, renewContract, rentHorizon, transitionLabel, type ContractView } from './repo'

/** "LOC-2026-0012 (A-301, Fulano)": o nome do contrato nas confirmações. */
export function contractName(k: ContractRow): string {
  const extra = [k.unit_code, k.lessee_name].filter(Boolean).join(', ')
  return extra ? `${k.code} (${extra})` : k.code
}

/* ---------------------------------------------------------------- mudar a situação */

export function TransitionDialog({ contract: k, to, onClose }: { contract: ContractRow; to: ContractStatus; onClose: () => void }) {
  const s = useSession()
  const [note, setNote] = useState('')
  const [date, setDate] = useState(s.today)
  const [error, setError] = useState<string | null>(null)
  const rescind = to === 'terminated' && k.status === 'active'
  const save = useRepoMutation(changeContractStatus, {
    success: (r) =>
      r.created
        ? `Contrato ativado: ${r.created} cobranças mensais geradas.`
        : r.canceled
          ? `${CONTRACT_STATUS[to]}: ${r.canceled} cobranças futuras canceladas${r.kept ? `; ${r.kept} com pagamento parcial ficaram em aberto` : ''}.`
          : `${k.code}: ${CONTRACT_STATUS[to].toLowerCase()}.`,
    onSuccess: onClose,
  })
  const confirm = () => {
    if (rescind && note.trim().length < 3) return setError('Conte o motivo da rescisão (fica na linha do tempo).')
    if (rescind && (parseDateBR(date) !== date || date > s.today || date < k.start_date)) return setError(`A saída fica entre ${formatDate(k.start_date)} e hoje (${formatDate(s.today)}).`)
    save.mutate({ id: k.id, to, note: note.trim(), ...(rescind ? { date } : {}) })
  }
  const horizon = rentHorizon(k, s.today)
  const count = monthsBetween(horizon.from, horizon.to) + 1
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${transitionLabel(k.status, to)}?`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant={to === 'terminated' ? 'danger' : 'primary'} loading={save.isPending} onClick={confirm}>
            {transitionLabel(k.status, to)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          <strong>{contractName(k)}</strong> passa de "{CONTRACT_STATUS[k.status]}" para "{CONTRACT_STATUS[to]}".
        </p>
        {to === 'awaiting_signature' && <p className="text-muted">Aprovado, o contrato segura a unidade de {formatDate(k.start_date)} a {formatDate(k.end_date)}: nenhuma outra locação pode cruzar esse período.</p>}
        {to === 'active' && k.kind === 'lease' && (
          <p className="text-muted">
            Gera as cobranças mensais de {formatMonth(horizon.from)} a {formatMonth(horizon.to)} ({count}), de {formatBRL(k.rent_cents)} com vencimento todo dia {k.due_day}
            {k.start_date < s.today ? ', incluindo os meses desde o início' : ''}. As seguintes nascem com "Gerar próximas cobranças".
          </p>
        )}
        {to === 'ended' && <p className="text-muted">O prazo terminou em {formatDate(k.end_date)}. Cobranças de meses depois do fim, em aberto e sem pagamento, são canceladas.</p>}
        {to === 'terminated' && !rescind && <p className="text-muted">O contrato fica como "Rescindido" (cancelado antes de começar) e sai da fila de aprovação. A história continua na linha do tempo.</p>}
        {rescind && (
          <>
            <p className="text-muted">
              O fim passa a ser o dia da saída. Cobranças de meses depois da saída, em aberto e sem pagamento, são canceladas; a do mês da saída fica (o proporcional é ajuste manual).
            </p>
            <Field label="Dia da saída (entrega das chaves)" required>
              {({ id }) => <Input id={id} type="date" min={k.start_date} max={s.today} value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
          </>
        )}
        <Field label={rescind ? 'Motivo' : 'Observação (opcional)'} required={rescind} error={error}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={note}
              maxLength={500}
              onChange={(e) => {
                setNote(e.target.value)
                setError(null)
              }}
              placeholder={rescind ? 'Ex.: acordo entre as partes, com multa proporcional' : 'Fica na linha do tempo do contrato'}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- reajuste */

export function AdjustmentDialog({ view, onClose }: { view: ContractView; onClose: () => void }) {
  const k = view.contract
  const [index, setIndex] = useState<AdjustmentIndex>(k.adjustment_index === 'none' ? 'IPCA' : k.adjustment_index)
  const [pctText, setPctText] = useState('')
  const [date, setDate] = useState(view.nextAdjustmentFrom)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ pct?: string; date?: string }>({})
  const pct = parsePct(pctText)
  const to = pct === null ? null : k.rent_cents + applyPct(k.rent_cents, pct)
  const save = useRepoMutation(registerAdjustment, {
    success: (r) => `Reajuste registrado: aluguel de ${formatBRL(r.contract.rent_cents)}; ${r.updated} cobranças em aberto atualizadas.`,
    onSuccess: onClose,
  })
  const confirm = () => {
    const e: typeof errors = {}
    if (pct === null || pct < -50 || pct > 100) e.pct = 'Digite o percentual do índice, por exemplo 4,5 (pode ser negativo).'
    if (parseDateBR(date) !== date) e.date = 'Informe a data.'
    else if (date < view.nextAdjustmentFrom) e.date = `Reajuste só uma vez por ano (Lei 10.192/2001): a partir de ${formatDate(view.nextAdjustmentFrom)}.`
    else if (date > k.end_date) e.date = `Depois do fim do contrato (${formatDate(k.end_date)}).`
    setErrors(e)
    if (!e.pct && !e.date) save.mutate({ id: k.id, index, pct: pct!, effective_date: date, note: note.trim() })
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Registrar reajuste"
      description={`${contractName(k)} · aluguel atual ${formatBRL(k.rent_cents)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={confirm}>
            Registrar reajuste
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Índice" required>
            {({ id }) => (
              <Select id={id} value={index} onChange={(e) => setIndex(e.target.value as AdjustmentIndex)}>
                {(Object.keys(ADJUSTMENT_INDEX) as AdjustmentIndex[]).filter((i) => i !== 'none').map((i) => (
                  <option key={i} value={i}>
                    {ADJUSTMENT_INDEX[i]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Percentual (%)" required error={errors.pct} hint="O índice dos últimos 12 meses.">
            {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} aria-invalid={invalid} value={pctText} onChange={(e) => setPctText(e.target.value)} placeholder="4,5" />}
          </Field>
          <Field label="Vale a partir de" required error={errors.date}>
            {({ id, describedBy, invalid }) => <Input id={id} type="date" min={view.nextAdjustmentFrom} max={k.end_date} aria-describedby={describedBy} aria-invalid={invalid} value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        </div>
        <p className="num rounded-lg bg-surface-2 px-3 py-2">
          {to !== null && pct !== null ? (
            <>
              {formatBRL(k.rent_cents)} + {formatPct(pct)} = <strong>{formatBRL(to)}</strong>. Vale para as cobranças em aberto que vencem a partir de {parseDateBR(date) ? formatDate(date) : 'a data'}; as já pagas não mudam.
            </>
          ) : (
            'Digite o percentual para ver o aluguel novo.'
          )}
        </p>
        <Field label="Observação (opcional)">
          {({ id }) => <Textarea id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- observação e aditivo */

export function EventDialog({ contract: k, kind, onClose }: { contract: ContractRow; kind: 'note' | 'amendment'; onClose: () => void }) {
  const s = useSession()
  const [note, setNote] = useState('')
  const [date, setDate] = useState(s.today)
  const [error, setError] = useState<string | null>(null)
  const save = useRepoMutation(addContractEvent, { success: kind === 'note' ? 'Observação registrada.' : 'Aditivo registrado.', onSuccess: onClose })
  const confirm = () => {
    if (note.trim().length < 3) return setError('Escreva pelo menos 3 letras.')
    if (parseDateBR(date) !== date) return setError('Informe a data.')
    if (kind === 'note' && date > s.today) return setError('Observação registra o que já aconteceu: use hoje ou uma data anterior.')
    save.mutate({ id: k.id, kind, effective_date: date, note: note.trim() })
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={kind === 'note' ? 'Adicionar observação' : 'Registrar aditivo'}
      description={contractName(k)}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={confirm}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {kind === 'amendment' && <p className="text-muted">Aditivo é a mudança combinada entre as partes (troca de fiador, nova cláusula). Anexe o documento assinado na tela Documentos.</p>}
        <Field label={kind === 'note' ? 'Data' : 'Vale a partir de'} required>
          {({ id }) => <Input id={id} type="date" max={kind === 'note' ? s.today : undefined} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label={kind === 'note' ? 'Observação' : 'O que muda'} required error={error} hint={kind === 'note' ? 'Só a equipe vê as observações.' : undefined}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={note}
              maxLength={1000}
              onChange={(e) => {
                setNote(e.target.value)
                setError(null)
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- renovar */

export function RenewDialog({ contract: k, onClose }: { contract: ContractRow; onClose: () => void }) {
  const navigate = useNavigate()
  const start = addDays(k.end_date, 1)
  const end = endDateFor(start, Math.max(1, monthsBetween(k.start_date, start)))
  const save = useRepoMutation(renewContract, {
    success: (n) => `Renovação ${n.code} criada em rascunho.`,
    onSuccess: (n) => {
      onClose()
      // A renovação aparece escolhida na mesma tela (Contratos e pessoas), no lugar do contrato de origem.
      void navigate({ to: '/contratos', search: { contrato: n.id }, replace: true, resetScroll: false })
    },
  })
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Renovar ${k.code}?`}
      confirmLabel="Criar renovação"
      loading={save.isPending}
      onConfirm={() => save.mutate({ id: k.id })}
      message={
        <div className="flex flex-col gap-2">
          <p>
            Cria um contrato novo em rascunho, de <strong>{formatDate(start)}</strong> a <strong>{formatDate(end)}</strong>, com o aluguel atual ({formatBRL(k.rent_cents)}), as mesmas partes e a
            mesma garantia.
          </p>
          <p className="text-muted">Ele passa por revisão e aprovação como qualquer contrato. {contractName(k)} segue vigente até {formatDate(k.end_date)}.</p>
        </div>
      }
    />
  )
}
