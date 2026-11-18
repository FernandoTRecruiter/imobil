import { initials } from '@/lib/text'
import { cn } from './cn'

/**
 * Iniciais num círculo. Com "photo" (opcional: zelador, porteiro, síndico...), mostra a foto
 * redonda no mesmo tamanho, no lugar das iniciais. A foto é enfeite do nome que vem ao lado,
 * por isso fica escondida do leitor de tela (alt vazio + aria-hidden), igual às iniciais.
 */
export function Avatar({ name, color = 'var(--primary)', size = 'md', photo }: { name: string; color?: string; size?: 'sm' | 'md'; photo?: string | null }) {
  if (photo) {
    return <img src={photo} alt="" aria-hidden="true" className={cn('shrink-0 rounded-full object-cover', size === 'sm' ? 'size-7' : 'size-9')} />
  }
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold text-white', size === 'sm' ? 'size-7 text-[11px]' : 'size-9 text-xs')}
      style={{ background: color }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}
