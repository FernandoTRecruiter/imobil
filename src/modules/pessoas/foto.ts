/* =============================================================================
   foto.ts: a foto (opcional) de uma pessoa, como zelador, porteiro e síndico.

   O que resolve: a foto do celular tem 3 a 8 MB e 4.000 px. Guardada assim, o cadastro ficaria
   pesado e o patch do modo de demonstração (localStorage, poucos MB) estouraria com meia dúzia
   de fotos. Por isso a foto é REDUZIDA no navegador antes de gravar:
     1. confere o arquivo (é imagem? tem até 5 MB?) e recusa com causa e conserto;
     2. lê a imagem e corta o quadrado do meio (o avatar é redondo: foto em pé esticaria o rosto);
     3. desenha esse quadrado num canvas de no máximo 160 x 160 px;
     4. exporta em WebP (ou JPEG, se o navegador não souber WebP) com qualidade 0,8.
   O resultado é um texto "data:image/webp;base64,..." de uns 5 a 15 KB, que cabe na linha da pessoa.

   FASE 2: a foto vai para o Storage privado do Supabase (um arquivo por pessoa) e a linha guarda
   só o caminho; a tela pede um link assinado que expira em minutos. O corte e a redução continuam
   aqui no navegador (sai menos dado pela rede e o servidor não precisa de biblioteca de imagem).
   ============================================================================= */
import { z } from 'zod'

/** Tamanho máximo do arquivo ESCOLHIDO (antes de reduzir). */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
/** Lado máximo da foto guardada, em pixels (o dobro do maior avatar, para ficar nítido em tela de alta densidade). */
export const PHOTO_MAX_PX = 160
/** Teto do texto guardado: 160 x 160 em WebP fica bem abaixo disso; acima, é foto que não passou pela redução. */
export const PHOTO_MAX_CHARS = 200_000

/**
 * Regra do campo "photo" (zod), usada pela tela e pelos repositórios. Aceita só imagem pequena
 * embutida (data:) de tipo raster. Um link externo (http) ficaria fora do nosso controle e
 * deixaria o navegador de quem vê a ficha chamar um endereço de terceiros.
 */
export const photoSchema = z
  .string()
  .max(PHOTO_MAX_CHARS, 'A foto ficou grande demais depois de reduzida. Escolha outra imagem.')
  .regex(/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/, 'Foto em formato que não reconhecemos. Escolha a imagem de novo pelo botão.')

/** O pedaço do arquivo que a conferência usa (File tem os três; assim o teste não precisa de navegador). */
export interface PhotoFileInfo {
  name: string
  size: number
  type: string
}

/** "4,8 MB" para a mensagem de erro. Arredonda PARA CIMA: 5,01 MB não pode aparecer como "5 MB" ao lado de "o limite é 5 MB". */
function mb(bytes: number): string {
  return `${(Math.ceil((bytes / 1024 / 1024) * 10) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

/**
 * Confere o arquivo ANTES de abrir: devolve a mensagem (causa e conserto) ou null se está bom.
 * Conferir primeiro evita travar a aba lendo um PDF de 40 MB que nunca viraria foto.
 */
export function photoFileProblem(file: PhotoFileInfo): string | null {
  if (!file.type.startsWith('image/')) {
    return `"${file.name}" não é uma imagem. Escolha uma foto em JPG, PNG ou WebP.`
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return `A foto tem ${mb(file.size)}; o limite é 5 MB. Escolha outra ou reduza a foto no celular antes de enviar.`
  }
  return null
}

/** Erro de foto com a mensagem pronta para a tela. */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoError'
  }
}

/**
 * Lê a imagem do arquivo. createImageBitmap é o caminho rápido; navegador antigo sem ele usa
 * o <img> com um endereço temporário (URL.createObjectURL), que precisa ser liberado depois.
 */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file)
    return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
}

/**
 * Reduz a foto escolhida para no máximo 160 x 160 px e devolve o texto data: para gravar.
 * Passo a passo no cabeçalho do arquivo. Recusa (PhotoError) arquivo que não é imagem, acima de
 * 5 MB ou que o navegador não consegue abrir (HEIC do iPhone em navegador que não lê HEIC, por exemplo).
 */
export async function reducePhoto(file: File, maxPx = PHOTO_MAX_PX): Promise<string> {
  // 1. conferência barata, antes de abrir o arquivo
  const problem = photoFileProblem(file)
  if (problem) throw new PhotoError(problem)

  // 2. abrir a imagem
  let img: Awaited<ReturnType<typeof decode>>
  try {
    img = await decode(file)
  } catch {
    throw new PhotoError(`Não deu para abrir "${file.name}". Se é foto de iPhone (HEIC), exporte como JPG e tente de novo.`)
  }
  try {
    // 3. o quadrado do meio: lado = o menor dos dois lados da foto
    const side = Math.min(img.width, img.height)
    if (!side) throw new PhotoError(`"${file.name}" está vazia (0 pixels). Escolha outra foto.`)
    const sx = Math.floor((img.width - side) / 2)
    const sy = Math.floor((img.height - side) / 2)
    const out = Math.min(maxPx, side) // foto pequena não é ampliada (ficaria borrada)

    // 4. desenhar no canvas já no tamanho final
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoError('O navegador não deixou desenhar a foto. Tente em outro navegador.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img.source, sx, sy, side, side, 0, 0, out, out)

    // 5. exportar: WebP; o navegador que não sabe WebP devolve PNG (pesado), aí vai JPEG
    const webp = canvas.toDataURL('image/webp', 0.8)
    const data = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.8)
    const check = photoSchema.safeParse(data)
    if (!check.success) throw new PhotoError(check.error.issues[0]?.message ?? 'A foto não ficou boa. Escolha outra.')
    return data
  } finally {
    img.release()
  }
}

/**
 * Como a troca de foto entra na auditoria: só "foto anterior" e "foto nova" (ou vazio). O texto da
 * imagem (KB de base64) nunca vai para a auditoria: ela seria lida devagar e guardaria a foto
 * antiga para sempre, mesmo depois de a pessoa pedir para tirá-la.
 */
export function photoAuditChange(before: string | null | undefined, after: string | null | undefined): { from: unknown; to: unknown } {
  return { from: before ? 'foto anterior' : null, to: after ? 'foto nova' : null }
}
