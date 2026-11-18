/* =============================================================================
   Notícias (permissão "noticias"). Três abas:
     1. Avisos do app: os avisos e as perguntas frequentes da aba Notificações do morador, direto no
        centro (clicar no cartão abre a edição ali mesmo), com a PRÉVIA ao lado (o mesmo componente que
        o morador vê, num quadro de celular). Embaixo, os e-mails enviados e agendados.
     2. E-mails: escrever um e-mail para todos os moradores com e-mail ou para alguns (atalhos por
        andar, por vaga de garagem e por quem ainda não ativou o acesso), mandar agora, agendar ou
        repetir (todo dia, toda semana, todo mês).
     3. Modelos: textos prontos com {{nome}}, {{apto}} e {{condominio}} (já vêm dois: aviso de
        denúncia e encomenda na portaria).
   Na demonstração nenhum e-mail sai: o envio fica registrado como enviado.
   ============================================================================= */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { NOME_CONDOMINIO } from '../config'
import { api } from '../dados/api'
import { bate, mensagem } from '../regras'
import type { Aviso, DadosAviso, Envio, MembroEquipe, Modelo, Morador, NovoEnvio, Recorrencia } from '../tipos'
import { Abas, Campo, Info, Janela, Tabela, useLembrar, type Coluna } from '../ui'
import { Notificacoes } from '../morador/Notificacoes'

type Avisar = (t: string, erro?: boolean) => void

export function Noticias({ moradores, avisar }: { eu: MembroEquipe; moradores: Morador[]; avisar: Avisar }) {
  const [aba, setAba] = useLembrar<'app' | 'emails' | 'modelos'>('condominio:adm:noticias:aba', 'app')
  return (
    <>
      <Abas
        rotulo="Notícias"
        valor={aba}
        mudar={setAba}
        opcoes={[
          { valor: 'app', rotulo: 'Avisos do app' },
          { valor: 'emails', rotulo: 'E-mails' },
          { valor: 'modelos', rotulo: 'Modelos' },
        ]}
      />
      <div className="anima-entra a-pilha" key={aba}>
        {aba === 'app' ? <AvisosApp avisar={avisar} /> : aba === 'emails' ? <Emails moradores={moradores} avisar={avisar} /> : <Modelos avisar={avisar} />}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ avisos do app + prévia */

const ordenar = (lista: Aviso[]) =>
  [...lista].sort((x, y) => Number(y.tipo === 'aviso') - Number(x.tipo === 'aviso') || Number(y.fixado) - Number(x.fixado) || x.ordem - y.ordem || y.atualizado_em.localeCompare(x.atualizado_em))

type EdicaoAviso = { id: string | null; dados: DadosAviso }

function AvisosApp({ avisar }: { avisar: Avisar }) {
  const [lista, setLista] = useState<Aviso[] | null>(null)
  const [edicao, setEdicao] = useState<EdicaoAviso | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      setLista(await api.listaAvisos())
    } catch (e) {
      avisar(mensagem(e), true)
      setLista([])
    }
  }, [avisar])
  useEffect(() => {
    void carregar()
  }, [carregar])

  // Prévia: o que o morador veria se o que está sendo escrito fosse salvo agora.
  const previa = useMemo(() => {
    const base = (lista ?? []).filter((a) => a.id !== edicao?.id)
    const comRascunho = edicao ? [...base, { id: edicao.id ?? 'novo', ...edicao.dados, atualizado_em: new Date().toISOString() }] : base
    return ordenar(comRascunho.filter((a) => a.publicado && a.titulo.trim() && a.texto.trim()))
  }, [lista, edicao])

  async function salvar() {
    if (!edicao) return
    if (edicao.dados.titulo.trim().length < 2 || !edicao.dados.texto.trim()) {
      avisar('Escreva o título e o texto.', true)
      return
    }
    setSalvando(true)
    try {
      await api.salvarAviso(edicao.id, edicao.dados)
      avisar(edicao.dados.publicado ? 'Publicado. Os moradores já veem.' : 'Rascunho salvo (os moradores não veem).')
      setEdicao(null)
      await carregar()
    } catch (e) {
      avisar(mensagem(e), true)
    } finally {
      setSalvando(false)
    }
  }

  async function apagar(id: string) {
    const a = lista?.find((x) => x.id === id)
    if (!a || !confirm(`Apagar "${a.titulo}"?`)) return
    try {
      await api.apagarAviso(id)
      setEdicao(null)
      await carregar()
    } catch (e) {
      avisar(mensagem(e), true)
    }
  }

  const novo = (tipo: 'aviso' | 'faq') =>
    setEdicao({ id: null, dados: { tipo, titulo: '', texto: '', fixado: false, publicado: true, ordem: tipo === 'faq' ? (lista ?? []).filter((x) => x.tipo === 'faq').length + 1 : 0 } })

  /** O cartão aberto para edição (no lugar do cartão, ou no topo da seção quando é novo). */
  const editor = (e: EdicaoAviso) => (
    <form
      className="a-aviso-editor anima-entra"
      onSubmit={(ev) => {
        ev.preventDefault()
        void salvar()
      }}
    >
      <Campo rotulo={e.dados.tipo === 'aviso' ? 'Título' : 'Pergunta'}>
        {(p) => <input {...p} autoFocus maxLength={120} value={e.dados.titulo} onChange={(ev) => setEdicao({ ...e, dados: { ...e.dados, titulo: ev.target.value } })} />}
      </Campo>
      <Campo rotulo={e.dados.tipo === 'aviso' ? 'Texto' : 'Resposta'}>
        {(p) => <textarea {...p} rows={5} maxLength={4000} value={e.dados.texto} onChange={(ev) => setEdicao({ ...e, dados: { ...e.dados, texto: ev.target.value } })} />}
      </Campo>
      <div className="a-aviso-opcoes">
        {e.dados.tipo === 'aviso' ? (
          <label className="a-check">
            <input type="checkbox" checked={e.dados.fixado} onChange={(ev) => setEdicao({ ...e, dados: { ...e.dados, fixado: ev.target.checked } })} /> Fixar no topo
          </label>
        ) : (
          <label className="a-check">
            Posição <input className="entrada a-ordem" type="number" min={0} max={99} value={e.dados.ordem} onChange={(ev) => setEdicao({ ...e, dados: { ...e.dados, ordem: Number(ev.target.value) || 0 } })} />
          </label>
        )}
        <label className="a-check">
          <input type="checkbox" checked={e.dados.publicado} onChange={(ev) => setEdicao({ ...e, dados: { ...e.dados, publicado: ev.target.checked } })} /> Publicado
          <Info texto="Desmarcado = rascunho: só a equipe vê." />
        </label>
      </div>
      <div className="a-botoes">
        <button className="btn primario" disabled={salvando}>
          <Save size={16} strokeWidth={1.5} aria-hidden="true" /> {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="btn quieto" onClick={() => setEdicao(null)}>
          Cancelar
        </button>
        {e.id ? (
          <button type="button" className="btn quieto perigo a-direita" onClick={() => void apagar(e.id!)}>
            <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" /> Apagar
          </button>
        ) : null}
      </div>
    </form>
  )

  return (
    <>
      <div className="a-avisos">
        <section className="cartao a-avisos-centro" aria-label="Avisos e perguntas frequentes do app">
          <div className="a-avisos-topo">
            <h2>Avisos do app</h2>
            <div className="a-botoes">
              <button type="button" className="btn primario" onClick={() => novo('aviso')}>
                <Plus size={16} strokeWidth={1.5} aria-hidden="true" /> Aviso
              </button>
              <button type="button" className="btn" onClick={() => novo('faq')}>
                <Plus size={16} strokeWidth={1.5} aria-hidden="true" /> Pergunta frequente
              </button>
            </div>
          </div>
          {!lista ? (
            <p className="vazio">Carregando…</p>
          ) : (
            (['aviso', 'faq'] as const).map((tipo) => {
              const itens = ordenar(lista.filter((a) => a.tipo === tipo))
              return (
                <div key={tipo} className="a-avisos-grupo">
                  <h3 className="a-sub">
                    {tipo === 'aviso' ? 'Avisos' : 'Perguntas frequentes'} <span className="apagado num">{itens.length}</span>
                  </h3>
                  {edicao && !edicao.id && edicao.dados.tipo === tipo ? editor(edicao) : null}
                  <ul className="a-cartoes">
                    {itens.map((a) =>
                      edicao?.id === a.id ? (
                        <li key={a.id}>{editor(edicao)}</li>
                      ) : (
                        <li key={a.id}>
                          <button type="button" className="a-aviso-cartao" onClick={() => setEdicao({ id: a.id, dados: { tipo: a.tipo, titulo: a.titulo, texto: a.texto, fixado: a.fixado, publicado: a.publicado, ordem: a.ordem } })}>
                            <span className="a-linha">
                              <strong>{a.titulo}</strong>
                              {a.fixado ? <span className="perm">fixado</span> : null}
                              {!a.publicado ? <span className="perm rascunho">rascunho</span> : null}
                            </span>
                            <span className="sec peq a-aviso-resumo">{a.texto}</span>
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                  {!itens.length && !(edicao && !edicao.id && edicao.dados.tipo === tipo) ? <p className="apagado peq">Nenhum ainda.</p> : null}
                </div>
              )
            })
          )}
        </section>

        <section className="a-previa" aria-label="Prévia do app do morador">
          <p className="sec peq">
            Prévia: como o morador vê <Info texto="Mostra o que fica publicado, já com o que você está escrevendo. Rascunho não aparece." />
          </p>
          <div className="previa-celular">
            <div className="previa-tela">
              <Notificacoes avisos={previa} />
            </div>
          </div>
        </section>
      </div>
      <EnviosTabela avisar={avisar} />
    </>
  )
}

/* ------------------------------------------------------------------ escrever um e-mail */

const REPETE: { valor: '' | Recorrencia; rotulo: string }[] = [
  { valor: '', rotulo: 'Não repete' },
  { valor: 'diaria', rotulo: 'Todo dia' },
  { valor: 'semanal', rotulo: 'Toda semana' },
  { valor: 'mensal', rotulo: 'Todo mês' },
]

/** Andar pelo número do apartamento (101 = 1º, 1204 = 12º, B-203 = 2º); casa ou número curto = sem andar. */
function andarDe(apto: string): number | null {
  const n = apto.replace(/\D/g, '')
  return n.length >= 3 ? Number(n.slice(0, -2)) : null
}

/** Troca os campos do modelo para a prévia (o servidor faz o mesmo para cada morador). */
const preencher = (t: string, nome: string, apto: string) => t.replaceAll('{{nome}}', nome.split(' ')[0]).replaceAll('{{apto}}', apto).replaceAll('{{condominio}}', NOME_CONDOMINIO || 'condomínio')

/**
 * Escrever e mandar um e-mail. Com "destino" fixo (vindo do morador) não pergunta para quem; sem ele,
 * escolhe entre todos com e-mail e alguns. "simples" esconde agendamento e repetição.
 */
export function ComporEmail({ destino, paraRotulo, moradores = [], enviado, avisar, simples }: {
  destino?: NovoEnvio['destino']
  paraRotulo?: string
  moradores?: Morador[]
  enviado: (texto: string) => void
  avisar: Avisar
  simples?: boolean
}) {
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [assunto, setAssunto] = useState('')
  const [corpo, setCorpo] = useState('')
  const [para, setPara] = useState<'todos' | 'alguns'>('todos')
  const [ids, setIds] = useState<string[]>([])
  const [busca, setBusca] = useState('')
  const [quando, setQuando] = useState<'agora' | 'agendar'>('agora')
  const [data, setData] = useState('')
  const [repete, setRepete] = useState<'' | Recorrencia>('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    api.modelos().then(setModelos, () => setModelos([]))
  }, [])

  const comEmail = moradores.filter((m) => m.ativo && m.email)
  const exemplo = destino?.ids?.length ? moradores.find((m) => m.id === destino.ids![0]) : (para === 'alguns' ? comEmail.find((m) => ids.includes(m.id)) : comEmail[0])
  const nomeEx = exemplo?.nome ?? 'Luíza Prado'
  const aptoEx = exemplo?.apto ?? '101'
  // Atalhos de grupo: um andar, quem tem vaga, quem ainda não ativou o acesso (recebeu o convite e não criou a senha).
  const [grupo, setGrupo] = useState('')
  const andares = useMemo(() => [...new Set(comEmail.map((m) => andarDe(m.apto)).filter((n): n is number => n !== null))].sort((a, b) => a - b), [comEmail])
  const noGrupo = (m: Morador) =>
    !grupo || (grupo === 'vaga' ? !!m.vaga : grupo === 'sem_acesso' ? !m.senha_criada : andarDe(m.apto) === Number(grupo.slice(6)))
  const opcoes = comEmail.filter((m) => noGrupo(m) && (!busca.trim() || bate(`${m.apto} ${m.nome}`, busca)))

  async function enviar() {
    setErro(null)
    if (!assunto.trim() || !corpo.trim()) return setErro('Escreva o assunto e a mensagem.')
    if (!destino && para === 'alguns' && !ids.length) return setErro('Escolha pelo menos um morador.')
    if (quando === 'agendar' && !data) return setErro('Escolha a data e a hora do envio.')
    setEnviando(true)
    try {
      const r = await api.criarEnvio({
        assunto,
        corpo,
        destino: destino ?? (para === 'todos' ? { todos: true } : { ids }),
        quando: quando === 'agendar' ? new Date(data).toISOString() : null,
        recorrencia: repete || null,
      })
      enviado(quando === 'agora' ? `E-mail enviado para ${r.destinatarios} morador(es).` : `Envio agendado para ${r.destinatarios} morador(es).`)
      setAssunto('')
      setCorpo('')
      setIds([])
      setRepete('')
      setQuando('agora')
    } catch (e) {
      setErro(mensagem(e))
    } finally {
      setEnviando(false)
    }
  }

  async function salvarModelo() {
    const nome = prompt('Nome do modelo (ex.: Aviso de manutenção):')
    if (!nome?.trim()) return
    try {
      await api.salvarModelo(null, { nome, assunto, corpo })
      setModelos(await api.modelos())
      avisar('Modelo salvo.')
    } catch (e) {
      avisar(mensagem(e), true)
    }
  }

  return (
    <div className="a-compor">
      <div className="janela-form">
        <Campo rotulo="Começar de um modelo">
          {(p) => (
            <select
              {...p}
              defaultValue=""
              onChange={(e) => {
                const m = modelos.find((x) => x.id === e.target.value)
                if (m) {
                  setAssunto(m.assunto)
                  setCorpo(m.corpo)
                }
              }}
            >
              <option value="">Em branco</option>
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          )}
        </Campo>
        {destino ? (
          <p className="peq">
            <span className="apagado">Para:</span> {paraRotulo}
          </p>
        ) : (
          <div className="campo">
            <span className="rotulo">Para</span>
            <label className="marcar">
              <input type="radio" name="para" checked={para === 'todos'} onChange={() => setPara('todos')} />
              <span>Todos os moradores com e-mail ({comEmail.length})</span>
            </label>
            <label className="marcar">
              <input type="radio" name="para" checked={para === 'alguns'} onChange={() => setPara('alguns')} />
              <span>Escolher moradores ({ids.length} escolhidos)</span>
            </label>
            {para === 'alguns' ? (
              <div className="a-escolha">
                <div className="a-chips-grupo" role="group" aria-label="Mostrar só um grupo">
                  {[
                    { v: '', r: 'Todos' },
                    ...andares.map((n) => ({ v: `andar:${n}`, r: `${n}º andar` })),
                    { v: 'vaga', r: 'Com vaga de garagem' },
                    { v: 'sem_acesso', r: 'Ainda não ativaram o acesso' },
                  ].map((g) => (
                    <button key={g.v} type="button" className="a-chip-grupo" aria-pressed={grupo === g.v} onClick={() => setGrupo(g.v)}>
                      {g.r}
                    </button>
                  ))}
                </div>
                <input className="entrada" type="search" placeholder="Buscar apto ou nome" aria-label="Buscar morador" value={busca} onChange={(e) => setBusca(e.target.value)} />
                <div className="a-botoes">
                  <button type="button" className="btn peq" disabled={!opcoes.length} onClick={() => setIds([...new Set([...ids, ...opcoes.map((m) => m.id)])])}>
                    Marcar todos da lista ({opcoes.length})
                  </button>
                  <button type="button" className="btn quieto peq" disabled={!ids.length} onClick={() => setIds(ids.filter((id) => !opcoes.some((m) => m.id === id)))}>
                    Desmarcar os da lista
                  </button>
                </div>
                <div className="a-escolha-lista">
                  {opcoes.map((m) => (
                    <label key={m.id} className="a-check">
                      <input type="checkbox" checked={ids.includes(m.id)} onChange={(e) => setIds(e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id))} /> {m.apto} · {m.nome}
                    </label>
                  ))}
                  {!opcoes.length ? <p className="apagado peq">Ninguém com e-mail nessa busca.</p> : null}
                </div>
              </div>
            ) : null}
            <p className="apagado peq">Morador que entra só com código não tem e-mail e não recebe.</p>
          </div>
        )}
        <Campo rotulo="Assunto">{(p) => <input {...p} maxLength={150} value={assunto} onChange={(e) => setAssunto(e.target.value)} />}</Campo>
        <Campo rotulo="Mensagem" dica="{{nome}}, {{apto}} e {{condominio}} viram os dados de cada morador">
          {(p) => <textarea {...p} rows={8} maxLength={5000} value={corpo} onChange={(e) => setCorpo(e.target.value)} />}
        </Campo>
        {!simples ? (
          <div className="m-duas">
            <Campo rotulo="Quando">
              {(p) => (
                <select {...p} value={quando} onChange={(e) => setQuando(e.target.value as 'agora' | 'agendar')}>
                  <option value="agora">Agora</option>
                  <option value="agendar">Agendar</option>
                </select>
              )}
            </Campo>
            <Campo rotulo="Repetir">
              {(p) => (
                <select {...p} value={repete} onChange={(e) => setRepete(e.target.value as '' | Recorrencia)}>
                  {REPETE.map((r) => (
                    <option key={r.valor} value={r.valor}>
                      {r.rotulo}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
          </div>
        ) : null}
        {!simples && quando === 'agendar' ? <Campo rotulo="Data e hora do envio">{(p) => <input {...p} type="datetime-local" value={data} onChange={(e) => setData(e.target.value)} />}</Campo> : null}
        {erro ? (
          <p className="faixa-erro" role="alert">
            {erro}
          </p>
        ) : null}
        <div className="a-botoes">
          <button type="button" className="btn primario" disabled={enviando} onClick={() => void enviar()}>
            {enviando ? 'Enviando…' : quando === 'agora' ? 'Enviar' : 'Agendar'}
          </button>
          <button type="button" className="btn quieto" disabled={!assunto.trim() || !corpo.trim()} onClick={() => void salvarModelo()}>
            Salvar como modelo
          </button>
        </div>
      </div>
      <div className="a-email-previa" aria-label="Prévia do e-mail">
        <p className="sec peq">Prévia ({nomeEx.split(' ')[0]}, apto {aptoEx})</p>
        <div className="cartao a-email">
          <strong>{preencher(assunto, nomeEx, aptoEx) || 'Assunto'}</strong>
          <p>{preencher(corpo, nomeEx, aptoEx) || 'A mensagem aparece aqui.'}</p>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ e-mails */

function situacaoEnvio(e: Envio): string {
  if (e.cancelado) return 'Cancelado'
  if (e.ativo && e.recorrencia) return 'Repetindo'
  if (e.ativo) return 'Agendado'
  return 'Enviado'
}

/** Aba E-mails: só escrever e mandar. O que saiu e o agendado ficam em Avisos do app. */
function Emails({ moradores, avisar }: { moradores: Morador[]; avisar: Avisar }) {
  return (
    <section className="cartao a-bloco" aria-label="Escrever e-mail">
      <h2>Escrever e-mail</h2>
      <ComporEmail moradores={moradores} avisar={avisar} enviado={(t) => avisar(`${t} Acompanhe em Avisos do app.`)} />
    </section>
  )
}

/** E-mails enviados e agendados (mostrados em Avisos do app). */
function EnviosTabela({ avisar }: { avisar: Avisar }) {
  const [envios, setEnvios] = useState<Envio[] | null>(null)
  const carregar = useCallback(async () => {
    try {
      setEnvios(await api.envios())
    } catch (e) {
      avisar(mensagem(e), true)
      setEnvios([])
    }
  }, [avisar])
  useEffect(() => {
    void carregar()
  }, [carregar])

  const colunas: Coluna<Envio>[] = [
    { chave: 'assunto', rotulo: 'Assunto', valor: (e) => e.assunto },
    { chave: 'para', rotulo: 'Para', valor: (e) => e.destinatarios, numerico: true, mostrar: (e) => <span className="num">{e.destino.todos ? `todos (${e.destinatarios})` : e.destinatarios}</span> },
    { chave: 'quando', rotulo: 'Próximo / último', valor: (e) => (e.ativo ? e.quando : (e.ultimo_envio ?? e.quando)), numerico: true, mostrar: (e) => <span className="num apagado">{new Date(e.ativo ? e.quando : (e.ultimo_envio ?? e.quando)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> },
    { chave: 'repete', rotulo: 'Repete', valor: (e) => REPETE.find((r) => r.valor === (e.recorrencia ?? ''))!.rotulo },
    { chave: 'situacao', rotulo: 'Situação', valor: (e) => situacaoEnvio(e), mostrar: (e) => <span className={`selo ${e.cancelado ? 'nao' : e.ativo ? 'espera' : 'fim'}`}>{situacaoEnvio(e)}</span> },
    { chave: 'enviados', rotulo: 'Entregues', valor: (e) => e.total_enviados, numerico: true, dir: true, mostrar: (e) => <span className="num">{e.total_enviados}{e.falhas ? <span className="pend"> {e.falhas} falha(s)</span> : null}</span> },
    {
      chave: 'acao',
      rotulo: '',
      valor: () => '',
      mostrar: (e) =>
        e.ativo ? (
          <button
            type="button"
            className="btn quieto peq perigo"
            onClick={(ev) => {
              ev.stopPropagation()
              if (!confirm(`Cancelar "${e.assunto}"?`)) return
              void api.cancelarEnvio(e.id).then(carregar, (err) => avisar(mensagem(err), true))
            }}
          >
            Cancelar
          </button>
        ) : null,
    },
  ]

  return (
    <section className="cartao a-tabela" aria-label="E-mails enviados e agendados">
      <div className="a-tabela-topo">
        <h2>E-mails enviados e agendados</h2>
        <p className="apagado peq">mais novos primeiro · escrever um novo em E-mails</p>
      </div>
      {!envios ? <p className="vazio">Carregando…</p> : envios.length ? <Tabela colunas={colunas} linhas={envios} chaveLinha={(e) => e.id} legenda="E-mails enviados e agendados" /> : <p className="vazio">Nenhum e-mail ainda.</p>}
    </section>
  )
}

/* ------------------------------------------------------------------ modelos */

function Modelos({ avisar }: { avisar: Avisar }) {
  const [lista, setLista] = useState<Modelo[] | null>(null)
  const [edicao, setEdicao] = useState<{ id: string | null; m: Omit<Modelo, 'id'> } | null>(null)
  const carregar = useCallback(async () => {
    try {
      setLista(await api.modelos())
    } catch (e) {
      avisar(mensagem(e), true)
      setLista([])
    }
  }, [avisar])
  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvar() {
    if (!edicao) return
    try {
      await api.salvarModelo(edicao.id, edicao.m)
      setEdicao(null)
      avisar('Modelo salvo.')
      await carregar()
    } catch (e) {
      avisar(mensagem(e), true)
    }
  }

  return (
    <section className="cartao a-bloco" aria-label="Modelos">
      <div className="a-botoes">
        <button type="button" className="btn primario" onClick={() => setEdicao({ id: null, m: { nome: '', assunto: '', corpo: '' } })}>
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" /> Novo modelo
        </button>
      </div>
      {!lista ? (
        <p className="vazio">Carregando…</p>
      ) : (
        <ul className="a-modelos">
          {lista.map((m) => (
            <li key={m.id} className="cartao">
              <strong>{m.nome}</strong>
              <span className="sec peq">{m.assunto}</span>
              <p className="apagado peq a-modelo-texto">{m.corpo}</p>
              <div className="a-botoes">
                <button type="button" className="btn peq" onClick={() => setEdicao({ id: m.id, m: { nome: m.nome, assunto: m.assunto, corpo: m.corpo } })}>
                  Editar
                </button>
                <button
                  type="button"
                  className="btn quieto peq perigo"
                  onClick={() => {
                    if (confirm(`Apagar o modelo "${m.nome}"?`)) void api.apagarModelo(m.id).then(carregar, (e) => avisar(mensagem(e), true))
                  }}
                >
                  Apagar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Janela
        aberta={!!edicao}
        titulo={edicao?.id ? 'Editar modelo' : 'Novo modelo'}
        fechar={() => setEdicao(null)}
        pe={
          <>
            <button type="button" className="btn quieto" onClick={() => setEdicao(null)}>
              Cancelar
            </button>
            <button type="button" className="btn primario" onClick={() => void salvar()}>
              Salvar
            </button>
          </>
        }
      >
        {edicao ? (
          <>
            <Campo rotulo="Nome do modelo">{(p) => <input {...p} data-foco maxLength={60} value={edicao.m.nome} onChange={(e) => setEdicao({ ...edicao, m: { ...edicao.m, nome: e.target.value } })} />}</Campo>
            <Campo rotulo="Assunto">{(p) => <input {...p} maxLength={150} value={edicao.m.assunto} onChange={(e) => setEdicao({ ...edicao, m: { ...edicao.m, assunto: e.target.value } })} />}</Campo>
            <Campo rotulo="Mensagem" dica="{{nome}}, {{apto}} e {{condominio}} viram os dados de cada morador">
              {(p) => <textarea {...p} rows={10} maxLength={5000} value={edicao.m.corpo} onChange={(e) => setEdicao({ ...edicao, m: { ...edicao.m, corpo: e.target.value } })} />}
            </Campo>
          </>
        ) : null}
      </Janela>
    </section>
  )
}
