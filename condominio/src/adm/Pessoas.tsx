/* =============================================================================
   Pessoas (quem administra) ou Moradores (portaria).
   - Moradores: estatísticas (só quem administra), números que filtram, tabela que ordena pelo
     cabeçalho e, ao clicar, o detalhe com três abas: Dados, Histórico (pedidos e o que a equipe fez)
     e Acesso (e-mail, convite, senha, código, último acesso). Cadastro com e-mail (convite), CPF,
     vaga de garagem e "desde quando mora".
   - Funcionários (só quem administra): quem entra no painel e o que pode fazer (Funcionarios.tsx).
   O código de acesso aparece UMA vez (o banco guarda só o hash).
   ============================================================================= */
import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, KeyRound, Mail, Pencil, Send, UserPlus } from 'lucide-react'
import { api } from '../dados/api'
import { agoraLocal, bate, cpfValido, descreverQuando, diaDe, diferencaDias, estatisticas, formatarCpf, mascararCpf, mensagem, nomeServico } from '../regras'
import type { DadosMorador, HistoricoMorador, Morador, ResultadoCadastro } from '../tipos'
import { Abas, Apto, BarList, baixarCsv, Campo, Info, Janela, Ponto, Selo, Tabela, useLembrar, type Coluna } from '../ui'
import { Periodo, pode, type PropsPagina } from './Adm'
import { Funcionarios } from './Funcionarios'
import { ComporEmail } from './Noticias'

type Avisar = (t: string, erro?: boolean) => void

export function Pessoas(props: PropsPagina & { recarregar: () => Promise<void>; avisar: Avisar }) {
  const { eu } = props
  const admin = pode(eu, 'admin')
  const [aba, setAba] = useLembrar<'moradores' | 'funcionarios'>('condominio:adm:pessoas:aba', 'moradores')
  const mostrar = !pode(eu, 'moradores') ? 'funcionarios' : admin ? aba : 'moradores'
  return (
    <>
      {admin && pode(eu, 'moradores') ? (
        <Abas
          rotulo="Pessoas"
          valor={mostrar}
          mudar={setAba}
          opcoes={[
            { valor: 'moradores', rotulo: 'Moradores' },
            { valor: 'funcionarios', rotulo: 'Funcionários' },
          ]}
        />
      ) : null}
      {mostrar === 'funcionarios' ? <Funcionarios avisar={props.avisar} /> : <MoradoresView {...props} />}
    </>
  )
}

/* ------------------------------------------------------------------ estatísticas */

/**
 * Estatísticas dos moradores. Os favoritos (lavanderia e diária) contam o histórico INTEIRO, por isso
 * esta parte lê todas as solicitações uma vez (o painel normal só traz os últimos 90 dias).
 */
function Estatisticas({ moradores, itens, agora }: { moradores: Morador[]; itens: PropsPagina['itens']; agora: string }) {
  const [todas, setTodas] = useState<PropsPagina['itens'] | null>(null)
  useEffect(() => {
    let vivo = true
    api.painel('2000-01-01').then((r) => vivo && setTodas(r.itens), () => vivo && setTodas(null))
    return () => {
      vivo = false
    }
  }, [])
  const e = estatisticas(moradores, todas ?? itens, agora)
  const anos = e.estadiaMediaMeses / 12
  const tiles = [
    { rotulo: 'Moradores ativos', n: String(e.ativos), ctx: `${e.comEmail} com e-mail · ${e.soCodigo} só com código` },
    { rotulo: 'Tempo médio de moradia', n: anos >= 1 ? `${anos.toFixed(1).replace('.', ',')} anos` : `${Math.round(e.estadiaMediaMeses)} meses`, ctx: 'desde quando mora (ou o cadastro)' },
    { rotulo: 'Pedidos por morador', n: e.pedidosPorMorador.toFixed(1).replace('.', ','), ctx: 'nos últimos 90 dias' },
    { rotulo: 'Horário favorito da lavanderia', n: e.horasLavagem[0]?.rotulo ?? '–', ctx: e.horasLavagem[0] ? `${e.horasLavagem[0].n} reservas, de todos os tempos` : 'sem reservas ainda' },
  ]
  return (
    <section className="a-estat" aria-label="Estatísticas dos moradores">
      <div className="a-herois">
        {tiles.map((t) => (
          <div key={t.rotulo} className="a-heroi cartao estatico">
            <span className="sec peq">{t.rotulo}</span>
            <span className="a-heroi-n num">{t.n}</span>
            <span className="apagado peq">{t.ctx}</span>
          </div>
        ))}
      </div>
      <div className="a-estat-listas">
        <div className="cartao a-estat-lista">
          <h3>
            Lavanderia: horários favoritos de todos os tempos <Info texto="Todas as reservas de lavagem e secagem desde o começo do sistema (canceladas não contam), por hora de início. A barra mais escura é a hora mais pedida." />
          </h3>
          <BarList itens={e.horasLavagem} />
        </div>
        <div className="cartao a-estat-lista">
          <h3>
            Diária: período favorito de todos os tempos <Info texto="Todas as diárias desde o começo do sistema (canceladas não contam), por período." />
          </h3>
          <BarList itens={e.periodosDiaria} />
          <p className="apagado peq">Com vaga de garagem: {e.comVaga} de {e.ativos}</p>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ moradores */

type FiltroMorador = '' | 'sem_acesso'
const FILTROS_MORADOR: { valor: Exclude<FiltroMorador, ''>; rotulo: string; bate: (m: Morador, hoje: string) => boolean }[] = [
  { valor: 'sem_acesso', rotulo: 'Sem acesso há 30 dias', bate: (m, hoje) => !m.ultimo_acesso || diferencaDias(diaDe(agoraLocal(new Date(m.ultimo_acesso))), hoje) > 30 },
]

const quandoCurto = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–')
const formaAcesso = (m: Morador) => (m.email && m.tem_codigo ? 'E-mail e código' : m.email ? 'E-mail' : 'Código')

type Edicao = { id: string | null; dados: DadosMorador }
const VAZIO: DadosMorador = { nome: '', apto: '', telefone: '', email: '', cpf: '', vaga: '', desde: '', ativo: true, gerar_codigo: false }

function MoradoresView({ moradores, itens, servicos, eu, agora, recarregar, avisar }: PropsPagina & { recarregar: () => Promise<void>; avisar: Avisar }) {
  const hoje = diaDe(agora)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<FiltroMorador>('')
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [cadDe, setCadDe] = useState('')
  const [cadAte, setCadAte] = useState('')
  const [escolhido, setEscolhido] = useState<string | null>(null)
  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [resultado, setResultado] = useState<{ m: Pick<Morador, 'nome' | 'apto'>; codigo: string | null; convite: ResultadoCadastro['convite'] } | null>(null)
  const [emailPara, setEmailPara] = useState<Morador | null>(null)

  const base = moradores.filter((m) => mostrarInativos || m.ativo)
  const def = FILTROS_MORADOR.find((x) => x.valor === filtro)
  const cadastro = (m: Morador) => diaDe(agoraLocal(new Date(m.criado_em)))
  const linhas = base.filter((m) => (!def || def.bate(m, hoje)) && (!cadDe || cadastro(m) >= cadDe) && (!cadAte || cadastro(m) <= cadAte) && (!busca.trim() || bate(`${m.apto} ${m.nome} ${m.email ?? ''} ${m.telefone ?? ''} ${m.vaga ?? ''} ${m.cpf ?? ''}`, busca)))
  const item = moradores.find((m) => m.id === escolhido)
  const temFiltro = !!(busca || filtro || mostrarInativos || cadDe || cadAte)

  const colunas: Coluna<Morador>[] = [
    { chave: 'apto', rotulo: 'Apto', valor: (m) => m.apto, mostrar: (m) => <Apto apto={m.apto} /> },
    { chave: 'nome', rotulo: 'Nome', valor: (m) => m.nome },
    { chave: 'email', rotulo: 'E-mail', valor: (m) => m.email ?? '', mostrar: (m) => m.email ?? <span className="apagado">–</span> },
    { chave: 'cpf', rotulo: 'CPF', valor: (m) => m.cpf ?? '', mostrar: (m) => (m.cpf ? <span className="num">{mascararCpf(m.cpf)}</span> : <span className="apagado">–</span>) },
    { chave: 'vaga', rotulo: 'Vaga', valor: (m) => m.vaga ?? '', mostrar: (m) => (m.vaga ? <span className="mono">{m.vaga}</span> : <span className="apagado">–</span>) },
    { chave: 'acesso', rotulo: 'Acesso', valor: (m) => formaAcesso(m), mostrar: (m) => <span className="peq">{formaAcesso(m)}{m.email && !m.senha_criada ? <span className="apagado"> · convite pendente</span> : null}</span> },
    { chave: 'ultimo', rotulo: 'Último acesso', valor: (m) => m.ultimo_acesso ?? '', numerico: true, mostrar: (m) => <span className="num apagado">{quandoCurto(m.ultimo_acesso)}</span> },
    { chave: 'situacao', rotulo: 'Situação', valor: (m) => (m.ativo ? 'Ativo' : 'Desativado'), mostrar: (m) => <span className={`selo ${m.ativo ? 'ok' : 'nao'}`}>{m.ativo ? 'Ativo' : 'Desativado'}</span> },
  ]

  async function salvar(e: Edicao): Promise<string | null> {
    try {
      if (e.id) {
        const r = await api.editarMorador(e.id, e.dados)
        avisar(r.canceladas ? `Salvo. ${r.canceladas} reserva(s) futura(s) cancelada(s).` : 'Cadastro salvo.')
        if (r.convite) setResultado({ m: { nome: e.dados.nome.trim(), apto: e.dados.apto.trim().toUpperCase() }, codigo: null, convite: r.convite })
      } else {
        const r = await api.criarMorador(e.dados)
        setResultado({ m: { nome: e.dados.nome.trim(), apto: e.dados.apto.trim().toUpperCase() }, codigo: r.codigo, convite: r.convite })
      }
      setEdicao(null)
      await recarregar()
      return null
    } catch (err) {
      return mensagem(err)
    }
  }

  async function acao(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn()
      if (ok) avisar(ok)
      await recarregar()
    } catch (err) {
      avisar(mensagem(err), true)
    }
  }

  return (
    <>
      {pode(eu, 'admin') ? <Estatisticas moradores={moradores} itens={itens} agora={agora} /> : null}

      <div className="a-filtros cartao" role="search">
        <Periodo rotulo="Cadastrados no período" de={cadDe} ate={cadAte} mudar={(d, a) => { setCadDe(d); setCadAte(a) }} />
        <div className="a-busca">
          <input className="entrada" type="search" placeholder="Buscar apto, nome, e-mail, vaga" aria-label="Buscar morador" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <span className="apagado peq num a-contador" aria-live="polite">
            {temFiltro ? `${linhas.length} de ${moradores.length}` : ''}
          </span>
        </div>
        {FILTROS_MORADOR.map((x) => (
          <label key={x.valor} className="a-check">
            <input type="checkbox" checked={filtro === x.valor} onChange={(e) => setFiltro(e.target.checked ? x.valor : '')} /> {x.rotulo} ({base.filter((m) => x.bate(m, hoje)).length})
          </label>
        ))}
        <label className="a-check">
          <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} /> Mostrar desativados ({moradores.filter((m) => !m.ativo).length})
        </label>
        <button type="button" className="btn limpar" disabled={!temFiltro} onClick={() => { setBusca(''); setFiltro(''); setMostrarInativos(false); setCadDe(''); setCadAte('') }}>
          Limpar
        </button>
        <button type="button" className="btn primario" onClick={() => setEdicao({ id: null, dados: { ...VAZIO } })}>
          <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" /> Cadastrar morador
        </button>
      </div>

      <div className={`a-tabela-e-detalhe${item ? ' com-detalhe' : ''}`}>
        <section className="cartao a-tabela" aria-label="Moradores">
          <div className="a-tabela-topo">
            <p className="apagado peq">
              <span className="num">{linhas.length}</span> moradores · por apartamento; clique no cabeçalho para ordenar
            </p>
            <button
              type="button"
              className="btn"
              disabled={!linhas.length}
              onClick={() =>
                baixarCsv(
                  'moradores.csv',
                  ['Apto', 'Nome', 'E-mail', 'Telefone', 'CPF', 'Vaga', 'Mora desde', 'Acesso', 'Último acesso', 'Situação'],
                  linhas.map((m) => [m.apto, m.nome, m.email ?? '', m.telefone ?? '', m.cpf ? formatarCpf(m.cpf) : '', m.vaga ?? '', m.desde ?? '', formaAcesso(m), quandoCurto(m.ultimo_acesso), m.ativo ? 'Ativo' : 'Desativado']),
                )
              }
            >
              <Download size={16} strokeWidth={1.5} aria-hidden="true" /> Exportar {linhas.length}
            </button>
          </div>
          {linhas.length ? (
            <Tabela colunas={colunas} linhas={linhas} chaveLinha={(m) => m.id} escolhida={escolhido} escolher={(m) => setEscolhido(m.id === escolhido ? null : m.id)} legenda="Moradores cadastrados" />
          ) : (
            <p className="vazio">{temFiltro ? 'Nenhum morador com esses filtros.' : 'Nenhum morador cadastrado ainda.'}</p>
          )}
        </section>
        {item ? (
          <aside className="cartao a-lado anima-entra" aria-label="Morador" key={item.id}>
            <button type="button" className="btn quieto peq a-voltar" onClick={() => setEscolhido(null)}>
              Fechar
            </button>
            <DetalheMorador
              m={item}
              servicos={servicos}
              agora={agora}
              podeEmail={pode(eu, 'noticias')}
              editar={() => setEdicao({ id: item.id, dados: { nome: item.nome, apto: item.apto, telefone: item.telefone ?? '', email: item.email ?? '', cpf: item.cpf ? formatarCpf(item.cpf) : '', vaga: item.vaga ?? '', desde: item.desde ?? '', ativo: item.ativo } })}
              enviarEmail={() => setEmailPara(item)}
              gerarCodigo={() => {
                if (!confirm(`Gerar um código novo para ${item.nome}? O código atual para de funcionar na hora.`)) return
                void api.novoCodigo(item.id).then(
                  (r) => {
                    setResultado({ m: item, codigo: r.codigo, convite: null })
                    void recarregar()
                  },
                  (err) => avisar(mensagem(err), true),
                )
              }}
              reenviar={() => void api.reenviarConvite('morador', item.id).then((c) => { setResultado({ m: item, codigo: null, convite: c }); void recarregar() }, (err) => avisar(mensagem(err), true))}
              alternar={() => {
                if (item.ativo && !confirm(`Desativar ${item.nome}? O acesso acaba na hora e as reservas futuras são canceladas. O histórico fica.`)) return
                void acao(() => api.editarMorador(item.id, { nome: item.nome, apto: item.apto, telefone: item.telefone ?? '', email: item.email ?? '', cpf: item.cpf ?? '', vaga: item.vaga ?? '', desde: item.desde ?? '', ativo: !item.ativo }), item.ativo ? 'Morador desativado.' : 'Morador reativado.')
              }}
            />
          </aside>
        ) : null}
      </div>

      {edicao ? <FormMorador inicial={edicao} salvar={salvar} fechar={() => setEdicao(null)} /> : null}
      <Janela aberta={!!resultado} titulo="Acesso do morador" fechar={() => setResultado(null)} pe={<button type="button" className="btn primario" onClick={() => setResultado(null)}>Pronto</button>}>
        {resultado ? <AcessoEntregue {...resultado} avisar={avisar} /> : null}
      </Janela>
      <Janela aberta={!!emailPara} titulo={`E-mail para ${emailPara?.nome ?? ''}`} fechar={() => setEmailPara(null)}>
        {emailPara ? (
          <ComporEmail
            destino={{ ids: [emailPara.id] }}
            paraRotulo={`${emailPara.nome} (${emailPara.email})`}
            enviado={(t) => {
              avisar(t)
              setEmailPara(null)
            }}
            avisar={avisar}
            simples
          />
        ) : null}
      </Janela>
    </>
  )
}

/* ------------------------------------------------------------------ detalhe do morador */

const ACOES: Record<string, string> = {
  morador_cadastrado: 'Cadastro feito',
  morador_editado: 'Cadastro editado',
  morador_desativado: 'Desativado',
  morador_reativado: 'Reativado',
  codigo_novo: 'Código novo gerado',
  convite_enviado: 'Convite enviado',
}

function DetalheMorador({ m, servicos, agora, podeEmail, editar, enviarEmail, gerarCodigo, reenviar, alternar }: {
  m: Morador
  servicos: PropsPagina['servicos']
  agora: string
  podeEmail: boolean
  editar: () => void
  enviarEmail: () => void
  gerarCodigo: () => void
  reenviar: () => void
  alternar: () => void
}) {
  const [aba, setAba] = useState<'dados' | 'historico' | 'acesso'>('dados')
  const [hist, setHist] = useState<HistoricoMorador | null>(null)
  useEffect(() => {
    if (aba !== 'historico') return
    let vivo = true
    setHist(null)
    api.historicoMorador(m.id).then((h) => vivo && setHist(h), () => vivo && setHist({ solicitacoes: [], auditoria: [] }))
    return () => {
      vivo = false
    }
  }, [aba, m.id])
  const desde = m.desde ?? diaDe(agoraLocal(new Date(m.criado_em)))
  const meses = Math.max(0, Math.round(diferencaDias(desde, diaDe(agora)) / 30.44))
  // Histórico: pedidos e o que a equipe fez, juntos, do mais novo para o mais antigo.
  const linhas = useMemo(() => {
    if (!hist) return []
    return [
      ...hist.solicitacoes.map((s) => ({ em: s.criado_em, no: <><Ponto servico={s.servico} /> {nomeServico(s.servico, servicos)} <span className="apagado">· {descreverQuando(s, servicos)}</span> <Selo s={s} agora={agora} /></> })),
      ...hist.auditoria.map((a) => ({ em: a.em, no: <><span>{ACOES[a.acao] ?? a.acao}</span> <span className="apagado">· {a.por_nome ?? a.por_papel}</span></> })),
    ].sort((x, y) => y.em.localeCompare(x.em))
  }, [hist, servicos, agora])

  return (
    <div className="a-detalhe">
      <p className="a-linha">
        <Apto apto={m.apto} /> <strong>{m.nome}</strong> {!m.ativo ? <span className="selo nao">Desativado</span> : null}
      </p>
      <Abas
        rotulo="Morador"
        valor={aba}
        mudar={setAba}
        opcoes={[
          { valor: 'dados', rotulo: 'Dados' },
          { valor: 'historico', rotulo: 'Histórico' },
          { valor: 'acesso', rotulo: 'Acesso' },
        ]}
      />
      {aba === 'dados' ? (
        <dl className="detalhes anima-entra">
          {[
            ['E-mail', m.email],
            ['Telefone', m.telefone],
            ['CPF', m.cpf ? formatarCpf(m.cpf) : null],
            ['Vaga de garagem', m.vaga ?? 'não tem'],
            ['Mora no condomínio', meses >= 12 ? `há ${Math.floor(meses / 12)} ano(s) e ${meses % 12} mês(es)` : `há ${meses} mês(es)`],
            ['Cadastro', new Date(m.criado_em).toLocaleDateString('pt-BR')],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="apagado peq">{k}</dt>
              <dd className={k === 'CPF' || k === 'Vaga de garagem' ? 'num' : undefined}>{v ?? <span className="apagado">–</span>}</dd>
            </div>
          ))}
        </dl>
      ) : aba === 'historico' ? (
        <div className="anima-entra">
          {!hist ? (
            <p className="apagado peq">Carregando…</p>
          ) : linhas.length ? (
            <ul className="a-hist">
              {linhas.map((l, i) => (
                <li key={i}>
                  <span className="num apagado peq">{new Date(l.em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
                  <span className="a-linha peq">{l.no}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="apagado peq">Nada no histórico ainda.</p>
          )}
        </div>
      ) : (
        <dl className="detalhes anima-entra">
          {[
            ['Entra por', formaAcesso(m)],
            ['Convite enviado', m.email ? (m.convite_enviado_em ? quandoCurto(m.convite_enviado_em) : 'ainda não') : '–'],
            ['Senha criada', m.email ? (m.senha_criada ? 'sim' : 'não (convite pendente)') : '–'],
            ['Último login por e-mail', quandoCurto(m.ultimo_login)],
            ['Último acesso ao app', quandoCurto(m.ultimo_acesso)],
            ['Código gerado em', m.tem_codigo ? quandoCurto(m.codigo_gerado_em) : 'não tem código'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="apagado peq">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="a-botoes">
        <button type="button" className="btn" onClick={editar}>
          <Pencil size={16} strokeWidth={1.5} aria-hidden="true" /> Editar
        </button>
        {m.ativo && m.email && podeEmail ? (
          <button type="button" className="btn" onClick={enviarEmail}>
            <Mail size={16} strokeWidth={1.5} aria-hidden="true" /> Enviar e-mail
          </button>
        ) : null}
        {m.ativo && m.email ? (
          <button type="button" className="btn" onClick={reenviar}>
            <Send size={16} strokeWidth={1.5} aria-hidden="true" /> Reenviar convite
          </button>
        ) : null}
        {m.ativo ? (
          <button type="button" className="btn" onClick={gerarCodigo}>
            <KeyRound size={16} strokeWidth={1.5} aria-hidden="true" /> {m.tem_codigo ? 'Código novo' : 'Gerar código'}
          </button>
        ) : null}
        <button type="button" className={`btn${m.ativo ? ' perigo' : ''}`} onClick={alternar}>
          {m.ativo ? 'Desativar' : 'Reativar'}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ cadastro */

function FormMorador({ inicial, salvar, fechar }: { inicial: Edicao; salvar: (e: Edicao) => Promise<string | null>; fechar: () => void }) {
  const [d, setD] = useState(inicial.dados)
  const [temVaga, setTemVaga] = useState(!!inicial.dados.vaga)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const mudou = JSON.stringify(d) !== JSON.stringify(inicial.dados)
  const muda = (k: keyof DadosMorador) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value })

  function tentarFechar() {
    if (mudou && !confirm('Fechar sem salvar?')) return
    fechar()
  }
  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    const er: Record<string, string> = {}
    if (d.nome.trim().length < 2) er.nome = 'Nome com 2 letras ou mais.'
    if (!/^[A-Za-z0-9-]{1,10}$/.test(d.apto.trim())) er.apto = 'Letras, números e hífen, até 10.'
    if (d.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) er.email = 'E-mail mal escrito.'
    if (d.cpf.trim() && !cpfValido(d.cpf)) er.cpf = 'CPF não confere. Confira os números.'
    if (temVaga && !d.vaga.trim()) er.vaga = 'Diga qual é a vaga (ex.: G-12).'
    setErros(er)
    if (Object.keys(er).length) return
    setEnviando(true)
    setErro(await salvar({ id: inicial.id, dados: { ...d, vaga: temVaga ? d.vaga : '' } }))
    setEnviando(false)
  }
  return (
    <Janela aberta titulo={inicial.id ? 'Editar morador' : 'Cadastrar morador'} fechar={tentarFechar}>
      <form className="janela-form" onSubmit={enviar} noValidate>
        <Campo rotulo="Nome" erro={erros.nome}>{(p) => <input {...p} data-foco maxLength={120} value={d.nome} onChange={muda('nome')} />}</Campo>
        <div className="m-duas">
          <Campo rotulo="Apartamento" erro={erros.apto}>{(p) => <input {...p} className="mono" maxLength={10} value={d.apto} onChange={(e) => setD({ ...d, apto: e.target.value.toUpperCase() })} />}</Campo>
          <Campo rotulo="Mora desde (opcional)">{(p) => <input {...p} type="date" value={d.desde} onChange={muda('desde')} />}</Campo>
        </div>
        <Campo rotulo="E-mail (recomendado)" erro={erros.email} dica={d.email.trim() ? 'Ao salvar, o morador recebe o convite para criar a senha. Leia o e-mail de volta com ele.' : 'Sem e-mail, o morador entra com um código que aparece ao salvar.'}>
          {(p) => <input {...p} type="email" maxLength={200} value={d.email} onChange={muda('email')} />}
        </Campo>
        {!inicial.id && d.email.trim() ? (
          <label className="marcar">
            <input type="checkbox" checked={!!d.gerar_codigo} onChange={(e) => setD({ ...d, gerar_codigo: e.target.checked })} />
            <span>Gerar também um código (para quem às vezes não usa o e-mail)</span>
          </label>
        ) : null}
        <div className="m-duas">
          <Campo rotulo="Telefone (opcional)">{(p) => <input {...p} type="tel" maxLength={30} value={d.telefone} onChange={muda('telefone')} />}</Campo>
          <Campo rotulo="CPF (opcional)" erro={erros.cpf}>{(p) => <input {...p} inputMode="numeric" maxLength={14} value={d.cpf} onChange={muda('cpf')} />}</Campo>
        </div>
        <label className="marcar">
          <input type="checkbox" checked={temVaga} onChange={(e) => setTemVaga(e.target.checked)} />
          <span>Tem vaga de garagem</span>
        </label>
        {temVaga ? <Campo rotulo="Qual vaga" erro={erros.vaga}>{(p) => <input {...p} className="mono" maxLength={20} placeholder="Ex.: G-12" value={d.vaga} onChange={(e) => setD({ ...d, vaga: e.target.value.toUpperCase() })} />}</Campo> : null}
        {erro ? (
          <p className="faixa-erro" role="alert">
            {erro}
          </p>
        ) : null}
        <div className="janela-pe" style={{ padding: 0 }}>
          <button type="button" className="btn quieto" onClick={tentarFechar}>
            Cancelar
          </button>
          <button className="btn primario" disabled={enviando}>
            {enviando ? 'Salvando…' : inicial.id ? 'Salvar' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Janela>
  )
}

/** Depois do cadastro: o código (uma vez só, com a mensagem pronta) e/ou o convite por e-mail. */
function AcessoEntregue({ m, codigo, convite, avisar }: { m: Pick<Morador, 'nome' | 'apto'>; codigo: string | null; convite: ResultadoCadastro['convite']; avisar: Avisar }) {
  const link = `${location.origin}${location.pathname}#/`
  const texto = codigo
    ? `Olá, ${m.nome.split(' ')[0]}. Seu acesso ao Condomínio:\n${link}\nApartamento: ${m.apto}\nCódigo: ${codigo}\nNo sistema você reserva lavanderia e diária e faz denúncias. Não compartilhe o código.`
    : ''
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      avisar('Mensagem copiada. Cole no WhatsApp do morador.')
    } catch {
      avisar('Não deu para copiar. Selecione o texto e copie.', true)
    }
  }
  return (
    <>
      <p>
        <Apto apto={m.apto} /> {m.nome}
      </p>
      {convite ? (
        convite.erro ? (
          <p className="faixa-erro">{mensagem(new Error(convite.erro))}</p>
        ) : (
          <div className="nota">
            <p>
              Convite enviado{convite.email ? ` para ${convite.email}` : ''}. O morador cria a senha pelo link e passa a entrar com e-mail e senha. O link vale 24 horas; depois, use Reenviar convite.
            </p>
            {convite.linkDemo ? (
              <p className="peq">
                Demonstração: nenhum e-mail sai daqui.{' '}
                <a href={convite.linkDemo} target="_blank" rel="noreferrer">
                  Abrir o link do convite
                </a>
              </p>
            ) : null}
          </div>
        )
      ) : null}
      {codigo ? (
        <>
          <div className="codigo-grande" aria-label={`Código ${codigo.split('').join(' ')}`}>
            {codigo}
          </div>
          <p className="sec peq">
            Anote ou envie agora: o código não aparece de novo. <Info texto="O sistema guarda só uma versão embaralhada do código. Se o morador perder, use Código novo: o antigo para de valer." />
          </p>
          <textarea className="entrada mono peq" readOnly rows={6} value={texto} aria-label="Mensagem para o morador" />
          <button type="button" className="btn" onClick={() => void copiar()}>
            <Copy size={16} strokeWidth={1.5} aria-hidden="true" /> Copiar mensagem
          </button>
        </>
      ) : null}
    </>
  )
}
