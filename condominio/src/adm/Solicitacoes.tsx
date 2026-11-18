/* =============================================================================
   Solicitações (equipe): tudo o que os moradores pediram, numa tabela.
   Em cima os números (clicar filtra), a barra de filtros com a situação, a tabela que ordena pelo
   cabeçalho e, ao clicar numa linha, o detalhe com as ações ao lado (embaixo no celular).
   Ordem inicial: as mais novas primeiro. "Exportar" baixa o que está filtrado na tela.
   ============================================================================= */
import { useState } from 'react'
import { Download } from 'lucide-react'
import { descreverQuando, nomeServico, pagamentoPendente, rotuloStatus, statusEfetivo } from '../regras'
import type { Solicitacao } from '../tipos'
import { Apto, baixarCsv, Ponto, Selo, Tabela, type Coluna } from '../ui'
import { BarraFiltros, DetalheEquipe, filtrar, Herois, type PropsPagina } from './Adm'

export function SolicitacoesAdm({ itens, servicos, moradores, eu, agora, f, setF, atualizar, cobra }: PropsPagina) {
  const [escolhido, setEscolhido] = useState<string | null>(null)
  const linhas = filtrar(itens, f, agora).sort((a, b) => b.criado_em.localeCompare(a.criado_em))
  const item = escolhido ? itens.find((s) => s.id === escolhido) : null

  const todas: Coluna<Solicitacao>[] = [
    { chave: 'protocolo', rotulo: 'Nº', valor: (s) => s.protocolo, numerico: true, mostrar: (s) => <span className="num">{s.protocolo}</span> },
    {
      chave: 'servico',
      rotulo: 'Serviço',
      valor: (s) => nomeServico(s.servico, servicos),
      mostrar: (s) => (
        <span className="a-linha">
          <Ponto servico={s.servico} />
          {nomeServico(s.servico, servicos)}
        </span>
      ),
    },
    { chave: 'quando', rotulo: 'Quando', valor: (s) => s.inicio ?? s.criado_em, numerico: true, mostrar: (s) => descreverQuando(s, servicos) },
    { chave: 'apto', rotulo: 'Apto', valor: (s) => s.apto ?? '', mostrar: (s) => <Apto apto={s.apto} /> },
    { chave: 'morador', rotulo: 'Morador', valor: (s) => s.morador ?? '', mostrar: (s) => (s.morador ? <span className={pagamentoPendente(s) ? 'pend' : undefined}>{s.morador}</span> : <span className="apagado">sem identificação</span>) },
    { chave: 'situacao', rotulo: 'Situação', valor: (s) => rotuloStatus(s.servico, statusEfetivo(s, agora)), mostrar: (s) => <Selo s={s} agora={agora} /> },
    { chave: 'pago', rotulo: 'Pagamento', valor: (s) => (s.pago === null ? '' : s.pago ? 'Pago' : 'Pendente'), mostrar: (s) => (s.pago === null ? <span className="apagado" aria-label="não se aplica">–</span> : s.pago ? 'Pago' : pagamentoPendente(s) ? <span className="pend">Pendente</span> : <span className="apagado">Pendente</span>) },
    { chave: 'criado', rotulo: 'Pedido em', valor: (s) => s.criado_em, numerico: true, mostrar: (s) => <span className="num apagado">{new Date(s.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> },
  ]

  // Sem serviço que cobre, a coluna de pagamento some.
  const colunas = cobra ? todas : todas.filter((c) => c.chave !== 'pago')

  function exportar() {
    baixarCsv(
      `solicitacoes-${agora.slice(0, 10)}.csv`,
      ['Nº', 'Serviço', 'Quando', 'Apto', 'Morador', 'Situação', ...(cobra ? ['Pagamento'] : []), 'Placa', 'Tipo da denúncia', 'Descrição', 'Pedido em'],
      linhas.map((s) => [
        s.protocolo,
        nomeServico(s.servico, servicos),
        descreverQuando(s, servicos),
        s.apto ?? 'anônima',
        s.morador ?? '',
        rotuloStatus(s.servico, statusEfetivo(s, agora)),
        ...(cobra ? [s.pago === null ? '' : s.pago ? 'Pago' : 'Pendente'] : []),
        s.detalhes.placa ?? '',
        s.detalhes.categoria ?? '',
        s.detalhes.descricao ?? '',
        new Date(s.criado_em).toLocaleString('pt-BR'),
      ]),
    )
  }

  return (
    <>
      <Herois itens={itens} eu={eu} servicos={servicos} agora={agora} f={f} setF={setF} />
      <BarraFiltros itens={itens} f={f} setF={setF} servicos={servicos} moradores={moradores} agora={agora} periodo situacao cobra={cobra} />
      <div className={`a-tabela-e-detalhe${item ? ' com-detalhe' : ''}`}>
        <section className="cartao a-tabela" aria-label="Solicitações">
          <div className="a-tabela-topo">
            <p className="apagado peq">
              <span className="num">{linhas.length}</span> de <span className="num">{itens.length}</span> · mais novas primeiro; clique no cabeçalho para ordenar
            </p>
            <button type="button" className="btn" onClick={exportar} disabled={!linhas.length}>
              <Download size={16} strokeWidth={1.5} aria-hidden="true" /> Exportar {linhas.length}
            </button>
          </div>
          {linhas.length ? (
            <Tabela colunas={colunas} linhas={linhas} chaveLinha={(s) => s.id} escolhida={escolhido} escolher={(s) => setEscolhido(s.id === escolhido ? null : s.id)} legenda="Solicitações dos moradores" />
          ) : (
            <p className="vazio">Nenhuma solicitação com estes filtros.</p>
          )}
        </section>
        {item ? (
          <aside className="cartao a-lado anima-entra" aria-label="Detalhe" key={item.id}>
            <button type="button" className="btn quieto peq a-voltar" onClick={() => setEscolhido(null)}>
              Fechar
            </button>
            <DetalheEquipe s={item} servicos={servicos} agora={agora} atualizar={atualizar} />
          </aside>
        ) : null}
      </div>
    </>
  )
}
