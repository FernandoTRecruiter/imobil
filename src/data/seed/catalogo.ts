/* =============================================================================
   catalogo.ts: o que é FIXO nos dados fictícios (ids das personas, listas de nomes e ruas).

   Ids fixos para organizações e personas: assim a persona escolhida no "Ver como" continua
   valendo depois de "Restaurar dados de demonstração".
   Tudo aqui é inventado. E-mail usa o domínio reservado example.com (não entrega nada) e
   telefone começa com 0 depois do DDD (número que não existe).
   ============================================================================= */
import type { Id, Role } from '../types'

export const SEED = 20261104

export const ORG = {
  agency: 'a0000000-0000-4000-8000-000000000001',
  landlord: 'a0000000-0000-4000-8000-000000000002',
} as const

export const USER = {
  admin: 'b0000000-0000-4000-8000-000000000001',
  staff: 'b0000000-0000-4000-8000-000000000002',
  leasing: 'b0000000-0000-4000-8000-000000000003',
  maint: 'b0000000-0000-4000-8000-000000000004',
  owner: 'b0000000-0000-4000-8000-000000000005',
  lessee: 'b0000000-0000-4000-8000-000000000006',
  vendor: 'b0000000-0000-4000-8000-000000000007',
  landlord: 'b0000000-0000-4000-8000-000000000008',
} as const

export interface PersonaDef {
  userId: Id
  orgId: Id
  role: Role
  name: string
  email: string
  label: string // o que aparece no seletor "Ver como"
  hint: string // a explicação curta do que essa persona enxerga
}

export const PERSONAS: PersonaDef[] = [
  { userId: USER.admin, orgId: ORG.agency, role: 'admin', name: 'Ana Ribeiro', email: 'ana.ribeiro@example.com', label: 'Administradora da imobiliária', hint: 'Vê e configura tudo da Imobiliária Aurora.' },
  { userId: USER.staff, orgId: ORG.agency, role: 'staff', name: 'Bruno Teixeira', email: 'bruno.teixeira@example.com', label: 'Colaborador do financeiro', hint: 'Vê cadastros e contratos; edita só o financeiro.' },
  { userId: USER.owner, orgId: ORG.agency, role: 'owner', name: 'Carlos Mendes', email: 'carlos.mendes@example.com', label: 'Proprietário convidado (portal)', hint: 'Só os imóveis dele administrados pela Aurora.' },
  { userId: USER.lessee, orgId: ORG.agency, role: 'lessee', name: 'Daniela Freitas', email: 'daniela.freitas@example.com', label: 'Inquilina (portal)', hint: 'Só o próprio contrato, cobranças e chamados.' },
  { userId: USER.vendor, orgId: ORG.agency, role: 'vendor', name: 'Eduardo Lima', email: 'eduardo@example.com', label: 'Prestador de serviço (portal)', hint: 'Só os chamados atribuídos a ele.' },
  { userId: USER.landlord, orgId: ORG.landlord, role: 'admin', name: 'Marina Lopes', email: 'marina.lopes@example.com', label: 'Proprietária independente', hint: 'Conta própria, sem imobiliária: administra os próprios imóveis.' },
]

/** Colaboradores extras da imobiliária (aparecem como responsáveis, não no seletor). */
export const EXTRA_STAFF = [
  { userId: USER.leasing, name: 'Fernanda Costa', email: 'fernanda.costa@example.com' },
  { userId: USER.maint, name: 'Gilberto Araújo', email: 'gilberto.araujo@example.com' },
]

export const FIRST_NAMES_F = ['Ana', 'Beatriz', 'Camila', 'Débora', 'Elisa', 'Flávia', 'Gabriela', 'Helena', 'Isabela', 'Juliana', 'Larissa', 'Mariana', 'Natália', 'Olívia', 'Patrícia', 'Renata', 'Sofia', 'Tatiane', 'Vanessa', 'Yasmin', 'Aline', 'Bruna', 'Carolina', 'Lívia', 'Priscila', 'Raquel', 'Simone', 'Luana']
export const FIRST_NAMES_M = ['André', 'Bernardo', 'Caio', 'Diego', 'Eduardo', 'Flávio', 'Gabriel', 'Henrique', 'Igor', 'João', 'Leonardo', 'Marcelo', 'Nicolas', 'Otávio', 'Paulo', 'Rafael', 'Samuel', 'Thiago', 'Vinícius', 'Lucas', 'Matheus', 'Renan', 'Rodrigo', 'Vitor', 'Fábio', 'Guilherme', 'Murilo', 'Pedro']
export const SURNAMES = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferraz', 'Gomes', 'Honorato', 'Lacerda', 'Machado', 'Nogueira', 'Oliveira', 'Pacheco', 'Queiroz', 'Rezende', 'Sampaio', 'Tavares', 'Vasconcelos', 'Xavier', 'Andrade', 'Brandão', 'Campos', 'Dias', 'Fonseca', 'Guimarães', 'Leal', 'Moura', 'Pires', 'Rocha', 'Siqueira', 'Teles', 'Viana']

export const COMPANY_WORDS = ['Horizonte', 'Serra Azul', 'Ipê', 'Alvorada', 'Cerrado', 'Vale Verde', 'Monte Claro', 'Nascente', 'Aroeira', 'Jequitibá', 'Campo Belo', 'Boa Vista']
export const COMPANY_KINDS = ['Comércio Ltda', 'Serviços Ltda', 'Tecnologia Ltda', 'Consultoria Ltda', 'Alimentos Ltda', 'Engenharia Ltda']

/** Bairros de Belo Horizonte com o centro aproximado (lat, lng). Endereços e números são inventados. */
export const DISTRICTS: { name: string; lat: number; lng: number }[] = [
  { name: 'Buritis', lat: -19.9745, lng: -43.972 },
  { name: 'Savassi', lat: -19.9365, lng: -43.9355 },
  { name: 'Funcionários', lat: -19.9317, lng: -43.9306 },
  { name: 'Lourdes', lat: -19.9334, lng: -43.9443 },
  { name: 'Sion', lat: -19.9533, lng: -43.9333 },
  { name: 'Gutierrez', lat: -19.9381, lng: -43.9606 },
  { name: 'Prado', lat: -19.9254, lng: -43.9612 },
  { name: 'Pampulha', lat: -19.8577, lng: -43.9707 },
  { name: 'Santa Efigênia', lat: -19.9241, lng: -43.9201 },
  { name: 'Serra', lat: -19.9409, lng: -43.9201 },
  { name: 'Cidade Nova', lat: -19.8835, lng: -43.9268 },
  { name: 'Castelo', lat: -19.8826, lng: -44.0003 },
  { name: 'Centro', lat: -19.9191, lng: -43.9386 },
]

export const STREETS = ['Rua das Acácias', 'Rua dos Ipês', 'Avenida das Palmeiras', 'Rua Jacarandá', 'Rua das Hortênsias', 'Rua dos Girassóis', 'Rua Manacá', 'Rua Quaresmeira', 'Rua Sabiá', 'Rua Bem-te-vi', 'Rua Pau-Brasil', 'Rua Sucupira', 'Rua das Orquídeas', 'Rua Cedro', 'Avenida Aroeira']

export const VENDOR_DEFS = [
  { name: 'Eduardo Lima', kind: 'PF' as const, categories: ['plumbing', 'electrical'] as const, persona: true },
  { name: 'Pinta Bem Pinturas Ltda', kind: 'PJ' as const, categories: ['painting'] as const },
  { name: 'Chave Mestra Serralheria Ltda', kind: 'PJ' as const, categories: ['locksmith', 'structure'] as const },
  { name: 'Frio Total Refrigeração Ltda', kind: 'PJ' as const, categories: ['appliance'] as const },
  { name: 'Brilho Limpeza Ltda', kind: 'PJ' as const, categories: ['cleaning'] as const },
  { name: 'Construir Reformas Ltda', kind: 'PJ' as const, categories: ['structure', 'painting'] as const },
  { name: 'Rogério Fontes', kind: 'PF' as const, categories: ['electrical'] as const },
  { name: 'Hidro Já Encanamentos Ltda', kind: 'PJ' as const, categories: ['plumbing'] as const },
]

export const MAINTENANCE_TITLES: Record<string, string[]> = {
  plumbing: ['Vazamento na pia da cozinha', 'Descarga do banheiro não para', 'Infiltração no teto do banheiro', 'Registro do chuveiro pingando'],
  electrical: ['Disjuntor desarmando', 'Tomada da sala sem energia', 'Chuveiro elétrico queimado', 'Interfone sem som'],
  painting: ['Pintura da sala descascando', 'Mofo na parede do quarto'],
  locksmith: ['Fechadura da porta principal emperrada', 'Troca de segredo da fechadura'],
  appliance: ['Ar-condicionado não gela', 'Aquecedor a gás sem chama'],
  structure: ['Rachadura na parede da varanda', 'Portão da garagem desalinhado'],
  cleaning: ['Limpeza pós-obra', 'Limpeza para entrega de chaves'],
  other: ['Vidro da janela trincado'],
}
