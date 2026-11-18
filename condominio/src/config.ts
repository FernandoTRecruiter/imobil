/* =============================================================================
   Regras dos serviços. É a MESMA tabela de supabase/schema.sql (seção 1, cond_servicos).
   - Em produção o app lê as regras do banco (cond_regras); este arquivo vale só no modo demonstração.
   - Para mudar um horário: mudar lá e aqui. O teste tests/banco.test.ts falha se ficarem diferentes.
   dias: 0 = domingo ... 6 = sábado. horizonte: quantos dias à frente dá para reservar.
   por_semana: quantas reservas daquele serviço um apartamento pode ter na mesma semana (seg a dom).
   ============================================================================= */

export type Servico = 'lavagem' | 'diaria' | 'estacionamento' | 'denuncia'

export interface Periodo {
  rotulo: string
  de: string // 'HH:mm'
  ate: string
}

/** O que lavagem e diária têm em comum. feriado/facultativo: o serviço fecha ou abre nesses dias. */
export interface Reservavel {
  dias: number[]
  horizonte: number
  por_semana: number
  feriado: 'abre' | 'fecha'
  facultativo: 'abre' | 'fecha'
  /** true = nasce com "pagamento pendente" (desligado em 17/11). */
  cobra: boolean
}

export type ConfigServico =
  | ({ tipo: 'horario'; abre: string; fecha: string; minutos: number } & Reservavel)
  | ({ tipo: 'periodo'; periodos: Periodo[] } & Reservavel)
  | { tipo: 'pedido'; max_dias: number; cobra: boolean }
  | { tipo: 'denuncia'; categorias: string[] }

export interface ServicoDef {
  chave: Servico
  nome: string
  /** false = o serviço some do app (estacionamento, desligado em 17/11). */
  ativo: boolean
  config: ConfigServico
}

export const SERVICOS_PADRAO: ServicoDef[] = [
  {
    chave: 'lavagem',
    nome: 'Lavagem e secagem',
    ativo: true,
    config: { tipo: 'horario', abre: '07:00', fecha: '22:00', minutos: 60, dias: [0, 1, 2, 3, 4, 5, 6], horizonte: 7, por_semana: 3, feriado: 'abre', facultativo: 'abre', cobra: false },
  },
  {
    chave: 'diaria',
    nome: 'Diária',
    ativo: true,
    config: {
      tipo: 'periodo',
      periodos: [
        { rotulo: 'Manhã', de: '08:00', ate: '12:00' },
        { rotulo: 'Tarde', de: '13:00', ate: '17:00' },
      ],
      dias: [1, 2, 3, 4, 5, 6],
      horizonte: 14,
      por_semana: 2,
      feriado: 'fecha',
      facultativo: 'abre',
      cobra: false,
    },
  },
  { chave: 'estacionamento', nome: 'Estacionamento', ativo: false, config: { tipo: 'pedido', max_dias: 7, cobra: false } },
  {
    chave: 'denuncia',
    nome: 'Denúncia',
    ativo: true,
    config: { tipo: 'denuncia', categorias: ['Barulho', 'Área comum', 'Segurança', 'Animais', 'Lixo e limpeza', 'Obras', 'Outro'] },
  },
]

/** Feriado da cidade ou do estado: data fixa (mes/dia) OU dias depois da Páscoa. */
export interface FeriadoLocal {
  nome: string
  mes: number | null
  dia: number | null
  pascoa: number | null
  lei: string
}

/** Belo Horizonte (Lei municipal 11.397/2022). Igual à semente de cond_feriados_locais no banco. */
export const FERIADOS_LOCAIS_PADRAO: FeriadoLocal[] = [
  { nome: 'Sexta-feira da Paixão', mes: null, dia: null, pascoa: -2, lei: 'BH, Lei 11.397/2022' },
  { nome: 'Corpus Christi', mes: null, dia: null, pascoa: 60, lei: 'BH, Lei 11.397/2022' },
  { nome: 'Assunção de Nossa Senhora', mes: 8, dia: 15, pascoa: null, lei: 'BH, Lei 11.397/2022' },
  { nome: 'Imaculada Conceição', mes: 12, dia: 8, pascoa: null, lei: 'BH, Lei 11.397/2022' },
]

/** Nome do condomínio que aparece no topo (definido no .env; sem ele, só "Condomínio"). */
export const NOME_CONDOMINIO: string = (import.meta.env?.VITE_NOME_CONDOMINIO as string | undefined)?.trim() ?? ''
