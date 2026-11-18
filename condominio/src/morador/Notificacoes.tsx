/* =============================================================================
   Aba Notificações do morador: avisos do condomínio (o fixado em cima), as últimas respostas da
   equipe aos pedidos dele e as perguntas frequentes (abrem com um toque).
   O síndico escreve tudo isso em Notícias > Avisos do app, e a prévia de lá usa ESTE componente:
   o que ele vê na prévia é exatamente o que o morador vê.
   ============================================================================= */
import { Pin } from 'lucide-react'
import { momento } from '../regras'
import type { Aviso } from '../tipos'

export interface Resposta {
  chave: string
  titulo: string // ex.: 'Lavagem e secagem nº 1012'
  nota: string
  por: string // cargo de quem respondeu
  em: string
}

export function Notificacoes({ avisos, respostas = [] }: { avisos: Aviso[]; respostas?: Resposta[] }) {
  const lista = avisos.filter((a) => a.tipo === 'aviso')
  const faq = avisos.filter((a) => a.tipo === 'faq')
  return (
    <div className="m-notif">
      <section aria-labelledby="titulo-avisos">
        <h2 id="titulo-avisos" className="m-secao">
          Avisos do condomínio
        </h2>
        {lista.length ? (
          <ul className="m-lista">
            {lista.map((a) => (
              <li key={a.id} className={`cartao m-aviso${a.fixado ? ' fixado' : ''}`}>
                <div className="m-aviso-cab">
                  <strong>{a.titulo}</strong>
                  {a.fixado ? (
                    <span className="apagado peq m-fixado">
                      <Pin size={14} strokeWidth={1.5} aria-hidden="true" /> fixado
                    </span>
                  ) : null}
                </div>
                <p className="m-aviso-texto">{a.texto}</p>
                <span className="apagado peq num">{momento(a.atualizado_em)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vazio">Nenhum aviso agora.</p>
        )}
      </section>

      {respostas.length ? (
        <section aria-labelledby="titulo-respostas">
          <h2 id="titulo-respostas" className="m-secao">
            Respostas da administração
          </h2>
          <ul className="m-lista">
            {respostas.map((r) => (
              <li key={r.chave} className="cartao m-aviso">
                <span className="peq">
                  <strong>{r.titulo}</strong> <span className="apagado">· {r.por.toLowerCase()} · {momento(r.em)}</span>
                </span>
                <p className="nota peq">{r.nota}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {faq.length ? (
        <section aria-labelledby="titulo-faq">
          <h2 id="titulo-faq" className="m-secao">
            Perguntas frequentes
          </h2>
          <div className="m-faq cartao">
            {faq.map((a) => (
              <details key={a.id}>
                <summary>{a.titulo}</summary>
                <p>{a.texto}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
