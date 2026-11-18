/* =============================================================================
   Calendário da equipe, no desenho do pedido (17/11/2026):
     em cima  os números do dia e a barra de filtros (data, busca, categoria, residente)
     esquerda o calendário do mês; cada dia mostra o que acontece nele (nome em amarelo = pagamento
              pendente); clicar no dia escolhe o dia, clicar num item escolhe o item
     direita  o dia escolhido: os eventos com as informações e as ações, e os horários disponíveis
   Nada troca de página sozinho. A data escolhida fica lembrada só nesta aba.
   ============================================================================= */
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../dados/api'
import { agoraLocal, diaDe, diasReservaveis, especialDo, gradeDoMes, mensagem, mesTitulo, noDia, pagamentoPendente, periodosDoDia, somaMeses, statusEfetivo } from '../regras'
import type { DiaEspecial, Solicitacao } from '../tipos'
import { Apto, Ponto, Selo } from '../ui'
import { BarraFiltros, DetalheEquipe, filtrar, Herois, pode, type PropsPagina } from './Adm'

const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const tituloDia = (d: string) => `${DIAS_LONGOS[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${Number(d.slice(8))} de ${MESES[Number(d.slice(5, 7)) - 1]}`

/** Hora que aparece antes do item na grade (estacionamento e denúncia não têm hora). */
const horaCurta = (s: Solicitacao) => (s.servico === 'lavagem' || s.servico === 'diaria' ? s.inicio!.slice(11, 16) : s.servico === 'estacionamento' ? 'vaga' : 'den.')

export function CalendarioAdm({ itens, servicos, moradores, eu, agora, f, setF, atualizar, cobra }: PropsPagina) {
  const hoje = diaDe(agora)
  const [dia, setDiaBruto] = useState(() => {
    try {
      return sessionStorage.getItem('condominio:adm:dia') ?? hoje
    } catch {
      return hoje
    }
  })
  const [escolhido, setEscolhido] = useState<string | null>(null)
  const mes = `${dia.slice(0, 7)}-01`
  const grade = gradeDoMes(mes)
  const [especiais, setEspeciais] = useState<DiaEspecial[]>([])
  const [versaoFeriados, setVersaoFeriados] = useState(0)
  // Feriados da grade do mês (lidos de novo ao trocar de mês ou depois de um ajuste do síndico).
  useEffect(() => {
    let vivo = true
    api.feriados(grade[0], grade[41]).then((f) => vivo && setEspeciais(f), () => vivo && setEspeciais([]))
    return () => {
      vivo = false
    }
  }, [mes, versaoFeriados])

  function setDia(d: string) {
    setDiaBruto(d)
    setEscolhido(null)
    try {
      sessionStorage.setItem('condominio:adm:dia', d)
    } catch {
      /* só não lembra */
    }
  }

  // O calendário mostra o que não foi cancelado nem recusado; a situação "encerradas" é da tabela.
  const noCalendario = itens.filter((s) => s.status !== 'cancelada' && s.status !== 'recusada')
  const doMes = noCalendario.filter((s) => grade.some((d) => noDia(s, d)))
  // O calendário tem o dia dele; situação e período são filtros da tabela de Solicitações.
  const semTabela = { ...f, situacao: '' as const, de: '', ate: '' }
  const visiveis = filtrar(doMes, semTabela, agora)
  const doDia = visiveis
    .filter((s) => noDia(s, dia))
    .sort((a, b) => (a.inicio ?? a.criado_em).localeCompare(b.inicio ?? b.criado_em))
  const item = escolhido ? itens.find((s) => s.id === escolhido) : null
  const reservaveis = servicos.filter((s) => (s.config.tipo === 'horario' || s.config.tipo === 'periodo') && (!f.servico || f.servico === s.chave))

  return (
    <>
      <Herois itens={itens} eu={eu} servicos={servicos} agora={agoraLocal()} f={f} setF={setF} />
      <BarraFiltros itens={doMes} f={semTabela} setF={(n) => setF({ ...n, situacao: f.situacao, de: f.de, ate: f.ate })} servicos={servicos} moradores={moradores} agora={agora} data={{ valor: dia, mudar: setDia }} cobra={cobra} />

      <div className="a-cal">
        <section className="cartao a-cal-mes" aria-label="Calendário do mês">
          <div className="a-cal-topo">
            <h2>{mesTitulo(mes)}</h2>
            <div className="m-cal-nav">
              <button type="button" className="btn quieto icone" aria-label="Mês anterior" onClick={() => setDia(somaMeses(mes, -1))}>
                <ChevronLeft size={18} strokeWidth={1.5} aria-hidden="true" />
              </button>
              <button type="button" className="btn quieto" onClick={() => setDia(hoje)}>
                Hoje
              </button>
              <button type="button" className="btn quieto icone" aria-label="Próximo mês" onClick={() => setDia(somaMeses(mes, 1))}>
                <ChevronRight size={18} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="a-grade">
            {['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d) => (
              <span key={d} className="a-grade-cab apagado peq">
                {d}
              </span>
            ))}
            {grade.map((d) => {
              const lista = visiveis.filter((s) => noDia(s, d)).sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? ''))
              const fora = d.slice(0, 7) !== mes.slice(0, 7)
              const esp = especialDo(d, especiais)
              return (
                // Clicar em qualquer parte do dia (borda, espaço vazio) escolhe o dia; o número é o
                // botão para quem usa teclado.
                <div key={d} className={`a-dia${fora ? ' fora' : ''}${d === hoje ? ' hoje' : ''}${esp ? ` ${esp.tipo}` : ''}`} aria-current={d === dia ? 'date' : undefined} onClick={() => setDia(d)}>
                  <span className="a-dia-topo">
                    <button type="button" className="a-dia-n num" aria-label={`${tituloDia(d)}${esp ? `, ${esp.nome}` : ''}, ${lista.length} itens`}>
                      {Number(d.slice(8))}
                    </button>
                    {esp ? <span className="a-dia-feriado" title={esp.nome}>{esp.nome}</span> : null}
                  </span>
                  <div className="a-dia-itens">
                    {lista.slice(0, 3).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`a-evento${pagamentoPendente(s) ? ' pend-linha' : ''}`}
                        title={`${s.morador ?? 'anônima'}${pagamentoPendente(s) ? ' · pagamento pendente' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setDia(d)
                          setEscolhido(s.id)
                        }}
                      >
                        <Ponto servico={s.servico} />
                        <span className="num">{horaCurta(s)}</span>
                        <span className="a-evento-quem">{s.apto ?? 'anôn.'} {s.morador?.split(' ')[0] ?? ''}</span>
                      </button>
                    ))}
                    {lista.length > 3 ? <span className="apagado peq a-mais">+{lista.length - 3}</span> : null}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="a-legenda apagado peq">
            {servicos.filter((s) => s.chave !== 'denuncia' || pode(eu, 'denuncias')).map((s) => (
              <span key={s.chave}>
                <Ponto servico={s.chave} /> {s.nome}
              </span>
            ))}
            {cobra ? (
              <span>
                <span className="pend">Nome</span> pagamento pendente
              </span>
            ) : null}
          </p>
        </section>

        <section className="cartao a-cal-dia anima-entra" aria-label="Dia escolhido" key={`${dia}:${escolhido ?? ''}`}>
          <h2>{tituloDia(dia)}</h2>
          {especialDo(dia, especiais) ? <p className={`dia-especial ${especialDo(dia, especiais)!.tipo}`}>{especialDo(dia, especiais)!.nome}</p> : null}
          {pode(eu, 'admin') && !item ? <AjusteDia dia={dia} atual={especialDo(dia, especiais)} mudou={() => setVersaoFeriados(versaoFeriados + 1)} /> : null}
          {item ? (
            <>
              <button type="button" className="btn quieto peq a-voltar" onClick={() => setEscolhido(null)}>
                <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" /> Todos do dia
              </button>
              <DetalheEquipe s={item} servicos={servicos} agora={agora} atualizar={atualizar} />
            </>
          ) : (
            <>
              <h3 className="a-sub">
                Eventos <span className="apagado num">{doDia.length}</span>
              </h3>
              {doDia.length ? (
                <ul className="a-lista-dia">
                  {doDia.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="a-linha-dia" onClick={() => setEscolhido(s.id)}>
                        <span className="num a-hora">{horaCurta(s)}</span>
                        <Ponto servico={s.servico} />
                        <span className="a-linha-dia-meio">
                          <span>{servicos.find((x) => x.chave === s.servico)?.nome}</span>
                          <span className="a-linha">
                            <Apto apto={s.apto} />
                            {s.morador ? <span className={pagamentoPendente(s) ? 'pend' : 'sec peq'}>{s.morador}</span> : null}
                            {s.detalhes.placa ? <span className="mono peq">{s.detalhes.placa}</span> : null}
                          </span>
                        </span>
                        <Selo s={s} agora={agora} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="apagado peq">Nada neste dia{f.busca || f.servico || f.apto ? ' com estes filtros' : ''}.</p>
              )}

              <h3 className="a-sub">Horários disponíveis</h3>
              {reservaveis.map((sv) => {
                const horarios = periodosDoDia(sv.config, dia, especiais)
                const livres = horarios.filter((h) => h.inicio > agora && !noCalendario.some((s) => s.servico === sv.chave && s.inicio === h.inicio && statusEfetivo(s, agora) !== 'cancelada'))
                const abre = diasReservaveis(sv.config, hoje, especiais).includes(dia)
                return (
                  <div key={sv.chave} className="a-disp">
                    <span className="a-linha">
                      <Ponto servico={sv.chave} /> {sv.nome}
                      <span className="apagado num peq">
                        {horarios.length ? `${livres.length} de ${horarios.length} livres` : 'fechado'}
                      </span>
                    </span>
                    {horarios.length && dia >= hoje ? (
                      <div className="a-chips">
                        {horarios.map((h) => {
                          const livre = livres.includes(h)
                          return (
                            <span key={h.inicio} className={`a-chip${livre ? ' livre' : ''}`}>
                              {h.rotulo}
                            </span>
                          )
                        })}
                      </div>
                    ) : null}
                    {horarios.length && dia >= hoje && !abre ? <span className="apagado peq">Morador ainda não consegue reservar este dia.</span> : null}
                  </div>
                )
              })}
            </>
          )}
        </section>
      </div>
    </>
  )
}

/**
 * Só o síndico: corrige o dia que o cálculo errou ou que um decreto mudou (ponto facultativo da
 * prefeitura, emenda que o condomínio não faz). Não cancela reserva: avisa quantas existem.
 */
function AjusteDia({ dia, atual, mudou }: { dia: string; atual: DiaEspecial | undefined; mudou: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [tipo, setTipo] = useState<'feriado' | 'facultativo' | 'normal' | ''>('')
  const [nome, setNome] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    setAberto(false)
    setMsg(null)
  }, [dia])
  async function salvar() {
    try {
      const r = await api.ajustarDia(dia, tipo || null, nome)
      setMsg(r.reservas_no_dia ? `Salvo. Atenção: ${r.reservas_no_dia} reserva(s) já marcada(s) neste dia; avise os moradores ou cancele.` : 'Salvo.')
      setAberto(false)
      mudou()
    } catch (e) {
      setMsg(mensagem(e))
    }
  }
  if (!aberto) {
    return (
      <div className="a-linha">
        <button type="button" className="btn quieto peq" onClick={() => { setTipo(''); setNome(atual?.origem === 'ajuste' ? atual.nome : ''); setAberto(true) }}>
          {atual ? 'Ajustar este dia' : 'Marcar feriado ou emenda'}
        </button>
        {msg ? <span className="peq sec" role="status">{msg}</span> : null}
      </div>
    )
  }
  return (
    <div className="a-ajuste">
      <select className="entrada" aria-label="Tipo do dia" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
        <option value="">Automático (pela lei)</option>
        <option value="feriado">Feriado (fecha o que fecha em feriado)</option>
        <option value="facultativo">Ponto facultativo ou emenda</option>
        <option value="normal">Dia normal (ignorar feriado calculado)</option>
      </select>
      {tipo === 'feriado' || tipo === 'facultativo' ? (
        <input className="entrada" aria-label="Nome" placeholder="Ex.: decreto da prefeitura" maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} />
      ) : null}
      <div className="a-botoes">
        <button type="button" className="btn primario" onClick={() => void salvar()}>Salvar</button>
        <button type="button" className="btn quieto" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </div>
  )
}
