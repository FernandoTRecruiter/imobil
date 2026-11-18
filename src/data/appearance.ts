/* =============================================================================
   appearance.ts: a aparência que cada organização configura (Configurações > Empresa e
   Situações e cores) valendo no app inteiro, para todas as pessoas, inclusive no portal.

   Como funciona, em 3 peças:
   1. CORES: todas as telas pintam situação com var(--st-...) e a marca com var(--primary).
      Aqui uma <style> troca essas variáveis só no tema CLARO (o escuro tem cores próprias,
      pensadas para fundo escuro). As variações derivam da base (ver styles.css).
   2. MARCA: a cor da imobiliária só entra se o texto branco em cima dela tiver contraste de pelo
      menos 4,5:1; senão fica o azul padrão (botão ilegível é pior que botão de outra cor).
   3. RÓTULOS: "Disponível" pode virar "Livre" etc.

   atalho: os rótulos são trocados DENTRO do objeto UNIT_STATUS (labels.ts) que as telas leem;
   simples, mas só aparece no próximo desenho da tela. Por isso aplicamos na abertura do app,
   na troca de persona e ao salvar a configuração. Na fase 2 (Supabase, leitura assíncrona) isto
   vira um provedor React com carregamento.
   ============================================================================= */
import { UNIT_STATUS } from './labels'
import type { Db } from './db'
import type { Id, UnitStatus } from './types'

const DEFAULT_LABEL: Record<UnitStatus, string> = { ...UNIT_STATUS }
const DEFAULT_COLOR: Record<UnitStatus, string> = { available: '#15803d', occupied: '#2b59c3', reserved: '#b45309', maintenance: '#c2410c', blocked: '#64748b' }
const DEFAULT_BRAND = '#2b59c3'
const STYLE_ID = 'imobil-aparencia'

/** Luminância relativa (fórmula da WCAG) de uma cor #rrggbb. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05)
}

const isHex = (c: string | null | undefined): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c)

/** Monta o CSS das trocas (vazio quando a organização usa tudo padrão). Separado para dar para testar. */
export function appearanceCss(db: Db, orgId: Id): { css: string; labels: Record<UnitStatus, string> } {
  const org = db.organizations.find((o) => o.id === orgId)
  const vars: string[] = []
  if (isHex(org?.brand_color) && org!.brand_color.toLowerCase() !== DEFAULT_BRAND && contrastWithWhite(org!.brand_color) >= 4.5) {
    vars.push(`--primary: ${org!.brand_color};`)
  }
  const labels = { ...DEFAULT_LABEL }
  for (const cfg of db.unit_status_config.filter((c) => c.organization_id === orgId)) {
    if (cfg.label?.trim()) labels[cfg.status] = cfg.label.trim()
    if (isHex(cfg.color) && cfg.color.toLowerCase() !== DEFAULT_COLOR[cfg.status]) vars.push(`--st-${cfg.status}: ${cfg.color};`)
  }
  return { css: vars.length ? `:root:not([data-theme='dark']) { ${vars.join(' ')} }` : '', labels }
}

/** Aplica no documento a aparência da organização (chamar na abertura, na troca de persona e ao salvar). */
export function applyAppearance(db: Db, orgId: Id): void {
  const { css, labels } = appearanceCss(db, orgId)
  Object.assign(UNIT_STATUS, labels) // ver o "atalho" no cabeçalho
  if (typeof document === 'undefined') return
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    document.head.appendChild(tag)
  }
  tag.textContent = css
}
