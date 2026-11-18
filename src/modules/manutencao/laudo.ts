/* =============================================================================
   laudo.ts: o laudo da vistoria como PÁGINA DE IMPRESSÃO, sem biblioteca de PDF.

   Como funciona: monta o HTML do laudo como texto, abre uma janela nova, escreve o HTML nela
   e chama window.print(). Na janela de impressão a pessoa escolhe a impressora ou "Salvar
   como PDF". Por que janela nova e não a própria tela: a tela do app tem menu, barra de cima
   e faixa de demonstração, que sairiam no papel.

   SEGURANÇA: observação de item é texto digitado. Todo texto passa por escapeHtml antes de
   entrar no HTML; sem isso, uma observação com "<script>" rodaria na janela do laudo.
   ============================================================================= */
import { CONDITION } from '@/data/labels'
import type { Condition, InspectionRoom } from '@/data/types'
import { formatDate } from '@/lib/dates'
import { INSPECTION_STATUS, KIND_PHRASE, type InspectionDetail, type WorseItem } from './vistorias'

/** Troca os 5 caracteres que o HTML entende como código pelos equivalentes "só texto". */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const COLOR: Record<Condition, string> = { good: '#14532d', fair: '#78350f', poor: '#7f1d1d', na: '#334155' }

function cond(c: Condition): string {
  return `<span class="c" style="color:${COLOR[c]}">${CONDITION[c]}</span>`
}

function roomTable(r: InspectionRoom): string {
  const rows = r.items.map((it) => `<tr><td>${escapeHtml(it.name)}</td><td>${cond(it.condition)}</td><td>${escapeHtml(it.note) || '&nbsp;'}</td></tr>`).join('')
  return `<section class="room"><h3>${escapeHtml(r.name)}</h3><table><thead><tr><th style="width:38%">Item</th><th style="width:16%">Estado</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table></section>`
}

function worseTable(worse: WorseItem[]): string {
  if (!worse.length) return '<p>Nenhum item piorou em relação à vistoria de entrada.</p>'
  const rows = worse.map((w) => `<tr><td>${escapeHtml(w.room)}</td><td>${escapeHtml(w.item)}</td><td>${cond(w.from)}</td><td>${cond(w.to)}</td><td>${escapeHtml(w.note) || '&nbsp;'}</td></tr>`).join('')
  return `<table><thead><tr><th>Cômodo</th><th>Item</th><th>Entrada</th><th>Saída</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table>`
}

/**
 * O HTML completo do laudo. Recebe tudo pronto (inclusive "gerado em"), para ser uma função
 * pura: o mesmo dado gera sempre o mesmo laudo, e dá para testar sem navegador.
 */
export function reportHtml(d: InspectionDetail, orgName: string, generatedAt: string): string {
  const i = d.inspection
  const items = i.rooms.flatMap((r) => r.items)
  const checked = items.filter((x) => x.condition !== 'na').length
  const poor = items.filter((x) => x.condition === 'poor').length
  const title = `Laudo de vistoria ${KIND_PHRASE[i.kind]} · ${i.unit_code}`
  const draft = i.status !== 'done' ? `<p class="draft">Rascunho: a vistoria está "${INSPECTION_STATUS[i.status]}". O laudo vale depois de concluída.</p>` : ''
  const comparison =
    i.kind === 'move_out'
      ? `<section><h2>Comparação com a entrada</h2>${d.baseline ? `<p class="muted">Vistoria de entrada de ${formatDate(d.baseline.inspection.done_date)}: itens que pioraram.</p>${worseTable(d.baseline.worse)}` : '<p>Não há vistoria de entrada concluída desta unidade para comparar.</p>'}</section>`
      : ''
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #0f172a; font-size: 12px; line-height: 1.45; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 18px 0 6px; } h3 { font-size: 13px; margin: 12px 0 4px; }
  .muted { color: #5b6577; } .draft { border: 1px solid #b45309; color: #78350f; padding: 6px 10px; border-radius: 6px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; margin: 10px 0; } dt { color: #5b6577; } dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #cbd3df; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f4f6fa; font-weight: 600; } .c { font-weight: 600; } .room { break-inside: avoid; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 40px; } .sign div { border-top: 1px solid #0f172a; padding-top: 4px; text-align: center; }
  .bar { display: flex; justify-content: flex-end; margin-bottom: 12px; } .bar button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #cbd3df; background: #fff; cursor: pointer; }
  @media print { .bar { display: none; } body { padding: 0; } }
</style></head>
<body>
<div class="bar"><button type="button" onclick="window.print()">Imprimir ou salvar em PDF</button></div>
<p class="muted">${escapeHtml(orgName)}</p>
<h1>${escapeHtml(title)}</h1>
${draft}
<dl>
  <dt>Unidade</dt><dd>${escapeHtml(i.unit_label)}</dd>
  <dt>Endereço</dt><dd>${escapeHtml(d.address)}</dd>
  <dt>Contrato</dt><dd>${escapeHtml(i.contract_code ?? 'Sem contrato')}</dd>
  <dt>Agendada para</dt><dd>${formatDate(i.scheduled_date)}</dd>
  <dt>Feita em</dt><dd>${i.done_date ? formatDate(i.done_date) : 'Ainda não feita'}</dd>
  <dt>Vistoriador</dt><dd>${escapeHtml(i.inspector_name ?? 'A definir')}</dd>
  <dt>Itens avaliados</dt><dd>${checked} de ${items.length}${poor ? `, ${poor} em estado ruim` : ''}</dd>
</dl>
${comparison}
<h2>Checklist por cômodo</h2>
${i.rooms.map(roomTable).join('')}
<div class="sign"><div>Vistoriador</div><div>Locatário</div><div>Locador ou administradora</div></div>
<p class="muted" style="margin-top:24px">Gerado em ${escapeHtml(generatedAt)} pelo Imobil. Ambiente de demonstração: nomes e dados fictícios.</p>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print() }, 300) })</script>
</body></html>`
}

/** Abre o laudo numa janela nova e pede a impressão. Devolve false se o navegador bloqueou a janela. */
export function openReport(html: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  return true
}
