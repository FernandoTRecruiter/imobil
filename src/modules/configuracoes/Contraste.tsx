/* Linha de contraste do texto branco sobre uma cor (cor da marca e cor de situação).
   Arquivo próprio para a aba de Situações e a de Empresa usarem sem uma importar a outra. */
import { cn } from '@/components/ui/cn'
import { contrastRatio } from './repo'

export function ContrastNote({ color, min }: { color: string; min: number }) {
  const ratio = contrastRatio(color)
  const low = ratio < min
  return (
    <p className={cn('text-xs', low ? 'font-medium text-warning-fg' : 'text-muted')} role={low ? 'status' : undefined}>
      Contraste do texto branco: {ratio.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}:1
      {low ? ` (abaixo de ${min}:1: o texto fica difícil de ler; escolha uma cor mais escura).` : ' (legível).'}
    </p>
  )
}
