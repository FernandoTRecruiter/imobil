// Testes da foto (opcional) da pessoa: a conferência do arquivo, a regra do campo e a gravação.
// Rodam em Node, sem navegador: o que precisa de canvas (a redução em si) não entra aqui; o que
// entra é tudo o que acontece ANTES de abrir a imagem (é ali que mora a recusa com causa e conserto).
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import { PHOTO_MAX_BYTES, PhotoError, photoFileProblem, photoSchema, reducePhoto } from './foto'
import { createPerson, documentOptional, personSchema, updatePerson, type PersonInput } from './repo'

const TODAY = '2026-11-04'
const TINY = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='

function session(userId: string): Session {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}

function input(over: Partial<PersonInput> = {}): PersonInput {
  return { kind: 'PF', name: 'Teste da Silva', document: '529.982.247-25', email: '', phone: '', tags: [], vendor_categories: [], notes: '', photo: null, ...over }
}

beforeEach(() => {
  resetForTest(TODAY)
})

describe('conferência do arquivo de foto', () => {
  it('recusa arquivo que não é imagem, dizendo o nome e o que escolher', () => {
    expect(photoFileProblem({ name: 'contrato.pdf', size: 1000, type: 'application/pdf' })).toMatch(/"contrato.pdf" não é uma imagem.*JPG, PNG ou WebP/)
  })

  it('recusa imagem acima de 5 MB, dizendo o tamanho e o conserto', () => {
    const msg = photoFileProblem({ name: 'grande.jpg', size: PHOTO_MAX_BYTES + 1, type: 'image/jpeg' })
    expect(msg).toMatch(/tem 5,1 MB; o limite é 5 MB/)
    expect(msg).toMatch(/reduza a foto/)
    expect(photoFileProblem({ name: 'ok.jpg', size: PHOTO_MAX_BYTES, type: 'image/jpeg' })).toBeNull()
  })

  it('reducePhoto recusa (PhotoError) antes de tentar abrir o arquivo', async () => {
    const pdf = new File(['%PDF-1.7'], 'laudo.pdf', { type: 'application/pdf' })
    await expect(reducePhoto(pdf)).rejects.toBeInstanceOf(PhotoError)
    const big = new File([new Uint8Array(PHOTO_MAX_BYTES + 10)], 'foto.jpg', { type: 'image/jpeg' })
    await expect(reducePhoto(big)).rejects.toThrow(/limite é 5 MB/)
  })

  it('o campo só aceita imagem pequena embutida (data:), nunca link externo', () => {
    expect(photoSchema.safeParse(TINY).success).toBe(true)
    expect(photoSchema.safeParse('https://exemplo.example/foto.jpg').success).toBe(false)
    expect(photoSchema.safeParse('data:image/svg+xml;base64,PHN2Zy8+').success).toBe(false)
    expect(photoSchema.safeParse(`data:image/webp;base64,${'A'.repeat(300_000)}`).success).toBe(false)
  })
})

describe('foto e documento na ficha da pessoa', () => {
  it('equipe do prédio pode ficar sem CPF; prestador e quem não tem papel, não', () => {
    expect(documentOptional(['caretaker'])).toBe(true)
    expect(documentOptional(['syndic', 'contact'])).toBe(true)
    expect(documentOptional(['caretaker', 'vendor'])).toBe(false)
    expect(documentOptional([])).toBe(false)
    expect(personSchema.safeParse(input({ document: '', tags: ['caretaker'] })).success).toBe(true)
    expect(personSchema.safeParse(input({ document: '', tags: ['vendor'] })).success).toBe(false)
  })

  it('grava a foto; editar sem mandar a foto mantém; a auditoria guarda só "foto nova", nunca a imagem', async () => {
    const s = session(USER.admin)
    const p = await createPerson(s, input({ photo: TINY }))
    expect(p.photo).toBe(TINY)
    const semFoto = input({ name: 'Teste Renomeado' })
    delete semFoto.photo // quem chama sem a foto não apaga a foto que existe
    const kept = await updatePerson(s, { ...semFoto, id: p.id })
    expect(kept.photo).toBe(TINY)
    const removed = await updatePerson(s, { ...input({ name: 'Teste Renomeado' }), photo: null, id: p.id })
    expect(removed.photo).toBeNull()
    const log = getDb().audit_logs.find((l) => l.entity_id === p.id && l.changes?.photo)!
    expect(log.changes!.photo).toEqual({ from: 'foto anterior', to: null })
    expect(JSON.stringify(getDb().audit_logs.filter((l) => l.entity_id === p.id))).not.toContain('base64')
  })

  it('duas pessoas da equipe sem CPF não se acusam de documento repetido', async () => {
    const s = session(USER.admin)
    await createPerson(s, input({ name: 'Zelador Um', document: '', tags: ['caretaker'] }))
    await expect(createPerson(s, input({ name: 'Zelador Dois', document: '', tags: ['caretaker'] }))).resolves.toMatchObject({ document: '' })
  })
})
