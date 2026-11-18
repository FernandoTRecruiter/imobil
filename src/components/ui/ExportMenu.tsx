/* =============================================================================
   ExportMenu: o botão "Exportar" único do app (07/11/2026). Abre um menu com as duas saídas
   (planilha .xlsx e CSV); quem chama recebe o formato e baixa o arquivo (lib/exportar.ts).

   Por que um menu e não dois botões: antes cada tela tinha "CSV", "Exportar CSV", "XLSX",
   "Baixar planilha (CSV)"... A pessoa procurava o nome certo em cada tela. Agora o nome é
   sempre "Exportar", no mesmo lugar (fim da barra da lista), e a escolha do formato é dentro.

   No celular o texto some e fica o ícone (o nome continua para o leitor de tela). Enquanto o
   arquivo é montado, o botão mostra "Gerando…" e não aceita outro clique. Erro vira aviso com
   a causa, sem quebrar a tela.
   ============================================================================= */
import { useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react'
import { EXPORT_FORMATS, type ExportFormat } from '@/lib/exportar'
import { Button } from './Button'
import { useToast } from './Toast'
import { cn } from './cn'

export function ExportMenu({
  onExport,
  total,
  size = 'md',
  label = 'Exportar',
  disabled,
  className,
}: {
  onExport: (format: ExportFormat) => Promise<void> | void
  /** Quantas linhas vão para o arquivo (entra na dica e no nome para o leitor de tela). */
  total?: number
  size?: 'sm' | 'md'
  label?: string
  disabled?: boolean
  className?: string
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const many = total !== undefined ? ` ${total.toLocaleString('pt-BR')} ${total === 1 ? 'linha' : 'linhas'}` : ''
  const run = async (format: ExportFormat) => {
    setBusy(true)
    try {
      await onExport(format)
    } catch (e) {
      toast.error(e instanceof Error ? `Não deu para gerar o arquivo: ${e.message}` : 'Não deu para gerar o arquivo. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }
  const item = 'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 outline-none data-[highlighted]:bg-surface-2'
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled || busy}>
        <Button
          size={size}
          className={cn('max-sm:px-2.5', className)}
          loading={busy}
          loadingText="Gerando…"
          icon={<Download className="size-4" strokeWidth={1.5} aria-hidden="true" />}
          title={total !== undefined ? `Exportar as${many} da lista (com a busca e os filtros)` : 'Exportar'}
        >
          {/* O texto fica para o leitor de tela no celular (o ícone basta para quem vê). */}
          <span className="max-sm:sr-only">{label}</span>
          <ChevronDown className="size-3.5 opacity-60 max-sm:hidden" aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={16} className="z-50 w-64 origin-[var(--radix-dropdown-menu-content-transform-origin)] animate-pop-in rounded-xl border border-border bg-surface p-1 text-sm shadow-pop">
          <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-xs text-muted">
            {total !== undefined ? `Baixar${many}, com as colunas à vista` : 'Baixar como'}
          </DropdownMenu.Label>
          {EXPORT_FORMATS.map((f) => (
            <DropdownMenu.Item key={f.value} className={item} onSelect={() => void run(f.value)}>
              {f.value === 'xlsx' ? <FileSpreadsheet className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" /> : <FileText className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />}
              <span className="flex min-w-0 flex-col">
                <span className={cn(f.value === 'xlsx' && 'font-medium')}>{f.label}</span>
                <span className="text-xs text-muted">{f.hint}</span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
