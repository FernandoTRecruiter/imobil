/* =============================================================================
   Lado da EQUIPE (web). Páginas no mesmo cabeçalho, mostradas conforme as permissões de cada um:
     #/adm               Calendário (filtros em cima, calendário à esquerda, o dia à direita)
     #/adm/solicitacoes  Solicitações (tabela de tudo)
     #/adm/pessoas       Moradores (portaria) ou Pessoas (quem administra: estatísticas, moradores
                         e funcionários com as permissões)
     #/adm/noticias      Notícias (avisos do app, e-mails em massa e agendados, modelos)
   Quem decide o que cada um vê é o banco (permissões em cond_equipe), não esta tela.
   Os dados são lidos ao abrir e de novo a cada minuto (a portaria deixa a tela aberta).
   ============================================================================= */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogOut } from 'lucide-react'
import { NOME_CONDOMINIO, type Servico, type ServicoDef } from '../config'
import { algumCobra, api, useRegras } from '../dados/api'
import { agoraLocal, bate, descreverQuando, diaDe, mensagem, nomeServico, noDia, pagamentoPendente, passagens, rotuloStatus, somaDias, statusEfetivo } from '../regras'
import type { MembroEquipe, Morador, Permissao, Solicitacao } from '../tipos'
import { Apto, Campo, Marca, Pendente, Ponto, Selo, useAviso, useLembrar } from '../ui'
import { Detalhes } from '../morador/Solicitar'
import { CalendarioAdm } from './Calendario'
import { Noticias } from './Noticias'
import { Pessoas } from './Pessoas'
import { SolicitacoesAdm } from './Solicitacoes'

export const pode = (eu: MembroEquipe, p: Permissao) => eu.permissoes.includes(p)

/* ------------------------------------------------------------------ filtros (o desenho do pedido) */

export type Situacao = '' | 'abertas' | 'pagamento' | 'encerradas'
/** Os números do topo também filtram: um de cada vez, clicar de novo desliga. */
export type Heroi = '' | 'hoje' | 'semana' | 'aguardando' | 'pagamento' | 'denuncias'
export interface Filtros {
  busca: string
  servico: '' | Servico
  apto: string // '' = todos; '-' = denúncias anônimas
  situacao: Situacao
  heroi: Heroi
  /** Período (Solicitações): o dia em que o pedido acontece (a denúncia, o dia em que chegou). '' = sem limite. */
  de: string
  ate: string
}
export const FILTROS_VAZIOS: Filtros = { busca: '', servico: '', apto: '', situacao: '', heroi: '', de: '', ate: '' }

/** Dia de uma solicitação para o filtro de período: quando acontece ou, sem data, quando chegou. */
const diaDoPedido = (s: Solicitacao) => (s.inicio ? diaDe(s.inicio) : diaDe(agoraLocal(new Date(s.criado_em))))

/** Texto onde a busca procura: protocolo, apto, nome, placa, categoria e o que foi escrito. */
const textoBusca = (s: Solicitacao) =>
  [s.protocolo, s.apto ?? 'anonima', s.morador, s.detalhes.placa, s.detalhes.veiculo, s.detalhes.categoria, s.detalhes.local, s.detalhes.descricao, s.detalhes.para].filter(Boolean).join(' ')

/** Em aberto = falta alguém agir (aberta, em análise) ou ainda vai acontecer (confirmada no futuro). */
export function situacaoBate(s: Solicitacao, sit: Situacao, agora: string): boolean {
  const st = statusEfetivo(s, agora)
  if (sit === 'abertas') return st === 'aberta' || st === 'em_analise' || st === 'confirmada'
  if (sit === 'pagamento') return pagamentoPendente(s)
  if (sit === 'encerradas') return st === 'concluida' || st === 'cancelada' || st === 'recusada'
  return true
}

/** O que cada número do topo conta (e filtra quando está ligado). */
export function heroiBate(s: Solicitacao, h: Heroi, agora: string): boolean {
  const hoje = diaDe(agora)
  const viva = s.status !== 'cancelada' && s.status !== 'recusada'
  if (h === 'hoje') return viva && s.servico !== 'denuncia' && noDia(s, hoje)
  if (h === 'semana') return viva && s.servico !== 'denuncia' && !!s.inicio && diaDe(s.inicio) >= hoje && diaDe(s.inicio) <= somaDias(hoje, 6)
  if (h === 'aguardando') return s.servico === 'estacionamento' && s.status === 'aberta'
  if (h === 'pagamento') return pagamentoPendente(s)
  if (h === 'denuncias') return s.servico === 'denuncia' && (s.status === 'aberta' || s.status === 'em_analise')
  return true
}

/** Aplica os filtros; "ignorar" deixa um de fora para a contagem das opções daquele filtro. */
export function filtrar(itens: Solicitacao[], f: Filtros, agora: string, ignorar?: keyof Filtros): Solicitacao[] {
  return itens.filter(
    (s) =>
      (ignorar === 'busca' || !f.busca.trim() || bate(textoBusca(s), f.busca)) &&
      (ignorar === 'servico' || !f.servico || s.servico === f.servico) &&
      (ignorar === 'apto' || !f.apto || (f.apto === '-' ? !s.apto : s.apto === f.apto)) &&
      (ignorar === 'situacao' || situacaoBate(s, f.situacao, agora)) &&
      (ignorar === 'heroi' || heroiBate(s, f.heroi ?? '', agora)) &&
      (!f.de || diaDoPedido(s) >= f.de) &&
      (!f.ate || diaDoPedido(s) <= f.ate),
  )
}

/** Barra de filtros: data (só no calendário), busca, categoria e residente, com contagem verdadeira. */
export function BarraFiltros({ itens, f, setF, servicos, moradores, agora, data, periodo, situacao, cobra }: {
  itens: Solicitacao[]
  f: Filtros
  setF: (f: Filtros) => void
  servicos: ServicoDef[]
  moradores: Morador[]
  agora: string
  data?: { valor: string; mudar: (d: string) => void }
  /** Mostra "de / até" (Solicitações). */
  periodo?: boolean
  situacao?: boolean
  cobra: boolean
}) {
  const visiveis = filtrar(itens, f, agora)
  const porServico = filtrar(itens, f, agora, 'servico')
  const porApto = filtrar(itens, f, agora, 'apto')
  const porSituacao = filtrar(itens, f, agora, 'situacao')
  // Residentes: um por apartamento, com os nomes de quem mora lá.
  const aptos = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const x of moradores) if (x.ativo) m.set(x.apto, [...(m.get(x.apto) ?? []), x.nome.split(' ')[0]])
    for (const s of itens) if (s.apto && !m.has(s.apto)) m.set(s.apto, [s.morador ?? ''])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }))
  }, [moradores, itens])
  const servicosVisiveis = servicos.filter((s) => s.chave !== 'denuncia' || itens.some((x) => x.servico === 'denuncia'))
  const temFiltro = !!(f.busca || f.servico || f.apto || f.situacao || f.heroi || f.de || f.ate)
  const n = (lista: Solicitacao[], pred: (s: Solicitacao) => boolean) => lista.filter(pred).length

  return (
    <div className="a-filtros cartao" role="search">
      {data ? (
        <label className="a-filtro-data">
          <span className="sr">Data</span>
          <input className="entrada" type="date" value={data.valor} onChange={(e) => e.target.value && data.mudar(e.target.value)} />
        </label>
      ) : null}
      {periodo ? <Periodo de={f.de} ate={f.ate} mudar={(de, ate) => setF({ ...f, de, ate })} /> : null}
      <div className="a-busca">
        <input className="entrada" type="search" placeholder="Buscar nº, apto, nome ou texto" aria-label="Buscar por número, apartamento, nome ou texto" value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} />
        <span className="apagado peq num a-contador" aria-live="polite">
          {temFiltro ? `${visiveis.length} de ${itens.length}` : ''}
        </span>
      </div>
      <label>
        <span className="sr">Categoria</span>
        <select className="entrada" value={f.servico} onChange={(e) => setF({ ...f, servico: e.target.value as Filtros['servico'] })}>
          <option value="">Categoria: todas ({porServico.length})</option>
          {servicosVisiveis.map((s) => (
            <option key={s.chave} value={s.chave}>
              {s.nome} ({n(porServico, (x) => x.servico === s.chave)})
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr">Residente</span>
        <select className="entrada" value={f.apto} onChange={(e) => setF({ ...f, apto: e.target.value })}>
          <option value="">Residente: todos ({porApto.length})</option>
          {itens.some((s) => !s.apto) ? <option value="-">Denúncia anônima ({n(porApto, (x) => !x.apto)})</option> : null}
          {aptos.map(([apto, nomes]) => (
            <option key={apto} value={apto}>
              {apto} · {nomes.join(', ')} ({n(porApto, (x) => x.apto === apto)})
            </option>
          ))}
        </select>
      </label>
      {situacao ? (
        <label>
          <span className="sr">Situação</span>
          <select className="entrada" value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value as Situacao })}>
            <option value="">Situação: todas ({porSituacao.length})</option>
            <option value="abertas">Em aberto ({n(porSituacao, (x) => situacaoBate(x, 'abertas', agora))})</option>
            {cobra ? <option value="pagamento">Pagamento pendente ({n(porSituacao, pagamentoPendente)})</option> : null}
            <option value="encerradas">Encerradas ({n(porSituacao, (x) => situacaoBate(x, 'encerradas', agora))})</option>
          </select>
        </label>
      ) : null}
      <button type="button" className="btn limpar" disabled={!temFiltro} onClick={() => setF(FILTROS_VAZIOS)}>
        Limpar
      </button>
    </div>
  )
}

/** De / até, no mesmo desenho do campo de data do calendário. Vazio = sem limite. */
export function Periodo({ de, ate, mudar, rotulo = 'Período' }: { de: string; ate: string; mudar: (de: string, ate: string) => void; rotulo?: string }) {
  return (
    <span className="a-periodo" role="group" aria-label={rotulo}>
      <input className="entrada" type="date" aria-label={`${rotulo}: de`} value={de} max={ate || undefined} onChange={(e) => mudar(e.target.value, ate)} />
      <span className="apagado peq">até</span>
      <input className="entrada" type="date" aria-label={`${rotulo}: até`} value={ate} min={de || undefined} onChange={(e) => mudar(de, e.target.value)} />
    </span>
  )
}

/* ------------------------------------------------------------------ números do topo (heróis) */

/**
 * Os números do topo. Cada um é também um filtro desta página: clicar liga (fica marcado e a lista
 * mostra só aquilo), clicar de novo desliga. "Denúncias em aberto" fica em vermelho.
 */
export function Herois({ itens, eu, servicos, agora, f, setF }: { itens: Solicitacao[]; eu: MembroEquipe; servicos: ServicoDef[]; agora: string; f: Filtros; setF: (f: Filtros) => void }) {
  const conta = (h: Heroi) => itens.filter((s) => heroiBate(s, h, agora)).length
  const amanha = somaDias(diaDe(agora), 1)
  const estacionamento = servicos.some((s) => s.chave === 'estacionamento')
  const tiles: { h: Heroi; rotulo: string; ctx: string; tom?: 'alerta' | 'pend' }[] = []
  if (pode(eu, 'reservas')) {
    tiles.push({ h: 'hoje', rotulo: 'Hoje', ctx: `amanhã: ${itens.filter((s) => s.status !== 'cancelada' && s.servico !== 'denuncia' && noDia(s, amanha)).length}` })
    tiles.push({ h: 'semana', rotulo: 'Próximos 7 dias', ctx: 'reservas confirmadas' })
    if (estacionamento) tiles.push({ h: 'aguardando', rotulo: 'Aguardando portaria', ctx: 'pedidos de estacionamento' })
    if (algumCobra(servicos)) tiles.push({ h: 'pagamento', rotulo: 'Pagamento pendente', ctx: 'nome em amarelo', tom: 'pend' })
  }
  if (pode(eu, 'denuncias')) {
    const semResposta = itens.filter((s) => s.servico === 'denuncia' && s.status === 'aberta').length
    tiles.push({ h: 'denuncias', rotulo: 'Denúncias em aberto', ctx: `${semResposta} sem resposta`, tom: 'alerta' })
  }
  return (
    <div className="a-herois" role="group" aria-label="Números do topo (clique para filtrar)">
      {tiles.map((t) => {
        const n = conta(t.h)
        const ligado = f.heroi === t.h
        return (
          <button
            key={t.h}
            type="button"
            aria-pressed={ligado}
            className={`a-heroi cartao${t.tom === 'alerta' && n > 0 ? ' alerta' : ''}${t.tom === 'pend' && n > 0 ? ' amarelo' : ''}`}
            onClick={() => setF({ ...f, heroi: ligado ? '' : t.h })}
          >
            <span className="sec peq">{t.rotulo}</span>
            <span className="a-heroi-n num">{n}</span>
            <span className="apagado peq">{ligado ? 'filtrando a lista · clique para tirar' : t.ctx}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ detalhe com as ações */

/** Uma solicitação aberta pela equipe: dados, histórico e o que dá para fazer agora. */
export function DetalheEquipe({ s, servicos, agora, atualizar }: { s: Solicitacao; servicos: ServicoDef[]; agora: string; atualizar: (id: string, m: { status?: Solicitacao['status']; nota?: string; pago?: boolean }) => Promise<boolean> }) {
  const [nota, setNota] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    setNota('')
    setErro(null)
  }, [s.id])

  async function fazer(m: { status?: Solicitacao['status']; nota?: string; pago?: boolean }, exigeNota = false) {
    if (exigeNota && !nota.trim()) {
      setErro('Escreva a resposta: é o que quem denunciou vai ler.')
      return
    }
    setOcupado(true)
    setErro(null)
    const ok = await atualizar(s.id, { ...m, nota: m.nota ?? (nota.trim() || undefined) })
    if (ok) setNota('')
    setOcupado(false)
  }

  // Reserva cujo horário já passou não tem mais o que mudar (só pagamento e nota).
  const acoes = statusEfetivo(s, agora) === s.status ? passagens(s.servico, s.status) : []
  return (
    <div className="a-detalhe">
      <div className="a-detalhe-cab">
        <span className="a-linha">
          <Ponto servico={s.servico} />
          <strong>{nomeServico(s.servico, servicos)}</strong>
          <span className="apagado num peq">nº {s.protocolo}</span>
        </span>
        <span className="a-linha">
          <Selo s={s} agora={agora} />
          {pagamentoPendente(s) ? <Pendente /> : null}
        </span>
      </div>
      <p className="sec">{descreverQuando(s, servicos)}</p>
      <p className="a-linha">
        <Apto apto={s.apto} /> {s.morador ? <span className={pagamentoPendente(s) ? 'pend' : undefined}>{s.morador}</span> : s.anonima ? <span className="apagado peq">quem enviou não se identificou</span> : null}
      </p>
      {s.servico === 'denuncia' && s.detalhes.categoria ? (
        <p className="peq">
          <span className="apagado">Tipo:</span> {s.detalhes.categoria}
        </p>
      ) : null}
      <Detalhes s={s} />

      <ol className="linha-tempo" aria-label="Histórico">
        {s.historico.map((h, i) => (
          <li key={i}>
            <div>
              <span className="peq">
                {rotuloStatus(s.servico, h.status)}{' '}
                <span className="apagado num">
                  · {new Date(h.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {h.por_papel === 'morador' ? 'morador' : (h.por_nome ?? h.por_papel)}
                </span>
              </span>
              {h.nota ? <p className="nota peq">{h.nota}</p> : null}
            </div>
          </li>
        ))}
      </ol>

      {acoes.length || s.pago !== null || s.status !== 'cancelada' ? (
        <div className="a-acoes">
          <Campo rotulo={s.servico === 'denuncia' ? 'Resposta (quem denunciou lê)' : 'Nota para o morador (opcional)'} erro={erro}>
            {(p) => <textarea {...p} rows={3} maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)} />}
          </Campo>
          <div className="a-botoes">
            {acoes.map((a) => (
              <button
                key={a.para}
                type="button"
                className={`btn${a.para === 'confirmada' || a.para === 'concluida' || a.para === 'em_analise' ? ' primario' : a.para === 'recusada' || a.para === 'cancelada' ? ' perigo' : ''}`}
                disabled={ocupado}
                onClick={() => void fazer({ status: a.para }, a.exigeNota)}
              >
                {a.rotulo}
              </button>
            ))}
            {s.pago !== null && s.status !== 'cancelada' && s.status !== 'recusada' ? (
              <button type="button" className="btn" disabled={ocupado} onClick={() => void fazer({ pago: !s.pago })}>
                {s.pago ? 'Desmarcar pagamento' : 'Marcar como pago'}
              </button>
            ) : null}
            <button type="button" className="btn quieto" disabled={ocupado || !nota.trim()} onClick={() => void fazer({})}>
              Só enviar a nota
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ entrada e moldura */

type Pagina = 'calendario' | 'solicitacoes' | 'pessoas' | 'noticias'

/** As páginas que cada pessoa vê (pelas permissões), na ordem do cabeçalho. */
function paginasDe(eu: MembroEquipe): { chave: Pagina; rotulo: string; hash: string }[] {
  const lista: { chave: Pagina; rotulo: string; hash: string }[] = []
  if (pode(eu, 'reservas') || pode(eu, 'denuncias')) {
    lista.push({ chave: 'calendario', rotulo: 'Calendário', hash: '#/adm' }, { chave: 'solicitacoes', rotulo: 'Solicitações', hash: '#/adm/solicitacoes' })
  }
  if (pode(eu, 'moradores') || pode(eu, 'admin')) lista.push({ chave: 'pessoas', rotulo: pode(eu, 'admin') ? 'Pessoas' : 'Moradores', hash: '#/adm/pessoas' })
  if (pode(eu, 'noticias')) lista.push({ chave: 'noticias', rotulo: 'Notícias', hash: '#/adm/noticias' })
  return lista
}

export function AdmApp({ rota }: { rota: string }) {
  const [eu, setEu] = useState<MembroEquipe | null | undefined>(undefined)
  useEffect(() => {
    api.equipeAtual().then(setEu, () => setEu(null))
  }, [])
  if (eu === undefined) return <p className="vazio">Carregando…</p>
  if (!eu) return <EntrarEquipe entrou={setEu} />
  const paginas = paginasDe(eu)
  const pedida: Pagina = rota.startsWith('#/adm/solicitacoes') ? 'solicitacoes' : rota.startsWith('#/adm/pessoas') || rota.startsWith('#/adm/moradores') ? 'pessoas' : rota.startsWith('#/adm/noticias') ? 'noticias' : 'calendario'
  const pagina = paginas.some((p) => p.chave === pedida) ? pedida : (paginas[0]?.chave ?? 'calendario')
  return (
    <Painel
      eu={eu}
      pagina={pagina}
      paginas={paginas}
      sair={async () => {
        await api.sairEquipe()
        setEu(null)
      }}
    />
  )
}

function EntrarEquipe({ entrou }: { entrou: (e: MembroEquipe) => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  async function entrar(em: string, se: string) {
    setEnviando(true)
    setErro(null)
    try {
      entrou(await api.entrarEquipe(em, se))
    } catch (e) {
      setErro(mensagem(e))
    } finally {
      setEnviando(false)
    }
  }
  return (
    <main className="a-entrar anima-entra">
      <header className="entrada-marca">
        <Marca />
        <span>
          <strong>Condomínio</strong>
          <span className="apagado peq">{NOME_CONDOMINIO || 'Condomínio'}</span>
        </span>
      </header>
      <div className="entrada-texto">
        <h1>Painel da equipe</h1>
        <p className="sec">Portaria, zeladoria e síndico: reservas, denúncias, moradores e notícias.</p>
      </div>
      <form
        className="cartao m-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void entrar(email, senha)
        }}
      >
        <Campo rotulo="E-mail">{(p) => <input {...p} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Campo>
        <Campo rotulo="Senha">{(p) => <input {...p} type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />}</Campo>
        {erro ? (
          <p className="faixa-erro" role="alert">
            {erro}
          </p>
        ) : null}
        <button className="btn primario grande" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        {api.modo === 'demo' ? (
          <div className="a-demo">
            <span className="sec peq">Demonstração:</span>
            <button type="button" className="btn" onClick={() => void entrar('portaria@demo', '')}>
              Portaria
            </button>
            <button type="button" className="btn" onClick={() => void entrar('sindico@demo', '')}>
              Síndico
            </button>
            <button type="button" className="btn" onClick={() => void entrar('zeladoria@demo', '')}>
              Zeladoria
            </button>
          </div>
        ) : null}
      </form>
      <p className="apagado peq m-rodape">
        <a href="#/">Tela do morador</a>
      </p>
    </main>
  )
}

function Painel({ eu, pagina, paginas, sair }: { eu: MembroEquipe; pagina: Pagina; paginas: ReturnType<typeof paginasDe>; sair: () => Promise<void> }) {
  const { servicos, erro: erroRegras } = useRegras()
  const [itens, setItens] = useState<Solicitacao[] | null>(null)
  const [moradores, setMoradores] = useState<Morador[]>([])
  const [falhou, setFalhou] = useState(false)
  const [f, setF] = useLembrar<Filtros>('condominio:adm:filtros', FILTROS_VAZIOS)
  const [aviso, avisar] = useAviso()
  const [agora, setAgora] = useState(agoraLocal())
  const veSolicitacoes = pode(eu, 'reservas') || pode(eu, 'denuncias')

  const recarregar = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([veSolicitacoes ? api.painel() : Promise.resolve({ itens: [] }), pode(eu, 'moradores') ? api.moradores() : Promise.resolve([])])
      setItens(p.itens)
      setMoradores(m)
      setFalhou(false)
      setAgora(agoraLocal())
    } catch {
      setFalhou(true)
    }
  }, [eu, veSolicitacoes])

  // Lê ao abrir e a cada minuto, só com a aba visível.
  useEffect(() => {
    void recarregar()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void recarregar()
    }, 60_000)
    return () => clearInterval(t)
  }, [recarregar])

  const atualizar = useCallback(
    async (id: string, m: { status?: Solicitacao['status']; nota?: string; pago?: boolean }) => {
      try {
        await api.atualizar(id, m)
        await recarregar()
        avisar('Feito.')
        return true
      } catch (e) {
        avisar(mensagem(e), true)
        return false
      }
    },
    [recarregar, avisar],
  )

  const filtros = { ...FILTROS_VAZIOS, ...f } // filtro lembrado de uma versão antiga ganha os campos novos
  const props: PropsPagina | null =
    servicos && itens ? { itens, servicos, moradores, eu, agora, f: filtros, setF, atualizar, cobra: algumCobra(servicos) } : null

  return (
    <div className="a-app">
      <header className="a-topo">
        <div className="a-topo-dentro">
          <div className="a-marca">
            <span className="m-topo-marca">
              <Marca />
              <strong>Condomínio</strong>
            </span>
            {NOME_CONDOMINIO ? <span className="apagado peq">{NOME_CONDOMINIO}</span> : null}
          </div>
          <div className="a-quem">
            <span className="sec peq">
              {eu.nome} · {eu.cargo}
            </span>
            <button type="button" className="btn quieto icone" aria-label="Sair" onClick={() => void sair()}>
              <LogOut size={18} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </div>
        <nav className="a-nav" aria-label="Páginas">
          <div className="a-nav-dentro">
            {paginas.map((p) => (
              <a key={p.chave} href={p.hash} aria-current={pagina === p.chave ? 'page' : undefined} className="a-aba">
                {p.rotulo}
              </a>
            ))}
          </div>
        </nav>
      </header>
      <main className="a-main anima-entra" key={pagina}>
        {erroRegras || falhou ? (
          <p className="faixa-erro" role="alert">
            Sem conexão com o sistema agora. Os dados na tela podem estar velhos.{' '}
            <button type="button" className="btn quieto peq" onClick={() => void recarregar()}>
              Tentar de novo
            </button>
          </p>
        ) : null}
        {!props ? (
          !erroRegras && !falhou ? <p className="vazio">Carregando…</p> : null
        ) : pagina === 'calendario' ? (
          <CalendarioAdm {...props} />
        ) : pagina === 'solicitacoes' ? (
          <SolicitacoesAdm {...props} />
        ) : pagina === 'pessoas' ? (
          <Pessoas {...props} recarregar={recarregar} avisar={avisar} />
        ) : (
          <Noticias eu={eu} moradores={moradores} avisar={avisar} />
        )}
      </main>
      {aviso}
    </div>
  )
}

export type PropsPagina = {
  itens: Solicitacao[]
  servicos: ServicoDef[]
  moradores: Morador[]
  eu: MembroEquipe
  agora: string
  f: Filtros
  setF: (f: Filtros) => void
  atualizar: (id: string, m: { status?: Solicitacao['status']; nota?: string; pago?: boolean }) => Promise<boolean>
  /** Algum serviço cobra? Sem isso, tudo de pagamento some. */
  cobra: boolean
}
