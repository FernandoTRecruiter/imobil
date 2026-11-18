/* =============================================================================
   Som de confirmação: duas notas curtas e baixas, geradas pelo próprio navegador (sem arquivo).
   Por que em duas partes:
     - prepararSom() roda NO TOQUE do botão, antes de esperar o servidor. O iPhone só deixa tocar
       som que foi "liberado" por um toque; se a liberação viesse depois da resposta, ele calaria.
     - tocarConfirmacao() roda quando o servidor confirma.
   A pessoa pode desligar o som (ícone no topo); a escolha fica lembrada neste aparelho.
   ============================================================================= */

const CHAVE = 'condominio:som'
let contexto: AudioContext | null = null

export function somLigado(): boolean {
  try {
    return localStorage.getItem(CHAVE) !== 'desligado'
  } catch {
    return true
  }
}

export function ligarSom(ligado: boolean) {
  try {
    localStorage.setItem(CHAVE, ligado ? 'ligado' : 'desligado')
  } catch {
    /* sem localStorage: vale só até fechar */
  }
}

/** Chamar dentro do toque (antes de qualquer await). */
export function prepararSom() {
  if (!somLigado()) return
  try {
    contexto ??= new AudioContext()
    if (contexto.state === 'suspended') void contexto.resume()
  } catch {
    contexto = null // navegador sem áudio: segue sem som
  }
}

/** Duas notas subindo (lá e mi), cada uma com ataque e queda suaves, e uma vibração curta. */
export function tocarConfirmacao() {
  try {
    navigator.vibrate?.(25)
  } catch {
    /* sem vibração */
  }
  if (!somLigado() || !contexto) return
  const ctx = contexto
  const t0 = ctx.currentTime
  for (const [freq, atraso] of [
    [880, 0],
    [1318.5, 0.11],
  ]) {
    const osc = ctx.createOscillator()
    const vol = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    vol.gain.setValueAtTime(0.0001, t0 + atraso)
    vol.gain.exponentialRampToValueAtTime(0.12, t0 + atraso + 0.02)
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + atraso + 0.35)
    osc.connect(vol).connect(ctx.destination)
    osc.start(t0 + atraso)
    osc.stop(t0 + atraso + 0.4)
  }
}
