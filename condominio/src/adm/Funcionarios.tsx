/* =============================================================================
   Funcionários (só quem tem a permissão "admin", em geral o síndico).
   Quem entra no painel e o que cada um pode fazer. Ao cadastrar, a pessoa recebe o convite por
   e-mail para criar a senha. Desativar corta o acesso na hora. O banco nunca deixa o condomínio sem
   ninguém com "admin".
   ============================================================================= */
import { useCallback, useEffect, useState } from 'react'
import { Send, UserPlus } from 'lucide-react'
import { api } from '../dados/api'
import { bate, mensagem } from '../regras'
import type { DadosFuncionario, Funcionario, Permissao, ResultadoCadastro } from '../tipos'
import { Campo, Janela, Tabela, type Coluna } from '../ui'

/** Cada poder, com o que ele libera (o mesmo texto do schema.sql). */
export const PERMISSOES: { valor: Permissao; rotulo: string; descricao: string }[] = [
  { valor: 'reservas', rotulo: 'Reservas', descricao: 'Calendário e solicitações (menos denúncias); cancelar reserva' },
  { valor: 'moradores', rotulo: 'Moradores', descricao: 'Cadastrar, editar, desativar, convite, código, histórico' },
  { valor: 'denuncias', rotulo: 'Denúncias', descricao: 'Ver e responder denúncias' },
  { valor: 'noticias', rotulo: 'Notícias', descricao: 'Avisos do app, e-mails em massa e agendados' },
  { valor: 'admin', rotulo: 'Administrar', descricao: 'Estatísticas, funcionários e poderes, feriados' },
]

/** Combinações prontas para não marcar caixa por caixa. */
const PRONTAS: { rotulo: string; cargo: string; permissoes: Permissao[] }[] = [
  { rotulo: 'Portaria', cargo: 'Portaria', permissoes: ['reservas', 'moradores', 'noticias'] },
  { rotulo: 'Zeladoria', cargo: 'Zeladoria', permissoes: ['reservas'] },
  { rotulo: 'Síndico', cargo: 'Síndico', permissoes: ['reservas', 'moradores', 'denuncias', 'noticias', 'admin'] },
]

type Edicao = { id: string | null; dados: DadosFuncionario }

export function Funcionarios({ avisar }: { avisar: (t: string, erro?: boolean) => void }) {
  const [lista, setLista] = useState<Funcionario[] | null>(null)
  const [busca, setBusca] = useState('')
  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [convite, setConvite] = useState<ResultadoCadastro['convite']>(null)

  const carregar = useCallback(async () => {
    try {
      setLista(await api.funcionarios())
    } catch (e) {
      avisar(mensagem(e), true)
      setLista([])
    }
  }, [avisar])
  useEffect(() => {
    void carregar()
  }, [carregar])

  const linhas = (lista ?? []).filter((f) => !busca.trim() || bate(`${f.nome} ${f.email} ${f.cargo}`, busca))
  const colunas: Coluna<Funcionario>[] = [
    { chave: 'nome', rotulo: 'Nome', valor: (f) => f.nome },
    { chave: 'email', rotulo: 'E-mail', valor: (f) => f.email },
    { chave: 'cargo', rotulo: 'Cargo', valor: (f) => f.cargo },
    {
      chave: 'permissoes',
      rotulo: 'Poderes',
      valor: (f) => f.permissoes.length,
      numerico: true,
      mostrar: (f) => (
        <span className="a-chips-perm">
          {PERMISSOES.filter((p) => f.permissoes.includes(p.valor)).map((p) => (
            <span key={p.valor} className="perm">
              {p.rotulo}
            </span>
          ))}
        </span>
      ),
    },
    { chave: 'login', rotulo: 'Último login', valor: (f) => f.ultimo_login ?? '', numerico: true, mostrar: (f) => <span className="num apagado">{f.ultimo_login ? new Date(f.ultimo_login).toLocaleDateString('pt-BR') : 'nunca'}</span> },
    { chave: 'situacao', rotulo: 'Situação', valor: (f) => (f.ativo ? 'Ativo' : 'Desativado'), mostrar: (f) => <span className={`selo ${f.ativo ? 'ok' : 'nao'}`}>{f.ativo ? 'Ativo' : 'Desativado'}</span> },
  ]

  async function salvar(e: Edicao): Promise<string | null> {
    try {
      const r = await api.salvarFuncionario(e.id, e.dados)
      setEdicao(null)
      if (r.convite) setConvite(r.convite)
      else avisar('Salvo.')
      await carregar()
      return null
    } catch (err) {
      return mensagem(err)
    }
  }

  return (
    <>
      <div className="a-filtros cartao" role="search">
        <div className="a-busca">
          <input className="entrada" type="search" placeholder="Buscar nome, e-mail ou cargo" aria-label="Buscar funcionário" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <span className="apagado peq num a-contador" aria-live="polite">
            {busca.trim() ? `${linhas.length} de ${lista?.length ?? 0}` : ''}
          </span>
        </div>
        <button type="button" className="btn limpar" disabled={!busca} onClick={() => setBusca('')}>
          Limpar
        </button>
        <button type="button" className="btn primario" onClick={() => setEdicao({ id: null, dados: { nome: '', email: '', cargo: '', permissoes: [], ativo: true } })}>
          <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" /> Cadastrar funcionário
        </button>
      </div>
      <section className="cartao a-tabela" aria-label="Funcionários">
        <div className="a-tabela-topo">
          <p className="apagado peq">
            <span className="num">{linhas.length}</span> pessoas na equipe · clique na linha para editar os poderes
          </p>
        </div>
        {!lista ? (
          <p className="vazio">Carregando…</p>
        ) : linhas.length ? (
          <Tabela colunas={colunas} linhas={linhas} chaveLinha={(f) => f.id} escolher={(f) => setEdicao({ id: f.id, dados: { nome: f.nome, email: f.email, cargo: f.cargo, permissoes: f.permissoes, ativo: f.ativo } })} legenda="Funcionários e poderes" />
        ) : (
          <p className="vazio">Ninguém com essa busca.</p>
        )}
      </section>
      {edicao ? (
        <FormFuncionario
          inicial={edicao}
          salvar={salvar}
          fechar={() => setEdicao(null)}
          reenviar={
            edicao.id
              ? () =>
                  void api.reenviarConvite('equipe', edicao.id!).then(
                    (c) => {
                      setEdicao(null)
                      setConvite(c)
                    },
                    (e) => avisar(mensagem(e), true),
                  )
              : undefined
          }
        />
      ) : null}
      <Janela aberta={!!convite} titulo="Convite" fechar={() => setConvite(null)} pe={<button type="button" className="btn primario" onClick={() => setConvite(null)}>Pronto</button>}>
        {convite ? (
          convite.erro ? (
            <p className="faixa-erro">{mensagem(new Error(convite.erro))}</p>
          ) : (
            <div className="nota">
              <p>Convite enviado{convite.email ? ` para ${convite.email}` : ''}. A pessoa cria a senha pelo link e entra no painel com os poderes marcados.</p>
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
      </Janela>
    </>
  )
}

function FormFuncionario({ inicial, salvar, fechar, reenviar }: { inicial: Edicao; salvar: (e: Edicao) => Promise<string | null>; fechar: () => void; reenviar?: () => void }) {
  const [d, setD] = useState(inicial.dados)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const mudou = JSON.stringify(d) !== JSON.stringify(inicial.dados)
  const alterna = (p: Permissao) => setD({ ...d, permissoes: d.permissoes.includes(p) ? d.permissoes.filter((x) => x !== p) : [...d.permissoes, p] })

  function tentarFechar() {
    if (mudou && !confirm('Fechar sem salvar?')) return
    fechar()
  }
  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (d.nome.trim().length < 2 || d.cargo.trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) {
      setErro('Confira nome, e-mail e cargo.')
      return
    }
    if (!d.permissoes.length && d.ativo) {
      setErro('Marque pelo menos um poder (ou desative a pessoa).')
      return
    }
    setEnviando(true)
    setErro(await salvar({ id: inicial.id, dados: d }))
    setEnviando(false)
  }
  return (
    <Janela aberta titulo={inicial.id ? 'Editar funcionário' : 'Cadastrar funcionário'} fechar={tentarFechar}>
      <form className="janela-form" onSubmit={enviar} noValidate>
        <Campo rotulo="Nome">{(p) => <input {...p} data-foco maxLength={120} value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} />}</Campo>
        <Campo rotulo="E-mail" dica={inicial.id ? 'Trocar o e-mail manda um convite novo.' : 'A pessoa recebe o convite para criar a senha.'}>
          {(p) => <input {...p} type="email" maxLength={200} value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />}
        </Campo>
        <Campo rotulo="Cargo" dica="Aparece para o morador nas respostas (ex.: Portaria, Síndico)">
          {(p) => (
            <>
              <input {...p} list="cargos" maxLength={40} value={d.cargo} onChange={(e) => setD({ ...d, cargo: e.target.value })} />
              <datalist id="cargos">
                {['Portaria', 'Zeladoria', 'Síndico', 'Subsíndico', 'Administradora'].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Campo>
        <div className="campo">
          <span className="rotulo">Poderes</span>
          <div className="a-botoes">
            {PRONTAS.map((p) => (
              <button key={p.rotulo} type="button" className="btn peq" onClick={() => setD({ ...d, permissoes: p.permissoes, cargo: d.cargo || p.cargo })}>
                Como {p.rotulo.toLowerCase()}
              </button>
            ))}
          </div>
          {PERMISSOES.map((p) => (
            <label key={p.valor} className="marcar">
              <input type="checkbox" checked={d.permissoes.includes(p.valor)} onChange={() => alterna(p.valor)} />
              <span>
                <strong>{p.rotulo}</strong>
                <span className="sec peq" style={{ display: 'block' }}>
                  {p.descricao}
                </span>
              </span>
            </label>
          ))}
        </div>
        {inicial.id ? (
          <label className="marcar">
            <input type="checkbox" checked={!d.ativo} onChange={(e) => setD({ ...d, ativo: !e.target.checked })} />
            <span>Desativar (a pessoa perde o acesso na hora)</span>
          </label>
        ) : null}
        {erro ? (
          <p className="faixa-erro" role="alert">
            {erro}
          </p>
        ) : null}
        <div className="janela-pe" style={{ padding: 0 }}>
          {reenviar && d.ativo ? (
            <button type="button" className="btn quieto" onClick={reenviar}>
              <Send size={16} strokeWidth={1.5} aria-hidden="true" /> Reenviar convite
            </button>
          ) : null}
          <button type="button" className="btn quieto" onClick={tentarFechar}>
            Cancelar
          </button>
          <button className="btn primario" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Janela>
  )
}
