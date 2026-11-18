/* =============================================================================
   Lado do MORADOR (celular). Duas abas:
     1. Calendário: o mês com as minhas reservas; no dia escolhido, os meus horários e os horários
        livres e ocupados da lavagem e da diária (ocupado nunca diz de quem). Tocar num horário
        livre leva direto para reservar.
     2. Solicitar: escolher o serviço (lavagem e secagem, diária, estacionamento, denúncia),
        preencher e enviar; embaixo, "Acompanhar" com tudo o que eu pedi e a resposta da equipe.
   Entrada: apartamento + código de acesso (a portaria entrega). O celular lembra.
   ============================================================================= */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Brush, Car, CalendarDays, ChevronLeft, ChevronRight, LogOut, MessageSquareWarning, Plus, Volume2, VolumeX, WashingMachine } from 'lucide-react'
import { NOME_CONDOMINIO, type Servico, type ServicoDef } from '../config'
import { api, useRegras } from '../dados/api'
import { MORADORES_DEMO, restaurarDemo } from '../dados/demo'
import { agoraLocal, diaCurto, diaDe, diasReservaveis, especialDo, gradeDoMes, mensagem, mesTitulo, noDia, periodosDoDia, somaDias, somaMeses } from '../regras'
import type { Aviso, Credencial, DiaEspecial, Ocupado, Solicitacao } from '../tipos'
import { Notificacoes, type Resposta } from './Notificacoes'
import { Abas, Apto, Campo, Marca, Ponto, useAviso, useLembrar } from '../ui'
import { Acompanhar, RESUMO, Solicitar } from './Solicitar'
import { ligarSom, somLigado } from '../som'

export type Preselecao = { servico: Servico; inicio: string } | null

export function MoradorApp() {
  const [cred, setCred] = useLembrar<Credencial | null>('condominio:morador', null)
  const [aviso, avisar] = useAviso()
  const [conferindo, setConferindo] = useState(!cred)
  // Sem credencial guardada, pode haver uma sessão por e-mail aberta (ex.: acabou de criar a senha).
  useEffect(() => {
    if (cred) return
    api
      .sessaoMorador()
      .then((c) => c && setCred(c))
      .catch(() => undefined)
      .finally(() => setConferindo(false))
    // só ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const sair = useCallback(
    async (motivo?: string) => {
      if (cred?.email) await api.sairMorador()
      setCred(null)
      if (motivo) avisar(motivo, true)
    },
    [cred, setCred, avisar],
  )
  return (
    <div className="m-app">
      {cred ? <Casa cred={cred} sair={sair} avisar={avisar} /> : conferindo ? <p className="vazio">Carregando…</p> : <Entrar entrou={setCred} />}
      {aviso}
    </div>
  )
}

/* ------------------------------------------------------------------ entrar */

/** Entrada: e-mail e senha (quem recebeu o convite) ou apartamento e código (quem não usa e-mail). */
function Entrar({ entrou }: { entrou: (c: Credencial) => void }) {
  const { servicos } = useRegras()
  const [modo, setModo] = useLembrar<'email' | 'codigo'>('condominio:morador:modo', 'email')
  const [apto, setApto] = useState('')
  const [codigo, setCodigo] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [esqueci, setEsqueci] = useState<'' | 'pedindo' | 'enviado'>('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (modo === 'codigo' && (!apto.trim() || !codigo.trim())) return setErro('Preencha o apartamento e o código.')
    if (modo === 'email' && (!email.trim() || (!senha && esqueci !== 'pedindo'))) return setErro(esqueci === 'pedindo' ? 'Digite o seu e-mail.' : 'Preencha o e-mail e a senha.')
    setEnviando(true)
    try {
      if (modo === 'email' && esqueci === 'pedindo') {
        await api.esqueciSenha(email)
        setEsqueci('enviado')
      } else if (modo === 'email') {
        entrou(await api.entrarEmail(email, senha))
      } else {
        const r = await api.entrar(apto, codigo)
        entrou({ apto: r.apto, codigo: codigo.trim().toUpperCase(), nome: r.nome })
      }
    } catch (err) {
      setErro(mensagem(err))
    } finally {
      setEnviando(false)
    }
  }

  const ativos = SERVICOS_ENTRADA.filter(([chave]) => !servicos || servicos.some((s) => s.chave === chave))
  return (
    <main className="m-entrar anima-entra">
      <header className="entrada-marca">
        <Marca />
        <span>
          <strong>Condomínio</strong>
          <span className="apagado peq">{NOME_CONDOMINIO || 'Condomínio'}</span>
        </span>
      </header>
      <div className="entrada-texto">
        <h1>Reservas e pedidos do condomínio</h1>
        <p className="sec">Tudo o que antes passava pelo grupo, num lugar só, com a resposta da administração.</p>
      </div>
      <ul className="entrada-servicos" aria-label="O que dá para fazer aqui">
        {ativos.map(([chave, nome, Icone]) => (
          <li key={chave}>
            <Icone size={18} strokeWidth={1.5} aria-hidden="true" />
            <span>
              <strong>{nome}</strong>
              <span className="apagado peq">{RESUMO[chave]}</span>
            </span>
          </li>
        ))}
      </ul>
      <form className="cartao m-form" onSubmit={enviar} noValidate>
        <Abas
          rotulo="Como entrar"
          valor={modo}
          mudar={(m) => {
            setModo(m)
            setErro(null)
            setEsqueci('')
          }}
          opcoes={[
            { valor: 'email', rotulo: 'E-mail' },
            { valor: 'codigo', rotulo: 'Código' },
          ]}
        />
        {modo === 'email' ? (
          esqueci === 'enviado' ? (
            <div className="nota">
              <p>Se o e-mail estiver cadastrado, o link para criar uma senha nova chega em instantes. Confira também a caixa de spam.</p>
              <button type="button" className="btn quieto peq" onClick={() => setEsqueci('')}>
                Voltar para entrar
              </button>
            </div>
          ) : (
            <>
              <Campo rotulo="E-mail">{(p) => <input {...p} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Campo>
              {esqueci === 'pedindo' ? (
                <p className="sec peq">Vamos mandar um link para criar uma senha nova.</p>
              ) : (
                <Campo rotulo="Senha">{(p) => <input {...p} type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />}</Campo>
              )}
            </>
          )
        ) : (
          <>
            <Campo rotulo="Apartamento">
              {(p) => (
                <span className="campo-apto">
                  <span aria-hidden="true">AP</span>
                  <input {...p} inputMode="text" autoComplete="off" autoCapitalize="characters" placeholder="101" maxLength={10} value={apto} onChange={(e) => setApto(e.target.value.toUpperCase())} />
                </span>
              )}
            </Campo>
            <Campo rotulo="Código de acesso" dica="As 6 letras e números que a portaria entregou">
              {(p) => (
                <input {...p} className="campo-codigo" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={6} placeholder="••••••" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
              )}
            </Campo>
          </>
        )}
        {erro ? (
          <p className="faixa-erro" role="alert">
            {erro}
          </p>
        ) : null}
        {esqueci !== 'enviado' ? (
          <button className="btn primario grande" disabled={enviando}>
            {enviando ? 'Enviando…' : esqueci === 'pedindo' ? 'Mandar o link' : 'Entrar'}
          </button>
        ) : null}
        {modo === 'email' && esqueci === '' ? (
          <button type="button" className="btn quieto peq" onClick={() => setEsqueci('pedindo')}>
            Esqueci a senha
          </button>
        ) : modo === 'email' && esqueci === 'pedindo' ? (
          <button type="button" className="btn quieto peq" onClick={() => setEsqueci('')}>
            Voltar
          </button>
        ) : null}
      </form>
      <p className="apagado peq m-rodape">{modo === 'email' ? 'Ainda não recebeu o convite? Peça na portaria.' : 'Sem código? Peça na portaria.'}</p>
      {api.modo === 'demo' ? (
        <DemoEntrar
          modo={modo}
          porEmail={(em, se) => {
            setEmail(em)
            setSenha(se)
          }}
          porCodigo={(a, c) => {
            setApto(a)
            setCodigo(c)
          }}
        />
      ) : null}
      <p className="peq m-rodape">
        <a href="#/adm">Acesso da equipe</a>
      </p>
    </main>
  )
}

/** Os serviços mostrados na entrada (só informação, não são botões). Os desligados não aparecem. */
const SERVICOS_ENTRADA: [Servico, string, typeof Car][] = [
  ['lavagem', 'Lavagem e secagem', WashingMachine],
  ['diaria', 'Diária', Brush],
  ['estacionamento', 'Estacionamento', Car],
  ['denuncia', 'Denúncia', MessageSquareWarning],
]

/** Só no modo demonstração: moradores fictícios para entrar com um toque. */
function DemoEntrar({ modo, porEmail, porCodigo }: { modo: 'email' | 'codigo'; porEmail: (email: string, senha: string) => void; porCodigo: (apto: string, codigo: string) => void }) {
  const lista = MORADORES_DEMO.filter((m) => (modo === 'email' ? m.email && m.senha : m.codigo)).slice(0, 4)
  return (
    <section className="cartao m-demo">
      <h2>Demonstração</h2>
      <p className="sec peq">Dados fictícios guardados só neste navegador. Toque num morador para preencher.</p>
      <div className="m-demo-lista">
        {lista.map((m) => (
          <button key={m.apto} type="button" className="btn" onClick={() => (modo === 'email' ? porEmail(m.email!, m.senha!) : porCodigo(m.apto, m.codigo!))}>
            <Apto apto={m.apto} /> {m.nome.split(' ')[0]}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn quieto peq"
        onClick={() => {
          restaurarDemo()
          location.reload()
        }}
      >
        Restaurar dados de exemplo
      </button>
    </section>
  )
}

/* ------------------------------------------------------------------ depois de entrar */

function Casa({ cred, sair, avisar }: { cred: Credencial; sair: (motivo?: string) => Promise<void>; avisar: (t: string, erro?: boolean) => void }) {
  const { servicos, erro: erroRegras } = useRegras()
  const [aba, setAba] = useLembrar<'calendario' | 'solicitar' | 'notificacoes'>('condominio:morador:aba', 'calendario')
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [tokens, setTokens] = useLembrar<string[]>('condominio:tokens', [])
  const [minhas, setMinhas] = useState<Solicitacao[] | null>(null)
  const [mes, setMes] = useState(() => `${agoraLocal().slice(0, 7)}-01`)
  const [ocupacao, setOcupacao] = useState<Ocupado[]>([])
  const [especiais, setEspeciais] = useState<DiaEspecial[]>([])
  const [presel, setPresel] = useState<Preselecao>(null)
  const [falhou, setFalhou] = useState(false)
  const [som, setSom] = useState(somLigado)

  const grade = useMemo(() => gradeDoMes(mes), [mes])

  /** Recarrega o que é meu e a ocupação do mês na tela. Código trocado pela portaria = sai. */
  const recarregar = useCallback(async () => {
    try {
      // Feriados: a grade do mês e, se passar dela, até o fim do horizonte das reservas.
      const fimFeriados = [grade[41], somaDias(diaDe(agoraLocal()), 15)].sort()[1]
      const [m, o, f, a] = await Promise.all([api.minhas(cred, tokens), api.ocupacao(cred, grade[0], grade[41]), api.feriados(grade[0], fimFeriados), api.avisos(cred)])
      setAvisos(a)
      setMinhas(m)
      setOcupacao(o)
      setEspeciais(f)
      setFalhou(false)
    } catch (e) {
      const codigo = e instanceof Error ? e.message : ''
      if (codigo === 'codigo_invalido') void sair('Seu código mudou ou foi desativado. Peça o novo na portaria.')
      else if (codigo === 'sem_cadastro') void sair('Seu acesso foi desativado. Fale com a portaria.')
      else setFalhou(true)
    }
  }, [cred, tokens, grade, sair])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  // Últimas respostas da equipe aos meus pedidos (vão para a aba Notificações).
  const respostas = useMemo<Resposta[]>(
    () =>
      (minhas ?? [])
        .flatMap((s) => s.historico.filter((h) => h.por_papel !== 'morador' && h.nota).map((h, i) => ({ chave: `${s.id}:${i}`, titulo: `${servicos?.find((x) => x.chave === s.servico)?.nome ?? s.servico} nº ${s.protocolo}`, nota: h.nota!, por: h.por_papel, em: h.em })))
        .sort((x, y) => y.em.localeCompare(x.em))
        .slice(0, 5),
    [minhas, servicos],
  )

  function reservarDoCalendario(p: Preselecao) {
    setPresel(p)
    setAba('solicitar')
  }

  return (
    <>
      <header className="m-topo">
        <div className="m-topo-marca">
          <Marca />
          <strong>Condomínio</strong>
        </div>
        <div className="m-quem">
          <button
            type="button"
            className="btn quieto icone"
            aria-pressed={som}
            aria-label={som ? 'Som de confirmação ligado. Tocar para desligar' : 'Som de confirmação desligado. Tocar para ligar'}
            onClick={() => {
              ligarSom(!som)
              setSom(!som)
            }}
          >
            {som ? <Volume2 size={18} strokeWidth={1.5} aria-hidden="true" /> : <VolumeX size={18} strokeWidth={1.5} aria-hidden="true" />}
          </button>
          <Apto apto={cred.apto} />
          <span className="sec peq m-nome">{cred.nome.split(' ')[0]}</span>
          <button type="button" className="btn quieto icone" aria-label="Sair" onClick={() => void sair()}>
            <LogOut size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav className="m-abas abas" role="tablist" aria-label="Seções">
        <button role="tab" aria-selected={aba === 'calendario'} onClick={() => setAba('calendario')}>
          <CalendarDays size={16} strokeWidth={1.5} aria-hidden="true" /> Calendário
        </button>
        <button role="tab" aria-selected={aba === 'solicitar'} onClick={() => setAba('solicitar')}>
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" /> Solicitar
        </button>
        <button role="tab" aria-selected={aba === 'notificacoes'} onClick={() => setAba('notificacoes')}>
          <Bell size={16} strokeWidth={1.5} aria-hidden="true" /> Notificações
        </button>
      </nav>

      <main className="m-conteudo anima-entra" key={aba}>
        {erroRegras || falhou ? (
          <p className="faixa-erro" role="alert">
            Sem conexão com o sistema agora. <button type="button" className="btn quieto peq" onClick={() => void recarregar()}>Tentar de novo</button>
          </p>
        ) : null}
        {!servicos || !minhas ? (
          !erroRegras && !falhou ? <p className="vazio">Carregando…</p> : null
        ) : aba === 'notificacoes' ? (
          <Notificacoes avisos={avisos} respostas={respostas} />
        ) : aba === 'calendario' ? (
          <CalendarioMorador servicos={servicos} minhas={minhas} ocupacao={ocupacao} especiais={especiais} mes={mes} setMes={setMes} grade={grade} reservar={reservarDoCalendario} />
        ) : (
          <>
            <Solicitar
              abaixo={
                <Acompanhar
                  cred={cred}
                  servicos={servicos}
                  minhas={minhas}
                  mudou={async (texto) => {
                    avisar(texto)
                    await recarregar()
                  }}
                  falhou={(t) => avisar(t, true)}
                />
              }
              cred={cred}
              servicos={servicos}
              minhas={minhas}
              ocupacao={ocupacao}
              especiais={especiais}
              presel={presel}
              limparPresel={() => setPresel(null)}
              irInicio={() => {
                setAba('calendario')
                window.scrollTo({ top: 0 })
              }}
              enviado={async (token) => {
                if (token) setTokens([...tokens, token])
                await recarregar()
              }}
              recarregarOcupacao={recarregar}
            />
          </>
        )}
      </main>
    </>
  )
}

/* ------------------------------------------------------------------ calendário do morador */

function CalendarioMorador({ servicos, minhas, ocupacao, especiais, mes, setMes, grade, reservar }: {
  servicos: ServicoDef[]
  minhas: Solicitacao[]
  ocupacao: Ocupado[]
  especiais: DiaEspecial[]
  mes: string
  setMes: (m: string) => void
  grade: string[]
  reservar: (p: Preselecao) => void
}) {
  const agora = agoraLocal()
  const hoje = diaDe(agora)
  const [dia, setDia] = useState(hoje)
  // As minhas que aparecem no calendário: as que não foram canceladas nem recusadas e têm data.
  const ativas = minhas.filter((s) => s.inicio && s.status !== 'cancelada' && s.status !== 'recusada')
  const doDia = ativas.filter((s) => noDia(s, dia))
  const reservaveis = servicos.filter((s) => s.config.tipo === 'horario' || s.config.tipo === 'periodo')

  return (
    <section className="m-cal" aria-label="Calendário">
      <div className="m-cal-topo">
        <h2>{mesTitulo(mes)}</h2>
        <div className="m-cal-nav">
          <button type="button" className="btn quieto icone" aria-label="Mês anterior" onClick={() => setMes(somaMeses(mes, -1))}>
            <ChevronLeft size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn quieto"
            onClick={() => {
              setMes(`${hoje.slice(0, 7)}-01`)
              setDia(hoje)
            }}
          >
            Hoje
          </button>
          <button type="button" className="btn quieto icone" aria-label="Próximo mês" onClick={() => setMes(somaMeses(mes, 1))}>
            <ChevronRight size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="m-grade" role="grid" aria-label={mesTitulo(mes)}>
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((l, i) => (
          <span key={i} className="m-grade-cab apagado" aria-hidden="true">
            {l}
          </span>
        ))}
        {grade.map((d) => {
          const meus = ativas.filter((s) => noDia(s, d))
          const fora = d.slice(0, 7) !== mes.slice(0, 7)
          const esp = especialDo(d, especiais)
          return (
            <button
              key={d}
              type="button"
              className={`m-dia${fora ? ' fora' : ''}${d === hoje ? ' hoje' : ''}${esp ? ` ${esp.tipo}` : ''}`}
              aria-pressed={d === dia}
              title={esp?.nome}
              aria-label={`${diaCurto(d)}${esp ? `, ${esp.nome}` : ''}${meus.length ? `, ${meus.length} minha${meus.length > 1 ? 's' : ''}` : ''}`}
              onClick={() => setDia(d)}
            >
              <span className="num">{Number(d.slice(8))}</span>
              <span className="m-dia-pontos">
                {meus.slice(0, 3).map((s) => (
                  <Ponto key={s.id} servico={s.servico} />
                ))}
              </span>
            </button>
          )
        })}
      </div>

      <div className="m-dia-painel cartao">
        <h3>{diaCurto(dia)}</h3>
        {especialDo(dia, especiais) ? <p className={`dia-especial ${especialDo(dia, especiais)!.tipo}`}>{especialDo(dia, especiais)!.nome}</p> : null}
        {doDia.length ? (
          <ul className="m-meus">
            {doDia.map((s) => (
              <li key={s.id}>
                <Ponto servico={s.servico} />
                <span>{servicos.find((x) => x.chave === s.servico)?.nome}</span>
                <span className="apagado num">
                  {s.servico === 'estacionamento' ? s.detalhes.placa : `${s.inicio!.slice(11, 16)} às ${s.fim!.slice(11, 16)}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="apagado peq">Nada seu neste dia.</p>
        )}

        {reservaveis.map((sv) => {
          const horarios = periodosDoDia(sv.config, dia, especiais)
          const fechadoFeriado = !horarios.length && periodosDoDia(sv.config, dia).length > 0
          const abre = diasReservaveis(sv.config, hoje, especiais).includes(dia)
          return (
            <div key={sv.chave} className="m-horarios">
              <div className="m-horarios-cab">
                <Ponto servico={sv.chave} /> <strong>{sv.nome}</strong>
              </div>
              {!horarios.length ? (
                <p className="apagado peq">{fechadoFeriado ? 'Fechado: feriado.' : 'Fechado neste dia.'}</p>
              ) : dia < hoje ? (
                <p className="apagado peq">Dia que já passou.</p>
              ) : !abre ? (
                <p className="apagado peq">Reserva abre {sv.config.tipo !== 'pedido' && sv.config.tipo !== 'denuncia' ? sv.config.horizonte : 0} dias antes.</p>
              ) : (
                <div className="m-chips">
                  {horarios.every((h) => h.inicio <= agora) ? <p className="apagado peq">Os horários de hoje já passaram.</p> : null}
                  {horarios.filter((h) => h.inicio > agora).map((h) => {
                    const oc = ocupacao.find((o) => o.servico === sv.chave && o.inicio === h.inicio)
                    if (oc?.minha) return <span key={h.inicio} className="m-chip seu">{h.rotulo} · seu</span>
                    if (oc) return <span key={h.inicio} className="m-chip ocupado">{h.rotulo} · ocupado</span>
                    return (
                      <button key={h.inicio} type="button" className="m-chip livre" onClick={() => reservar({ servico: sv.chave, inicio: h.inicio })}>
                        {h.rotulo}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
