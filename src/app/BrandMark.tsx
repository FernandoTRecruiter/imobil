/* A marca do Imobil: um bloco de maquete em isométrico (o mesmo desenho do mapa).
   Desenhada aqui em SVG, e não lida de um arquivo: assim ela existe igual no servidor e no Imobil.html
   aberto do disco, sem nada para buscar. Cores pelos tokens, então acompanha a marca da imobiliária. */
export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink, #1f2937)" />
      <path d="M16 6 26 11.5 16 17 6 11.5Z" fill="#ffffff" />
      <path d="M6 11.5 16 17v9L6 20.5Z" fill="color-mix(in srgb, #ffffff 72%, var(--primary))" />
      <path d="M26 11.5 16 17v9l10-5.5Z" fill="var(--primary)" />
    </svg>
  )
}
