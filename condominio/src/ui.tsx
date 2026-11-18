/* =============================================================================
   Peças de tela usadas pelo morador e pela equipe. Cada uma resolve um detalhe que, se cada tela
   fizesse do seu jeito, sairia diferente (plaqueta do apto, selo da situação, janela, tabela).
   ============================================================================= */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Info as InfoIcon, X } from 'lucide-react'
import type { Servico } from './config'
import { rotuloStatus, statusEfetivo, tomStatus, bate } from './regras'
import type { Solicitacao } from './tipos'

/* ------------------------------------------------------------------ lembrar escolhas */

/** Estado lembrado no navegador. Se o navegador não deixar gravar, funciona igual, só não lembra. */
export function useLembrar<T>(chave: string, inicial: T): [T, (v: T) => void] {
  const [valor, setValor] = useState<T>(() => {
    try {
      const bruto = localStorage.getItem(chave)
      return bruto ? (JSON.parse(bruto) as T) : inicial
    } catch {
      return inicial
    }
  })
  const mudar = useCallback(
    (v: T) => {
      setValor(v)
      try {
        localStorage.setItem(chave, JSON.stringify(v))
      } catch {
        /* sem localStorage: só não lembra */
      }
    },
    [chave],
  )
  return [valor, mudar]
}

/* ------------------------------------------------------------------ peças pequenas */

/** A marca do app: a plaqueta do apartamento (a assinatura) com a letra, igual ao ícone da aba. */
export function Marca() {
  return (
    <svg className="marca" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="4" y="12" width="56" height="40" rx="8" />
      <path d="M24 44V22h16v22M29 28h6M29 34h6M29 40h6" strokeWidth={4} />
    </svg>
  )
}

/** A plaqueta do apartamento. Denúncia anônima mostra "anônima" no mesmo formato. */
export function Apto({ apto }: { apto: string | null }) {
  if (!apto) return <span className="apto anonima">anônima</span>
  return (
    <span className="apto">
      <small>AP</small>
      {apto}
    </span>
  )
}

export function Ponto({ servico }: { servico: Servico }) {
  return <span className={`ponto ${servico}`} aria-hidden="true" />
}

/** Selo da situação, com a regra "reserva cujo horário passou = concluída". */
export function Selo({ s, agora }: { s: Pick<Solicitacao, 'servico' | 'status' | 'fim'>; agora: string }) {
  const st = statusEfetivo(s, agora)
  return <span className={`selo ${tomStatus(st)}`}>{rotuloStatus(s.servico, st)}</span>
}

export function Pendente() {
  return <span className="pend">Pagamento pendente</span>
}

/** "i" com a explicação no balão (no lugar de parágrafo de aviso). */
export function Info({ texto }: { texto: string }) {
  return (
    <button type="button" className="info" aria-label={texto}>
      <InfoIcon size={16} strokeWidth={1.5} aria-hidden="true" />
      <span className="balao" aria-hidden="true">
        {texto}
      </span>
    </button>
  )
}

/** Campo com rótulo visível e erro embaixo, ligado por aria-describedby. */
export function Campo({ rotulo, erro, dica, children }: { rotulo: string; erro?: string | null; dica?: string; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode }) {
  const id = useId()
  const desc = erro ? `${id}-erro` : dica ? `${id}-dica` : undefined
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      {children({ id, 'aria-describedby': desc, 'aria-invalid': erro ? true : undefined })}
      {erro ? (
        <span className="erro" id={`${id}-erro`}>
          {erro}
        </span>
      ) : dica ? (
        <span className="dica" id={`${id}-dica`}>
          {dica}
        </span>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ aviso rápido */

export interface AvisoMsg {
  texto: string
  erro?: boolean
}

/** Aviso que some sozinho em 4 s (lido pelo leitor de tela). */
export function useAviso(): [ReactNode, (texto: string, erro?: boolean) => void] {
  const [msg, setMsg] = useState<AvisoMsg | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 4000)
    return () => clearTimeout(t)
  }, [msg])
  const no = (
    <div role="status" aria-live="polite">
      {msg ? <div key={msg.texto} className={`aviso${msg.erro ? ' erro' : ''}`}>{msg.texto}</div> : null}
    </div>
  )
  return [no, (texto, erro) => setMsg({ texto, erro })]
}

/* ------------------------------------------------------------------ janela */

/**
 * Janela por cima da tela (<dialog> do navegador: fecha no Esc, prende o foco e devolve o foco
 * a quem abriu). "aberta" controla; "fechar" é chamado no ✕, no Esc e no clique fora.
 */
export function Janela({ aberta, titulo, fechar, children, pe }: { aberta: boolean; titulo: string; fechar: () => void; children: ReactNode; pe?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (aberta && !d.open) {
      d.showModal()
      // O navegador põe o foco no primeiro botão (o ✕); o campo marcado com data-foco é melhor.
      d.querySelector<HTMLElement>('[data-foco]')?.focus()
    }
    if (!aberta && d.open) d.close()
  }, [aberta])
  return (
    <dialog
      ref={ref}
      className="janela"
      aria-label={titulo}
      onCancel={(e) => {
        e.preventDefault()
        fechar()
      }}
      onClick={(e) => {
        if (e.target === ref.current) fechar()
      }}
    >
      {aberta ? (
        <>
          <div className="janela-topo">
            <h2>{titulo}</h2>
            <button type="button" className="btn quieto icone" aria-label="Fechar" onClick={fechar}>
              <X size={18} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          <div className="janela-corpo">{children}</div>
          {pe ? <div className="janela-pe">{pe}</div> : null}
        </>
      ) : null}
    </dialog>
  )
}

/* ------------------------------------------------------------------ tabela que ordena pelo cabeçalho */

export interface Coluna<T> {
  chave: string
  rotulo: string
  /** Valor usado para ordenar e para exportar. */
  valor: (l: T) => string | number
  /** Como aparece na tela (sem isso, mostra o valor). */
  mostrar?: (l: T) => ReactNode
  /** Números e datas: 1º clique = maior/mais novo primeiro. Texto: A→Z. */
  numerico?: boolean
  dir?: boolean
}

export type Ordem = { chave: string; sobe: boolean } | null

/** Clique no cabeçalho: 1º ordena (número/data: maior primeiro; texto: A→Z), 2º inverte, 3º volta à ordem declarada. */
export function proximaOrdem(atual: Ordem, chave: string, numerico: boolean): Ordem {
  const primeiroSobe = !numerico
  if (!atual || atual.chave !== chave) return { chave, sobe: primeiroSobe }
  if (atual.sobe === primeiroSobe) return { chave, sobe: !primeiroSobe }
  return null
}

/**
 * Tabela com ordenação pelo cabeçalho: 1º clique ordena (maior ou mais novo primeiro; texto A→Z),
 * 2º inverte, 3º volta à ordem declarada. Clicar na linha chama "escolher".
 */
export function Tabela<T>({ colunas, linhas, chaveLinha, escolhida, escolher, legenda }: { colunas: Coluna<T>[]; linhas: T[]; chaveLinha: (l: T) => string; escolhida?: string | null; escolher?: (l: T) => void; legenda: string }) {
  const [ordem, setOrdem] = useState<Ordem>(null)
  const ordenadas = useMemo(() => {
    if (!ordem) return linhas
    const col = colunas.find((c) => c.chave === ordem.chave)
    if (!col) return linhas
    return [...linhas].sort((a, b) => {
      const va = col.valor(a)
      const vb = col.valor(b)
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true })
      return ordem.sobe ? r : -r
    })
  }, [linhas, colunas, ordem])

  const clicar = (c: Coluna<T>) => setOrdem(proximaOrdem(ordem, c.chave, !!c.numerico))

  return (
    <div className="moldura-tabela">
      <table className="tabela">
        <caption className="sr">{legenda}</caption>
        <thead>
          <tr>
            {colunas.map((c) => {
              const ativa = ordem?.chave === c.chave
              return (
                <th key={c.chave} aria-sort={ativa ? (ordem!.sobe ? 'ascending' : 'descending') : 'none'} className={c.dir ? 'dir' : undefined}>
                  <button type="button" onClick={() => clicar(c)} style={c.dir ? { justifyContent: 'flex-end' } : undefined}>
                    {c.rotulo}
                    {ativa ? ordem!.sobe ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" /> : null}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((l) => (
            <tr
              key={chaveLinha(l)}
              aria-selected={escolhida === chaveLinha(l)}
              tabIndex={escolher ? 0 : undefined}
              onClick={escolher ? () => escolher(l) : undefined}
              onKeyDown={
                escolher
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        escolher(l)
                      }
                    }
                  : undefined
              }
            >
              {colunas.map((c) => (
                <td key={c.chave} className={c.dir ? 'dir' : undefined}>
                  {c.mostrar ? c.mostrar(l) : c.valor(l)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ exportar */

/** Baixa um CSV que o Excel abre direto (separador ; e BOM para acento). */
export function baixarCsv(nome: string, cabecalho: string[], linhas: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const texto = [cabecalho, ...linhas].map((l) => l.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ------------------------------------------------------------------ busca */

/** Campo de busca com o contador "N de M" anunciado. */
export function Busca({ valor, mudar, achados, total, rotulo = 'Buscar' }: { valor: string; mudar: (v: string) => void; achados: number; total: number; rotulo?: string }) {
  return (
    <div className="busca">
      <input className="entrada" type="search" placeholder={rotulo} aria-label={rotulo} value={valor} onChange={(e) => mudar(e.target.value)} />
      <span className="apagado peq num" aria-live="polite">
        {valor.trim() ? `${achados} de ${total}` : ''}
      </span>
    </div>
  )
}

export { bate }

/* ------------------------------------------------------------------ comparação por categoria */

/** Linha com a barra pintada atrás do rótulo, depois o número (o padrão da casa para comparar categorias). */
export function BarList({ itens, max = 6, vazio = 'Sem dados ainda.' }: { itens: { rotulo: string; n: number }[]; max?: number; vazio?: string }) {
  const lista = itens.slice(0, max)
  const maior = Math.max(1, ...lista.map((i) => i.n))
  if (!lista.length) return <p className="apagado peq">{vazio}</p>
  return (
    <ul className="barlist">
      {lista.map((i, k) => (
        <li key={i.rotulo}>
          <span className={`barlist-barra${k === 0 ? ' lider' : ''}`} style={{ width: `${(i.n / maior) * 100}%` }} aria-hidden="true" />
          <span className="barlist-rotulo">{i.rotulo}</span>
          <span className="num">{i.n}</span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ sub-abas */

/** Abas pequenas dentro de uma página (só trocam com o clique; setas também funcionam). */
export function Abas<T extends string>({ valor, mudar, opcoes, rotulo }: { valor: T; mudar: (v: T) => void; opcoes: { valor: T; rotulo: string }[]; rotulo: string }) {
  return (
    <div className="abas" role="tablist" aria-label={rotulo}>
      {opcoes.map((o, i) => (
        <button
          key={o.valor}
          type="button"
          role="tab"
          aria-selected={valor === o.valor}
          tabIndex={valor === o.valor ? 0 : -1}
          onClick={() => mudar(o.valor)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              const prox = opcoes[(i + (e.key === 'ArrowRight' ? 1 : opcoes.length - 1)) % opcoes.length]
              mudar(prox.valor)
            }
          }}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  )
}
