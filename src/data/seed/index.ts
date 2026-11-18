/* =============================================================================
   seed: monta o banco fictício inteiro a partir de uma data de referência ("hoje").
   A ordem importa: contrato precisa de unidade e dono; repasse precisa dos pagamentos e
   das despesas de manutenção; documento precisa de contrato, vistoria e repasse.
   ============================================================================= */
import type { Db } from '../db'
import type { IsoDate } from '../types'
import { createCtx } from './ctx'
import { seedAccounts, seedAgencyProperties, seedLandlordProperties } from './imoveis'
import { seedLeases, seedManagementContracts } from './contratos'
import { seedRentAndPayments, seedTransfers, seedVacantCondoFees } from './financeiro'
import { seedCommunication } from './comunicacao'
import { seedCadastro } from './cadastro'
import { seedAuditAndImport, seedAutomations, seedDocuments, seedInspections, seedMaintenance, seedSpatial, seedWorkflows } from './operacao'

export { PERSONAS, ORG, USER } from './catalogo'

export function seedDb(ref: IsoDate): Db {
  const c = createCtx(ref)
  seedAccounts(c) //              1. organizações, logins, personas
  seedAgencyProperties(c) //      2. imóveis da imobiliária
  seedLandlordProperties(c) //    3. imóveis da proprietária independente
  seedManagementContracts(c) //   4a. contratos de administração (a taxa do repasse)
  seedLeases(c) //                4b. locações, partes e linha do tempo
  seedRentAndPayments(c) //       5. aluguéis e pagamentos
  seedVacantCondoFees(c) //       5b. condomínio de unidade vaga (despesa do dono)
  seedMaintenance(c) //           6. chamados (os concluídos viram conta a pagar)
  seedTransfers(c) //             7. repasses
  seedInspections(c) //           8. vistorias
  seedWorkflows(c) //             9. processos e tarefas
  seedAutomations(c) //           10. automações e avisos
  seedDocuments(c) //             11. documentos
  seedAuditAndImport(c) //        12. auditoria e uma importação antiga
  seedSpatial(c) //               13. modelo do 3D e cores de situação
  seedCommunication(c) //         14. equipe dos imóveis, rotinas, comunicados e e-mails (simulados)
  seedCadastro(c) //              15. renovações antigas e moradia das pessoas (o último: só acrescenta)
  return c.db
}
