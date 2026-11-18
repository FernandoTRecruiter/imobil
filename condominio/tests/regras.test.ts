/* Regras puras e os QoL que dá para testar sem navegador (ordenar, filtrar com contagem, buscar). */
import { describe, expect, it } from 'vitest'
import { SERVICOS_PADRAO } from '../src/config'
import { filtrar, FILTROS_VAZIOS } from '../src/adm/Adm'
import {
  bate,
  descreverQuando,
  diasReservaveis,
  gradeDoMes,
  moradorCancela,
  noDia,
  periodosDoDia,
  placaValida,
  segundaDa,
  somaMeses,
  statusEfetivo,
} from '../src/regras'
import type { Solicitacao } from '../src/tipos'
import { proximaOrdem } from '../src/ui'

const cfg = (k: string) => SERVICOS_PADRAO.find((s) => s.chave === k)!.config

function sol(p: Partial<Solicitacao>): Solicitacao {
  return { id: 'x', protocolo: 1, servico: 'lavagem', apto: '101', inicio: null, fim: null, status: 'confirmada', pago: null, detalhes: {}, anonima: false, criado_em: '2026-11-18T13:00:00.000Z', historico: [], ...p }
}

describe('horários', () => {
  it('lavagem: 15 blocos de 1 h, das 7h às 22h', () => {
    const h = periodosDoDia(cfg('lavagem'), '2026-11-18')
    expect(h).toHaveLength(15)
    expect(h[0]).toEqual({ inicio: '2026-11-18T07:00', fim: '2026-11-18T08:00', rotulo: '07:00' })
    expect(h.at(-1)!.fim).toBe('2026-11-18T22:00')
  })
  it('diária: manhã e tarde de segunda a sábado; domingo fechado', () => {
    expect(periodosDoDia(cfg('diaria'), '2026-11-21').map((x) => x.rotulo)).toEqual(['Manhã', 'Tarde'])
    expect(periodosDoDia(cfg('diaria'), '2026-11-22')).toEqual([])
  })
  it('dias reserváveis respeitam horizonte e dias fechados', () => {
    expect(diasReservaveis(cfg('lavagem'), '2026-11-18')).toHaveLength(8) // hoje + 7
    expect(diasReservaveis(cfg('diaria'), '2026-11-18')).not.toContain('2026-11-22')
  })
  it('semana do limite começa na segunda', () => {
    expect(segundaDa('2026-11-22')).toBe('2026-11-16')
    expect(segundaDa('2026-11-23')).toBe('2026-11-23')
  })
})

describe('datas e textos', () => {
  it('grade do mês começa no domingo e tem 42 dias', () => {
    const g = gradeDoMes('2026-11-01')
    expect(g[0]).toBe('2026-11-01') // 1/11/2026 é domingo
    expect(g).toHaveLength(42)
    expect(somaMeses('2026-12-01', 1)).toBe('2027-01-01')
    expect(somaMeses('2026-01-01', -1)).toBe('2025-12-01')
  })
  it('descreve o quando de cada serviço', () => {
    expect(descreverQuando(sol({ inicio: '2026-11-18T14:00', fim: '2026-11-18T15:00' }), SERVICOS_PADRAO)).toBe('qua 18/11 · 14:00 às 15:00')
    expect(descreverQuando(sol({ servico: 'diaria', inicio: '2026-11-18T13:00', fim: '2026-11-18T17:00' }), SERVICOS_PADRAO)).toBe('qua 18/11 · Tarde (13:00 às 17:00)')
    expect(descreverQuando(sol({ servico: 'estacionamento', inicio: '2026-11-20T00:00', fim: '2026-11-22T00:00' }), SERVICOS_PADRAO)).toBe('sex 20/11 a sáb 21/11')
  })
  it('estacionamento ocupa do primeiro ao último dia', () => {
    const s = sol({ servico: 'estacionamento', inicio: '2026-11-20T00:00', fim: '2026-11-22T00:00' })
    expect(['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'].map((d) => noDia(s, d))).toEqual([false, true, true, false])
  })
  it('placa antiga e Mercosul', () => {
    expect(placaValida('abc-1234')).toBe(true)
    expect(placaValida('ABC1D23')).toBe(true)
    expect(placaValida('AB12345')).toBe(false)
  })
})

describe('situação', () => {
  it('reserva confirmada que já acabou aparece como concluída', () => {
    expect(statusEfetivo({ status: 'confirmada', fim: '2026-11-18T09:00' }, '2026-11-18T10:00')).toBe('concluida')
    expect(statusEfetivo({ status: 'confirmada', fim: '2026-11-18T11:00' }, '2026-11-18T10:00')).toBe('confirmada')
  })
  it('morador cancela reserva só antes de começar; denúncia anônima nunca', () => {
    const r = sol({ inicio: '2026-11-18T14:00', fim: '2026-11-18T15:00' })
    expect(moradorCancela(r, '2026-11-18T13:59')).toBe(true)
    expect(moradorCancela(r, '2026-11-18T14:00')).toBe(false)
    expect(moradorCancela(sol({ servico: 'denuncia', status: 'aberta', anonima: true, apto: null }), '2026-11-18T10:00')).toBe(false)
  })
})

describe('QoL', () => {
  it('ordenar: 1º clique, 2º inverte, 3º volta à ordem declarada', () => {
    let o = proximaOrdem(null, 'nome', false)
    expect(o).toEqual({ chave: 'nome', sobe: true }) // texto: A→Z
    o = proximaOrdem(o, 'nome', false)
    expect(o).toEqual({ chave: 'nome', sobe: false })
    expect(proximaOrdem(o, 'nome', false)).toBeNull()
    expect(proximaOrdem(null, 'criado', true)).toEqual({ chave: 'criado', sobe: false }) // data: mais novo primeiro
    expect(proximaOrdem({ chave: 'nome', sobe: true }, 'criado', true)).toEqual({ chave: 'criado', sobe: false })
  })

  it('busca sem acento e com vários termos', () => {
    expect(bate('Luíza Prado 101', 'luiza 101')).toBe(true)
    expect(bate('Luíza Prado 101', 'luiza 202')).toBe(false)
  })

  it('período de/até filtra pelo dia em que o pedido acontece (denúncia: o dia em que chegou)', () => {
    const agora = '2026-11-18T10:00'
    const itens = [
      sol({ id: 'a', inicio: '2026-11-17T08:00', fim: '2026-11-17T09:00' }),
      sol({ id: 'b', inicio: '2026-11-19T08:00', fim: '2026-11-19T09:00' }),
      sol({ id: 'c', servico: 'denuncia', status: 'aberta', criado_em: '2026-11-18T13:00:00.000Z' }),
    ]
    expect(filtrar(itens, { ...FILTROS_VAZIOS, de: '2026-11-18' }, agora).map((s) => s.id)).toEqual(['b', 'c'])
    expect(filtrar(itens, { ...FILTROS_VAZIOS, ate: '2026-11-18' }, agora).map((s) => s.id)).toEqual(['a', 'c'])
    expect(filtrar(itens, { ...FILTROS_VAZIOS, de: '2026-11-18', ate: '2026-11-18' }, agora).map((s) => s.id)).toEqual(['c'])
  })

  it('contagem da opção = número de linhas ao ligar a opção; Limpar volta ao total', () => {
    const agora = '2026-11-18T10:00'
    const itens = [
      sol({ id: '1', servico: 'lavagem', apto: '101', morador: 'Luíza' }),
      sol({ id: '2', servico: 'diaria', apto: '101', pago: false, morador: 'Luíza' }),
      sol({ id: '3', servico: 'diaria', apto: '202', pago: true, morador: 'Tiago' }),
      sol({ id: '4', servico: 'denuncia', apto: null, status: 'aberta', anonima: true }),
    ]
    const f = { ...FILTROS_VAZIOS, apto: '101' }
    const porServico = filtrar(itens, f, agora, 'servico')
    const contagemDiaria = porServico.filter((s) => s.servico === 'diaria').length
    expect(filtrar(itens, { ...f, servico: 'diaria' }, agora)).toHaveLength(contagemDiaria)
    expect(filtrar(itens, { ...FILTROS_VAZIOS, situacao: 'pagamento' }, agora).map((s) => s.id)).toEqual(['2'])
    expect(filtrar(itens, { ...FILTROS_VAZIOS, apto: '-' }, agora).map((s) => s.id)).toEqual(['4'])
    expect(filtrar(itens, FILTROS_VAZIOS, agora)).toHaveLength(itens.length)
  })
})
