// A aparência configurada pela organização (marca, cores e rótulos de situação).
import { describe, expect, it } from 'vitest'
import { appearanceCss, contrastWithWhite } from './appearance'
import { ORG } from './seed'
import { resetForTest } from './store'

describe('aparência da organização', () => {
  it('com tudo padrão não gera CSS nenhum (os temas seguem como desenhados)', () => {
    const db = resetForTest('2026-11-04')
    expect(appearanceCss(db, ORG.agency).css).toBe('')
  })

  it('cor de situação personalizada vale só no tema claro, e o rótulo troca', () => {
    const db = resetForTest('2026-11-04')
    const cfg = db.unit_status_config.find((c) => c.organization_id === ORG.agency && c.status === 'available')!
    cfg.color = '#0f766e'
    cfg.label = 'Livre'
    const { css, labels } = appearanceCss(db, ORG.agency)
    expect(css).toContain(":root:not([data-theme='dark'])")
    expect(css).toContain('--st-available: #0f766e;')
    expect(labels.available).toBe('Livre')
    // A outra organização não é afetada.
    expect(appearanceCss(db, ORG.landlord).css).toBe('')
  })

  it('marca clara demais para texto branco é ignorada (botão ilegível é pior)', () => {
    const db = resetForTest('2026-11-04')
    const org = db.organizations.find((o) => o.id === ORG.agency)!
    org.brand_color = '#fde047' // amarelo: contraste com branco ~1,3:1
    expect(contrastWithWhite('#fde047')).toBeLessThan(4.5)
    expect(appearanceCss(db, ORG.agency).css).toBe('')
    org.brand_color = '#7c3aed' // violeta escuro: passa
    expect(appearanceCss(db, ORG.agency).css).toContain('--primary: #7c3aed;')
  })
})
