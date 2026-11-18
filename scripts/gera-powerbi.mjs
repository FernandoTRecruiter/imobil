// =============================================================================
// gera-powerbi.mjs: transforma a Visão geral num HTML ÚNICO e numa MEDIDA DAX para o visual
// "HTML Content" do Power BI. Mesmo caminho do gera_powerbi.py do portfólio (people-analytics).
//
// Por que precisa de um gerador:
//   - o Power BI não lê arquivos separados: o JavaScript e o CSS têm de estar dentro de um
//     texto só, e sem internet (a fonte do app fica de fora; vale a do sistema);
//   - o DAX aceita no máximo ~32 mil caracteres por texto, então o HTML vai em pedaços
//     (_a1, _d1...) que a medida junta no RETURN;
//   - os dados não vão no código: a medida monta o JSON das suas tabelas com CONCATENATEX e
//     põe em window.DADOS_BRUTOS ANTES do script do painel (formato em src/powerbi/schema.ts).
//
// Rodar (na pasta do projeto):  npm run powerbi          (data dos exemplos: hoje em Brasília)
//                               npm run powerbi -- --hoje 2026-11-04
// Saídas em powerbi/saida/ (fora do git; rode de novo quando o código mudar):
//   VisaoGeral.html          o HTML único com os dados fictícios (abra no navegador para conferir)
//   MedidaVisaoGeral.dax     a medida para colar no Power BI
//   Unidades.csv, Vagas.csv, Contratos.csv, Lancamentos.csv, Chamados.csv, Tarefas.csv, Rotinas.csv
//                            os dados fictícios no esquema (Tarefas e Chamados SEM coluna de pessoa)
//   teste_csv.html           o HTML lendo os CSVs como se fosse o Power BI (prova do adaptador)
//   conferencia.txt          os números que o Power BI tem de mostrar com os CSVs de exemplo
// =============================================================================
import { build, runnerImport } from 'vite'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SAIDA = resolve(RAIZ, 'powerbi', 'saida')
const LIMITE = 30000 // caracteres por pedaço, já contando as aspas dobradas do DAX
const TETO_HTML = 350 * 1024 // acima disso a medida fica pesada: avisar para enxugar
// Tabelas que um modelo pode não ter: sem elas o painel só esconde o número que depende delas.
const OPCIONAIS = ['Vagas', 'Tarefas', 'Rotinas']
// A barra invertida escrita pelo código (e não digitada) para nenhum editor transformar a sequência.
const BARRA = String.fromCharCode(92)

const mil = (n) => n.toLocaleString('pt-BR')
const reais = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (x) => (x === null ? 'sem base' : `${(x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`)

/** "Hoje" no fuso de Brasília (o mesmo do app); --hoje AAAA-MM-DD troca, para repetir uma rodada. */
function hojeDaRodada() {
  const i = process.argv.indexOf('--hoje')
  const pedido = i >= 0 ? process.argv[i + 1] : null
  if (pedido && !/^\d{4}-\d{2}-\d{2}$/.test(pedido)) throw new Error(`--hoje precisa ser AAAA-MM-DD (veio "${pedido}").`)
  return pedido ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

// Passo 1: o build do painel (vite.powerbi.config.ts) e a remontagem do HTML em duas metades.
// "antes" = cabeça com o CSS + a div onde o painel desenha; "depois" = o script do painel.
// A medida põe o <script> com os dados ENTRE as duas: quando o painel roda, o dado já está lá.
async function montarHtml() {
  await build({ configFile: resolve(RAIZ, 'vite.powerbi.config.ts'), logLevel: 'warn' })
  const pasta = resolve(SAIDA, 'build')
  const bruto = readFileSync(resolve(pasta, 'index.html'), 'utf8')
  rmSync(pasta, { recursive: true, force: true })
  const css = bruto.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1]
  const js = bruto.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
  if (!css || !js || js.length < 10000) throw new Error('O build não trouxe o CSS e o JavaScript embutidos: confira o vite.powerbi.config.ts.')
  // "</script" dentro do código fecharia a tag antes da hora (o plugin já troca; aqui só conferimos).
  if (/<\/script/i.test(js)) throw new Error('O JavaScript tem "</script" solto: o HTML quebraria.')
  const antes =
    '<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Imobil · Visão geral</title>' +
    `<style>${css}</style></head><body><div id="root"></div>`
  const depois = `<script>${js}</script></body></html>`
  conferirSemInternet(antes + depois)
  return { antes, depois }
}

/** O visual roda sem internet: nenhum arquivo de fora pode ser pedido (fonte, script, imagem). */
function conferirSemInternet(html) {
  const proibido = [
    [/<link\b/i, 'tag <link>'],
    [/<script[^>]+\bsrc=/i, 'script com src'],
    [/<img[^>]+\bsrc=["']?https?:/i, 'imagem de fora'],
    [/url\(\s*["']?(https?:)?\/\//i, 'url() de fora no CSS'],
    [/@import/i, '@import no CSS'],
    [/@font-face/i, 'fonte embutida'],
  ]
  for (const [re, nome] of proibido) if (re.test(html)) throw new Error(`O HTML tem ${nome}: o visual do Power BI não tem internet.`)
}

// Passo 2: pedaços de texto DAX (aspas viram aspas dobradas) com no máximo LIMITE caracteres.
// O par "" nunca é partido entre dois pedaços (cada caractere entra já escapado, inteiro).
function pedacosDax(texto) {
  const pedacos = []
  let atual = ''
  for (const ch of texto) {
    const esc = ch === '"' ? '""' : ch
    if (atual.length + esc.length > LIMITE) {
      pedacos.push(atual)
      atual = ''
    }
    atual += esc
  }
  if (atual) pedacos.push(atual)
  return pedacos
}

// Passo 3: a medida. Cada coluna do esquema vira um trecho "campo":valor do JSON.
/** Texto entra no JSON entre aspas: troca barra invertida, aspas e quebras de linha; "<" vira o escape u003c. */
function limparTexto(col) {
  return `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${col}, "${BARRA}", "/"), """", "'"), UNICHAR(13), " "), UNICHAR(10), " "), "<", "${BARRA}u003c")`
}

function campo(c, tabela, ultimo) {
  const col = `'${tabela}'[${c.column}]`
  const fim = ultimo ? '' : ','
  if (c.type === 'texto' || c.type === 'codigo') return `        """${c.field}"":""" & ${limparTexto(col)} & """${fim}" &`
  if (c.type === 'data') return `        """${c.field}"":""" & IF(ISBLANK(${col}), "", FORMAT(${col}, "yyyy-mm-dd")) & """${fim}" &`
  // Número sempre INTEIRO: dinheiro em centavos. Com casas decimais, um modelo em português
  // escreveria "8,50" e a vírgula quebraria o JSON.
  const valor = c.type === 'dinheiro' ? `${col} * 100` : col
  return `        """${c.field}"":" & IF(ISBLANK(${col}), "null", FORMAT(${valor}, "0")) & "${fim}" &`
}

/**
 * A medida inteira. "rawKey" (RAW_KEY do schema.ts) dá o nome de cada lista no JSON e da variável
 * DAX dela (_unidades, _vagas...): o mesmo nome que o painel lê, sem lista escrita à mão aqui.
 */
function escreverDax(antes, depois, tabelas, rawKey, hoje) {
  const pa = pedacosDax(antes)
  const pd = pedacosDax(depois)
  const out = [
    'VisaoGeralHTML =',
    `-- Gerado por scripts/gera-powerbi.mjs em ${hoje}. Os blocos _a e _d saem do gerador: nao edite, rode de novo.`,
    `-- PASSO 1: troque ${tabelas.map((t) => `'${t.table}'`).join(', ')} e os nomes entre colchetes`,
    '-- pelos do SEU modelo (veja powerbi/LEIA-ME.md, tabela do esquema coluna a coluna).',
    '-- Valor, ValorPago e Orcamento em reais (a medida converte para centavos).',
    `-- Tabela que o seu modelo nao tem (${OPCIONAIS.map((t) => `'${t}'`).join(', ')}): troque o bloco dela por  VAR _nome = "[]"`,
    '-- e o painel esconde o que depende dela.',
    '',
  ]
  for (const t of tabelas) {
    out.push(
      `VAR _${rawKey[t.key]} =`,
      '    "[" & CONCATENATEX(',
      `        '${t.table}',`,
      '        "{" &',
      ...t.columns.map((c, i) => campo(c, t.table, i === t.columns.length - 1)),
      '        "}",',
      '        ","',
      '    ) & "]"',
      '',
    )
  }
  out.push(
    '-- "Hoje" no fuso de Brasilia (UTC-3, sem horario de verao). No servico, TODAY() e UTC e viraria o dia as 21h.',
    `-- Para conferir com os CSVs de exemplo, troque por:  VAR _hoje = "${hoje}"`,
    'VAR _hoje = FORMAT(UTCNOW() - TIME(3, 0, 0), "yyyy-mm-dd")',
    'VAR _organizacao = "Minha carteira"',
    '',
  )
  pa.forEach((t, i) => out.push(`VAR _a${i + 1} = "${t}"`))
  pd.forEach((t, i) => out.push(`VAR _d${i + 1} = "${t}"`))
  const juntar = (prefixo, n) => Array.from({ length: n }, (_, i) => `${prefixo}${i + 1}`).join(' & ')
  // O JSON dos dados: "hoje", "organizacao" e uma lista por tabela, com o nome que o painel lê (RAW_KEY).
  const listas = tabelas.map((t) => `",""${rawKey[t.key]}"":" & _${rawKey[t.key]} & `).join('')
  out.push(
    '',
    'RETURN',
    `    ${juntar('_a', pa.length)} &`,
    `    "<script>window.DADOS_BRUTOS = {""hoje"":""" & _hoje & """,""organizacao"":""" & _organizacao & """" & ${listas}"};</script>" &`,
    `    ${juntar('_d', pd.length)}`,
  )
  const texto = out.join('\n') + '\n'
  writeFileSync(resolve(SAIDA, 'MedidaVisaoGeral.dax'), texto, 'utf8')
  return { pedacos: pa.length + pd.length, maior: Math.max(...[...pa, ...pd].map((x) => x.length)), tamanho: texto.length }
}

/** Conta os números de um objeto (quantos valores a conferência comparou de verdade). */
function contarNumeros(x) {
  if (typeof x === 'number') return 1
  if (Array.isArray(x)) return x.reduce((a, v) => a + contarNumeros(v), 0)
  if (x && typeof x === 'object') return Object.values(x).reduce((a, v) => a + contarNumeros(v), 0)
  return 0
}

async function main() {
  const hoje = hojeDaRodada()
  mkdirSync(SAIDA, { recursive: true })

  // Passo 1: HTML único.
  const { antes, depois } = await montarHtml()
  const html = antes + depois
  writeFileSync(resolve(SAIDA, 'VisaoGeral.html'), html, 'utf8')

  // Passo 4: o esquema e os dados de exemplo saem do MESMO código TypeScript do app (sem cópia).
  const carregar = (arquivo) => runnerImport(resolve(RAIZ, arquivo), { configFile: false, root: RAIZ, logLevel: 'error', resolve: { alias: { '@': resolve(RAIZ, 'src') } } }).then((r) => r.module)
  const { POWERBI_TABLES, RAW_KEY } = await carregar('src/powerbi/schema.ts')
  const { powerBiExample, overviewFromCsv } = await carregar('src/powerbi/exportar.ts')

  // Passo 3: a medida.
  const dax = escreverDax(antes, depois, POWERBI_TABLES, RAW_KEY, hoje)

  // Passo 5: CSVs de exemplo (";" e UTF-8 com BOM: o Excel e o Power BI em português abrem certo).
  const ex = powerBiExample(hoje)
  for (const f of ex.csv) writeFileSync(resolve(SAIDA, f.name), f.text, 'utf8')

  // Passo 6: PORTÃO. Relê os CSVs DO DISCO, faz o que a medida faria e compara com o cálculo direto.
  const doDisco = ex.csv.map((f) => ({ table: f.table, text: readFileSync(resolve(SAIDA, f.name), 'utf8') }))
  const lido = overviewFromCsv(doDisco, hoje, ex.organizacao)
  if (lido.warnings.length) throw new Error(`PORTÃO VERMELHO: o adaptador reclamou dos CSVs de exemplo: ${lido.warnings.join(' | ')}`)
  if (JSON.stringify(lido.overviews) !== JSON.stringify(ex.direct)) throw new Error('PORTÃO VERMELHO: os indicadores lidos dos CSVs não batem com os calculados direto.')
  const comparados = contarNumeros(ex.direct)
  if (comparados < 100) throw new Error(`PORTÃO VERMELHO: a conferência comparou só ${comparados} números (esperado bem mais).`)

  // Passo 7: o HTML lendo os CSVs como se fosse o Power BI (abra e compare com a Visão geral do app).
  const dados = JSON.stringify(lido.raw).replace(/</g, `${BARRA}u003c`)
  writeFileSync(resolve(SAIDA, 'teste_csv.html'), `${antes}<script>window.DADOS_BRUTOS = ${dados};</script>${depois}`, 'utf8')

  // Passo 8: os números que o Power BI tem de mostrar com os CSVs (e "_hoje" trocado pela data deles).
  // Na ordem dos blocos do painel (Carteira, Financeiro, Clientes, Manutenção, Equipe somada).
  const [, tres, , doze] = ex.direct
  const dias = (d) => (d === null ? 'sem base' : `${d.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dias`)
  const linhas = [
    `Conferência do Power BI com os CSVs de exemplo de ${hoje} (${ex.organizacao})`,
    `Na medida, troque _hoje por "${hoje}". Período no painel: últimos 3 meses (o padrão).`,
    `As setas comparam com o período anterior visto até ${tres.prevToday.split('-').reverse().join('/')} (números de hoje: com esse dia).`,
    '',
    'CARTEIRA',
    `Ocupação ............ ${pct(tres.occupancy.rate)} (${tres.occupancy.occupied} de ${tres.occupancy.rentable} alugáveis; antes ${pct(tres.occupancyPrev.rate)})`,
    `Vacância ............ ${pct(tres.occupancy.vacancy)}`,
    `Disponíveis ......... ${tres.available.count} (média de ${dias(tres.available.avgDays)} desde a última locação)`,
    `Vagas alugadas ...... ${tres.spots.occupied} de ${tres.spots.rentable} (antes ${tres.spotsPrev.occupied})`,
    'FINANCEIRO',
    `Receita recebida .... ${reais(tres.revenue.received)} de ${reais(tres.revenue.forecast)} previstos (antes ${reais(tres.revenuePrev.received)})`,
    `Inadimplência ....... ${pct(tres.revenue.delinquency)} (${reais(tres.revenue.overdue)} vencidos em aberto; antes ${pct(tres.revenuePrev.delinquency)})`,
    `Repasses ............ ${reais(tres.transfers.total)} (antes ${reais(tres.transfersPrev.total)})`,
    `Despesas manutenção . ${reais(tres.upkeep.total)} (antes ${reais(tres.upkeepPrev.total)})`,
    'CLIENTES',
    `Locações vigentes ... ${tres.leases.active} (antes ${tres.leases.activePrev})`,
    `Vencendo ............ ${tres.ending.d30} em 30 dias, ${tres.ending.d60} em 60, ${tres.ending.d90} em 90`,
    `Novos e renovações .. ${tres.signed.fresh} novos, ${tres.signed.renewals} renovações (antes ${tres.signedPrev.fresh} e ${tres.signedPrev.renewals})`,
    `Pontualidade ........ ${pct(tres.punctuality.rate)} (${tres.punctuality.onTime} de ${tres.punctuality.due}; antes ${pct(tres.punctualityPrev.rate)})`,
    'MANUTENÇÃO',
    `Chamados abertos .... ${tres.requests.open} (${tres.requests.late} atrasados; antes ${tres.requestsPrev.open} e ${tres.requestsPrev.late})`,
    `Tempo de resolução .. ${dias(tres.resolution.avgDays)} (${tres.resolution.count} resolvidos; antes ${dias(tres.resolutionPrev.avgDays)})`,
    `Rotinas vencidas .... ${tres.routines.overdue} de ${tres.routines.active} ligadas`,
    'EQUIPE (SOMADA)',
    `Tarefas no prazo .... ${pct(tres.tasks.rate)} (${tres.tasks.onTime} de ${tres.tasks.measured}); ${tres.tasks.late} atrasadas`,
    '',
    `Com "Últimos 12 meses": receita prevista ${reais(doze.revenue.forecast)}, inadimplência ${pct(doze.revenue.delinquency)}.`,
  ]
  writeFileSync(resolve(SAIDA, 'conferencia.txt'), linhas.join('\r\n') + '\r\n', 'utf8')

  const kb = (n) => (n / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  const bytes = Buffer.byteLength(html, 'utf8')
  console.log(`HTML único: ${mil(html.length)} caracteres (${kb(bytes)} KB)${bytes > TETO_HTML ? '  << ACIMA DE 350 KB: enxugar' : ''}`)
  console.log(`MedidaVisaoGeral.dax: ${dax.pedacos} pedaços de HTML, o maior com ${mil(dax.maior)} caracteres (limite ${mil(LIMITE)}); medida inteira com ${mil(dax.tamanho)} caracteres`)
  console.log(`CSVs de exemplo (${hoje}): ${ex.csv.map((f) => `${f.name} ${mil(f.rows)} linhas`).join(', ')}`)
  console.log(`Conferência: os ${mil(comparados)} valores da Visão geral (4 períodos) lidos dos CSVs gravados batem com o cálculo direto.`)
  console.log(`Ocupação ${pct(tres.occupancy.rate)} · inadimplência (3 meses) ${pct(tres.revenue.delinquency)} · pontualidade ${pct(tres.punctuality.rate)} · tarefas no prazo ${pct(tres.tasks.rate)} · detalhes em powerbi/saida/conferencia.txt`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
