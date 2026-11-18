/* =============================================================================
   Morador: fazer uma solicitação e acompanhar as que já fez.
   - Solicitar: 1) escolher o serviço; 2) o formulário daquele serviço. Lavagem e diária mostram os
     dias e horários livres (o que está ocupado aparece, sem dono). Estacionamento e denúncia são
     formulários curtos.
   - Acompanhar: cada solicitação com a situação; tocar abre o histórico com as respostas da equipe
     (é assim que a denúncia fica transparente para quem denunciou) e o botão de cancelar.
   ============================================================================= */
import { useEffect, useRef, useState } from 'react'
import { Brush, Car, ChevronDown, ChevronLeft, MessageSquareWarning, WashingMachine } from 'lucide-react'
import type { Servico, ServicoDef } from '../config'
import { api } from '../dados/api'
import {
  agoraLocal,
  descreverQuando,
  diaCurto,
  diaDe,
  diasReservaveis,
  momento,
  mensagem,
  moradorCancela,
  nomeServico,
  pagamentoPendente,
  periodosDoDia,
  placaValida,
  rotuloStatus,
  segundaDa,
  somaDias,
} from '../regras'
import type { Credencial, DiaEspecial, Ocupado, Solicitacao } from '../tipos'
import { Campo, Info, Pendente, Ponto, Selo } from '../ui'
import type { Preselecao } from './Morador'
import { prepararSom, tocarConfirmacao } from '../som'

const ICONES: Record<Servico, typeof Car> = { lavagem: WashingMachine, diaria: Brush, estacionamento: Car, denuncia: MessageSquareWarning }
export const RESUMO: Record<Servico, string> = {
  lavagem: 'Um horário na lavanderia',
  diaria: 'Manhã ou tarde com a diarista',
  estacionamento: 'Vaga para visitante',
  denuncia: 'Anônima, se você preferir',
}

/** O que a tela de "pronto" mostra depois de enviar. */
export interface Conclusao {
  servico: Servico
  titulo: string
  /** Texto de acolhimento (a denúncia tem um próprio). */
  mensagem?: string[]
  linhas: string[]
  protocolo: number
}
type Fim = (c: Conclusao, token?: string | null) => Promise<void>

/* ------------------------------------------------------------------ escolher e preencher */

export function Solicitar({ abaixo, cred, servicos, minhas, ocupacao, especiais, presel, limparPresel, enviado, recarregarOcupacao, irInicio }: {
  /** O que aparece embaixo da escolha do serviço (a lista Acompanhar); some enquanto preenche. */
  abaixo: React.ReactNode
  cred: Credencial
  servicos: ServicoDef[]
  minhas: Solicitacao[]
  ocupacao: Ocupado[]
  especiais: DiaEspecial[]
  presel: Preselecao
  limparPresel: () => void
  /** Depois de gravar: guarda o token da denúncia anônima e recarrega os dados. */
  enviado: (token?: string | null) => Promise<void>
  recarregarOcupacao: () => Promise<void>
  /** "Voltar ao início" da tela de pronto. */
  irInicio: () => void
}) {
  const [servico, setServico] = useState<Servico | null>(presel?.servico ?? null)
  const [concluido, setConcluido] = useState<Conclusao | null>(null)
  useEffect(() => {
    if (presel) setServico(presel.servico)
  }, [presel])

  function voltar() {
    setServico(null)
    limparPresel()
  }
  const def = servicos.find((s) => s.chave === servico)

  if (concluido) {
    return (
      <Pronto
        c={concluido}
        inicio={() => {
          setConcluido(null)
          irInicio()
        }}
        acompanhar={() => {
          setConcluido(null)
          requestAnimationFrame(() => document.getElementById('titulo-acompanhar')?.scrollIntoView({ block: 'start' }))
        }}
      />
    )
  }

  if (!def) {
    return (
      <section aria-labelledby="titulo-solicitar" className="anima-entra">
        <h2 id="titulo-solicitar" className="m-secao">O que você precisa?</h2>
        <div className="m-servicos">
          {servicos.map((s) => {
            const Icone = ICONES[s.chave]
            return (
              <button key={s.chave} type="button" className="m-servico cartao" onClick={() => setServico(s.chave)}>
                <Icone size={20} strokeWidth={1.5} aria-hidden="true" />
                <span>
                  <strong>{s.nome}</strong>
                  <span className="sec peq">{RESUMO[s.chave]}</span>
                </span>
              </button>
            )
          })}
        </div>
        {abaixo}
      </section>
    )
  }

  const fim: Fim = async (c, token) => {
    voltar()
    setConcluido(c)
    window.scrollTo({ top: 0 })
    await enviado(token)
  }

  return (
    <section className="cartao m-form anima-entra" aria-labelledby="titulo-form" key={def.chave}>
      <div className="m-form-topo">
        <button type="button" className="btn quieto icone" aria-label="Voltar" onClick={voltar}>
          <ChevronLeft size={18} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <h2 id="titulo-form">{def.nome}</h2>
      </div>
      {def.config.tipo === 'horario' || def.config.tipo === 'periodo' ? (
        <FormReserva cred={cred} def={def} minhas={minhas} ocupacao={ocupacao} especiais={especiais} inicial={presel?.inicio ?? null} fim={fim} recarregar={recarregarOcupacao} />
      ) : def.config.tipo === 'pedido' ? (
        <FormEstacionamento cred={cred} maxDias={def.config.max_dias} fim={fim} />
      ) : (
        <FormDenuncia cred={cred} categorias={def.config.categorias} fim={fim} />
      )}
    </section>
  )
}

/* Lavagem e diária: dia, horário, observação. */
function FormReserva({ cred, def, minhas, ocupacao, especiais, inicial, fim, recarregar }: {
  cred: Credencial
  def: ServicoDef
  minhas: Solicitacao[]
  ocupacao: Ocupado[]
  especiais: DiaEspecial[]
  inicial: string | null
  fim: Fim
  recarregar: () => Promise<void>
}) {
  const agora = agoraLocal()
  const dias = diasReservaveis(def.config, diaDe(agora), especiais)
  const [dia, setDia] = useState(inicial ? diaDe(inicial) : (dias.find((d) => periodosDoDia(def.config, d, especiais).some((h) => h.inicio > agora)) ?? dias[0]))
  const [inicio, setInicio] = useState<string | null>(inicial)
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // A ocupação na tela é do mês do calendário; ao escolher um dia, ela pode não cobrir. Ocupação
  // própria da semana do dia escolhido para o aviso do limite:
  const [ocupDoDia, setOcupDoDia] = useState<Ocupado[] | null>(null)
  useEffect(() => {
    let vivo = true
    api
      .ocupacao(cred, dia, dia)
      .then((o) => vivo && setOcupDoDia(o))
      .catch(() => vivo && setOcupDoDia(null))
    return () => {
      vivo = false
    }
  }, [cred, dia, ocupacao])
  const oc = ocupDoDia ?? ocupacao
  const cfg = def.config as Extract<ServicoDef['config'], { por_semana: number }>
  const naSemana = minhas.filter(
    (s) => s.servico === def.chave && s.inicio && s.status !== 'cancelada' && s.status !== 'recusada' && segundaDa(diaDe(s.inicio)) === segundaDa(dia),
  ).length

  async function enviar() {
    if (!inicio) {
      setErro('Escolha um horário.')
      return
    }
    prepararSom() // ainda dentro do toque: o iPhone só toca som liberado por um toque
    setEnviando(true)
    setErro(null)
    try {
      const r = await api.solicitar(cred, { servico: def.chave, inicio, detalhes: { obs } })
      const h = periodosDoDia(def.config, diaDe(inicio), especiais).find((x) => x.inicio === inicio)
      tocarConfirmacao()
      await fim({
        servico: def.chave,
        titulo: 'Reserva confirmada',
        linhas: [
          def.nome,
          `${diaCurto(diaDe(inicio))} · ${def.config.tipo === 'periodo' ? `${h?.rotulo} (${inicio.slice(11)} às ${h?.fim.slice(11)})` : `${inicio.slice(11)} às ${h?.fim.slice(11)}`}`,
          ...(def.chave === 'diaria' ? ['O valor é combinado com a administração.'] : []),
        ],
        protocolo: r.protocolo,
      })
    } catch (e) {
      setErro(mensagem(e))
      if (e instanceof Error && e.message === 'ocupado') {
        setInicio(null)
        await recarregar()
      }
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="m-form-corpo">
      <div className="campo">
        <span className="rotulo">Dia</span>
        <div className="m-dias" role="radiogroup" aria-label="Dia">
          {dias.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={d === dia}
              className="m-chip-dia"
              onClick={() => {
                setDia(d)
                setInicio(null)
              }}
            >
              <span className="peq">{diaCurto(d).split(' ')[0]}</span>
              <span className="num">{d.slice(8, 10)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="campo">
        <span className="rotulo">
          Horário <span className="apagado">· {naSemana} de {cfg.por_semana} nesta semana</span>
        </span>
        <div className="m-chips" role="radiogroup" aria-label="Horário">
          {periodosDoDia(def.config, dia, especiais).every((h) => h.inicio <= agora) ? <p className="apagado peq">Os horários deste dia já passaram.</p> : null}
          {periodosDoDia(def.config, dia, especiais).filter((h) => h.inicio > agora).map((h) => {
            const o = oc.find((x) => x.servico === def.chave && x.inicio === h.inicio)
            const livre = !o
            return (
              <button
                key={h.inicio}
                type="button"
                role="radio"
                aria-checked={inicio === h.inicio}
                disabled={!livre}
                className={`m-chip ${o?.minha ? 'seu' : livre ? 'livre' : 'ocupado'}`}
                onClick={() => setInicio(h.inicio)}
              >
                {h.rotulo}
                {def.config.tipo === 'periodo' ? <span className="apagado num"> {h.inicio.slice(11)}–{h.fim.slice(11)}</span> : null}
                {o?.minha ? ' · seu' : o ? ' · ocupado' : ''}
              </button>
            )
          })}
        </div>
      </div>

      <Campo rotulo="Observação (opcional)">
        {(p) => <input {...p} maxLength={300} value={obs} onChange={(e) => setObs(e.target.value)} />}
      </Campo>
      {def.chave === 'diaria' ? <p className="apagado peq">O valor da diária é combinado com a administração.</p> : null}
      {erro ? (
        <p className="faixa-erro" role="alert">
          {erro}
        </p>
      ) : null}
      <button type="button" className="btn primario grande" disabled={enviando || !inicio} onClick={() => void enviar()}>
        {enviando ? 'Reservando…' : 'Reservar'}
      </button>
    </div>
  )
}

/* Estacionamento: datas, placa, veículo. A portaria libera a vaga. */
function FormEstacionamento({ cred, maxDias, fim }: { cred: Credencial; maxDias: number; fim: Fim }) {
  const hoje = diaDe(agoraLocal())
  const [f, setF] = useState({ de: hoje, ate: hoje, placa: '', veiculo: '', para: '', obs: '' })
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const placaRef = useRef<HTMLInputElement>(null)

  function conferir(): Record<string, string> {
    const e: Record<string, string> = {}
    if (f.de < hoje) e.de = 'A entrada não pode ser no passado.'
    if (f.ate < f.de) e.ate = 'A saída vem no mesmo dia da entrada ou depois.'
    else if (f.ate > somaDias(f.de, maxDias - 1)) e.ate = `No máximo ${maxDias} dias seguidos.`
    if (!placaValida(f.placa)) e.placa = 'Placa no formato ABC1234 ou ABC1D23.'
    return e
  }

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault()
    const e = conferir()
    setErros(e)
    if (Object.keys(e).length) {
      if (e.placa) placaRef.current?.focus()
      return
    }
    prepararSom()
    setEnviando(true)
    setErro(null)
    try {
      const r = await api.solicitar(cred, { servico: 'estacionamento', inicio: `${f.de}T00:00`, detalhes: { ate: f.ate, placa: f.placa, veiculo: f.veiculo, para: f.para, obs: f.obs } })
      tocarConfirmacao()
      await fim({
        servico: 'estacionamento',
        titulo: 'Pedido de vaga enviado',
        linhas: [f.de === f.ate ? diaCurto(f.de) : `${diaCurto(f.de)} a ${diaCurto(f.ate)}`, `Placa ${f.placa.toUpperCase().replace(/[^A-Z0-9]/g, '')}`, 'A portaria confirma a vaga; a resposta aparece em Acompanhar.'],
        protocolo: r.protocolo,
      })
    } catch (e2) {
      setErro(mensagem(e2))
    } finally {
      setEnviando(false)
    }
  }

  const muda = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="m-form-corpo" onSubmit={enviar} noValidate>
      <div className="m-duas">
        <Campo rotulo="Entrada" erro={erros.de}>
          {(p) => <input {...p} type="date" min={hoje} value={f.de} onChange={muda('de')} />}
        </Campo>
        <Campo rotulo="Saída" erro={erros.ate}>
          {(p) => <input {...p} type="date" min={f.de} value={f.ate} onChange={muda('ate')} />}
        </Campo>
      </div>
      <Campo rotulo="Placa" erro={erros.placa}>
        {(p) => <input {...p} ref={placaRef} className="mono" autoCapitalize="characters" maxLength={8} placeholder="ABC1D23" value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value.toUpperCase() })} onBlur={() => f.placa && setErros({ ...erros, placa: placaValida(f.placa) ? '' : 'Placa no formato ABC1234 ou ABC1D23.' })} />}
      </Campo>
      <Campo rotulo="Veículo (opcional)" dica="Modelo e cor ajudam a portaria">
        {(p) => <input {...p} maxLength={80} value={f.veiculo} onChange={muda('veiculo')} />}
      </Campo>
      <Campo rotulo="Para quem (opcional)">
        {(p) => <input {...p} maxLength={80} placeholder="Ex.: visita da minha mãe" value={f.para} onChange={muda('para')} />}
      </Campo>
      <p className="apagado peq">A portaria confirma a vaga. O valor é combinado com a administração.</p>
      {erro ? (
        <p className="faixa-erro" role="alert">
          {erro}
        </p>
      ) : null}
      <button className="btn primario grande" disabled={enviando}>
        {enviando ? 'Enviando…' : 'Pedir vaga'}
      </button>
    </form>
  )
}

/* Denúncia: tipo, onde, quando, o que aconteceu; anônima se a pessoa quiser. */
function FormDenuncia({ cred, categorias, fim }: { cred: Credencial; categorias: string[]; fim: Fim }) {
  const [f, setF] = useState({ categoria: '', local: '', quando: '', descricao: '', anonima: false })
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault()
    const e: Record<string, string> = {}
    if (!f.categoria) e.categoria = 'Escolha o tipo.'
    if (f.descricao.trim().length < 10) e.descricao = 'Conte o que aconteceu em pelo menos 10 letras.'
    setErros(e)
    if (Object.keys(e).length) return
    setEnviando(true)
    setErro(null)
    try {
      const r = await api.solicitar(cred, {
        servico: 'denuncia',
        inicio: null,
        detalhes: { categoria: f.categoria, local: f.local, quando: f.quando, descricao: f.descricao },
        anonima: f.anonima,
      })
      // Sem som de propósito: um toque alegre não combina com quem acabou de relatar um problema.
      await fim(
        {
          servico: 'denuncia',
          titulo: 'Recebemos sua denúncia',
          mensagem: [
            'Poxa, sentimos muito pelo que você passou.',
            'Sua denúncia já está com o síndico, e vamos garantir que ela seja analisada e que você receba uma resposta por aqui, em Acompanhar.',
            ...(f.anonima ? ['Ela foi enviada sem identificação: ninguém sabe que foi você. Só este celular consegue acompanhar a resposta.'] : []),
          ],
          linhas: [f.categoria, ...(f.local.trim() ? [f.local.trim()] : [])],
          protocolo: r.protocolo,
        },
        r.token,
      )
    } catch (e2) {
      setErro(mensagem(e2))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="m-form-corpo" onSubmit={enviar} noValidate>
      <Campo rotulo="Tipo" erro={erros.categoria}>
        {(p) => (
          <select {...p} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>
            <option value="">Escolha</option>
            {categorias.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
      </Campo>
      <Campo rotulo="Onde (opcional)">
        {(p) => <input {...p} maxLength={120} placeholder="Ex.: garagem, bloco B" value={f.local} onChange={(e) => setF({ ...f, local: e.target.value })} />}
      </Campo>
      <Campo rotulo="Quando (opcional)">
        {(p) => <input {...p} maxLength={60} placeholder="Ex.: ontem por volta das 23h" value={f.quando} onChange={(e) => setF({ ...f, quando: e.target.value })} />}
      </Campo>
      <Campo rotulo="O que aconteceu" erro={erros.descricao}>
        {(p) => <textarea {...p} maxLength={2000} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />}
      </Campo>
      <label className="marcar">
        <input type="checkbox" checked={f.anonima} onChange={(e) => setF({ ...f, anonima: e.target.checked })} />
        <span>
          <strong>Enviar sem me identificar</strong>
          <span className="sec peq" style={{ display: 'block' }}>
            O apartamento não é gravado. Só este celular consegue acompanhar a resposta.
          </span>
        </span>
      </label>
      <p className="apagado peq">
        Quem recebe é o síndico. A portaria não vê denúncias. <Info texto="Você acompanha cada passo e a resposta em Acompanhar, logo abaixo. Uma denúncia anônima não pode ser cancelada depois, porque o sistema não sabe de quem ela é." />
      </p>
      {erro ? (
        <p className="faixa-erro" role="alert">
          {erro}
        </p>
      ) : null}
      <button className="btn primario grande" disabled={enviando}>
        {enviando ? 'Enviando…' : 'Enviar denúncia'}
      </button>
    </form>
  )
}

/* ------------------------------------------------------------------ acompanhar */

export function Acompanhar({ cred, servicos, minhas, mudou, falhou }: {
  cred: Credencial
  servicos: ServicoDef[]
  minhas: Solicitacao[]
  mudou: (texto: string) => Promise<void>
  falhou: (texto: string) => void
}) {
  const [aberta, setAberta] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<string | null>(null)
  const agora = agoraLocal()

  async function cancelar(s: Solicitacao) {
    if (!confirm(`Cancelar ${nomeServico(s.servico, servicos)} nº ${s.protocolo}?`)) return
    setCancelando(s.id)
    try {
      await api.cancelar(cred, s.id)
      await mudou(`Nº ${s.protocolo} cancelada.`)
    } catch (e) {
      falhou(mensagem(e))
    } finally {
      setCancelando(null)
    }
  }

  return (
    <section aria-labelledby="titulo-acompanhar" className="m-acompanhar">
      <h2 id="titulo-acompanhar" className="m-secao">
        Acompanhar <span className="apagado num peq">{minhas.length}</span>
      </h2>
      {!minhas.length ? <p className="vazio">Você ainda não fez nenhuma solicitação.</p> : null}
      <ul className="m-lista">
        {minhas.map((s) => {
          const ab = aberta === s.id
          return (
            <li key={s.id} className="cartao m-item">
              <button type="button" className="m-item-cab" aria-expanded={ab} onClick={() => setAberta(ab ? null : s.id)}>
                <span className="m-item-linha">
                  <Ponto servico={s.servico} />
                  <strong>{nomeServico(s.servico, servicos)}</strong>
                  <span className="apagado num peq">nº {s.protocolo}</span>
                </span>
                <span className="sec peq">{s.servico === 'denuncia' ? `${s.detalhes.categoria} · ${descreverQuando(s, servicos)}` : descreverQuando(s, servicos)}</span>
                <span className="m-item-linha">
                  <Selo s={s} agora={agora} />
                  {pagamentoPendente(s) ? <Pendente /> : null}
                  {s.anonima ? <span className="apagado peq">sem identificação</span> : null}
                </span>
                <ChevronDown className="m-item-seta" size={18} strokeWidth={1.5} aria-hidden="true" />
              </button>
              {ab ? (
                <div className="m-item-corpo anima-entra">
                  <Detalhes s={s} />
                  <ol className="linha-tempo" aria-label="Histórico">
                    {s.historico.map((h, i) => (
                      <li key={i}>
                        <div>
                          <span className="peq">
                            {rotuloStatus(s.servico, h.status)} <span className="apagado num">· {momento(h.em)} · {h.por_papel === 'morador' ? 'você' : h.por_papel === 'sindico' ? 'síndico' : 'portaria'}</span>
                          </span>
                          {h.nota ? <p className="nota peq">{h.nota}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {moradorCancela(s, agora) ? (
                    <button type="button" className="btn perigo" disabled={cancelando === s.id} onClick={() => void cancelar(s)}>
                      {cancelando === s.id ? 'Cancelando…' : 'Cancelar'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Os campos que o morador preencheu (só os que têm valor). */
export function Detalhes({ s }: { s: Solicitacao }) {
  const d = s.detalhes
  const linhas: [string, string | undefined][] = [
    ['Placa', d.placa],
    ['Veículo', d.veiculo],
    ['Para quem', d.para],
    ['Onde', d.local],
    ['Quando', d.quando],
    ['O que aconteceu', d.descricao],
    ['Observação', d.obs],
  ]
  const com = linhas.filter(([, v]) => v)
  if (!com.length) return null
  return (
    <dl className="detalhes">
      {com.map(([k, v]) => (
        <div key={k}>
          <dt className="apagado peq">{k}</dt>
          <dd className={k === 'Placa' ? 'mono' : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ------------------------------------------------------------------ pronto */

/**
 * Tela depois de enviar: a marca de confirmação se desenha, o resumo do que foi feito e o recado de
 * que está tudo salvo (a pessoa pode fechar o app). O foco vai para o título, para o leitor de tela
 * anunciar a confirmação.
 */
function Pronto({ c, inicio, acompanhar }: { c: Conclusao; inicio: () => void; acompanhar: () => void }) {
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titulo.current?.focus()
  }, [])
  return (
    <section className={`cartao m-pronto anima-entra${c.servico === 'denuncia' ? ' acolhe' : ''}`} aria-labelledby="titulo-pronto">
      <svg className="m-pronto-marca" viewBox="0 0 56 56" aria-hidden="true">
        <circle className="m-pronto-circulo" cx="28" cy="28" r="25" />
        <path className="m-pronto-check" d="M17 29l7 7 15-16" />
      </svg>
      <h2 id="titulo-pronto" ref={titulo} tabIndex={-1}>
        {c.titulo}
      </h2>
      {c.mensagem ? (
        <div className="m-pronto-msg">
          {c.mensagem.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      ) : null}
      <dl className="m-pronto-resumo">
        {c.linhas.map((l) => (
          <dd key={l}>{l}</dd>
        ))}
        <dd className="apagado num">nº {c.protocolo}</dd>
      </dl>
      <p className="sec peq">Está tudo salvo. Você já pode fechar o app.</p>
      <div className="m-pronto-acoes">
        <button type="button" className="btn primario grande" onClick={inicio}>
          Voltar ao início
        </button>
        <button type="button" className="btn quieto" onClick={acompanhar}>
          Ver em Acompanhar
        </button>
      </div>
    </section>
  )
}
