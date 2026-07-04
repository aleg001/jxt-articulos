// sync.mjs — pipeline Drive → repo de contenido
//
// Uso:
//   node scripts/sync.mjs                    → procesa la carpeta inbox/
//   node scripts/sync.mjs <archivo.zip>      → zip completo descargado de Drive
//   node scripts/sync.mjs <carpeta>          → carpeta con .docx (recursivo)
//   node scripts/sync.mjs <archivo.docx>     → un solo artículo
//   ... [--force]                            → reconvierte aunque el .md ya exista
//
// 1. Convierte cada "DD-MM-AA Autor.docx" nuevo a content/<año>/<fecha>-<slug>.md
// 2. Regenera index.json leyendo TODOS los .md de content/ (incluye ediciones manuales)
//
// Opcional: scripts/aliases.json normaliza nombres de autor:
//   { "Jose Caxaj": "José Caxaj Laguardia" }

import mammoth from 'mammoth'
import TurndownService from 'turndown'
import { readdir, readFile, mkdir, writeFile, mkdtemp, access } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, basename, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, '..')
const contentDir = join(repoRoot, 'content')
const indexFile = join(repoRoot, 'index.json')

const exists = (p) => access(p).then(() => true, () => false)

const args = process.argv.slice(2)
const force = args.includes('--force')
let input = args.find((a) => !a.startsWith('--'))
if (!input) {
  input = join(repoRoot, 'inbox')
  if (!(await exists(input))) {
    console.error('No hay carpeta inbox/ ni argumento. Uso: node scripts/sync.mjs <zip|carpeta|docx> [--force]')
    process.exit(1)
  }
}

let aliases = {}
try {
  aliases = JSON.parse(await readFile(join(scriptDir, 'aliases.json'), 'utf8'))
} catch { /* sin aliases.json, no pasa nada */ }

const turndown = new TurndownService({ headingStyle: 'atx' })

const slugify = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

async function* walk(dir, ext) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue
    if (entry.isDirectory()) yield* walk(join(dir, entry.name), ext)
    else if (entry.name.endsWith(ext)) yield join(dir, entry.name)
  }
}

// ---- 1. Entrada: zip, carpeta o .docx suelto ------------------------------

const docxFiles = []
if (input.endsWith('.zip')) {
  // ditto y no unzip: los zips de Drive traen nombres UTF-8 sin marcar y unzip los rompe
  const tmp = await mkdtemp(join(os.tmpdir(), 'articulos-'))
  execFileSync('ditto', ['-x', '-k', input, tmp])
  for await (const f of walk(tmp, '.docx')) docxFiles.push(f)
} else if (input.endsWith('.docx')) {
  docxFiles.push(input)
} else {
  for await (const f of walk(input, '.docx')) docxFiles.push(f)
}

// ---- 2. Convertir los nuevos ----------------------------------------------

// "01-07-21 David Chávez.docx" | "11-02-2021 Juan de Dios Soberanis.docx"
const FILENAME_RE = /^(\d{2})-(\d{2})-(\d{2}|\d{4})\s+(.+?)\s*\.docx$/

let nuevos = 0, saltados = 0
const errores = []

for (const file of docxFiles) {
  const name = basename(file)
  const m = name.normalize('NFC').match(FILENAME_RE)
  if (!m) {
    errores.push(`${name} — el nombre no sigue el patrón DD-MM-AA Autor.docx`)
    continue
  }
  const [, dd, mm, yy, rawAuthor] = m
  const author = aliases[rawAuthor] ?? rawAuthor
  const year = yy.length === 2 ? `20${yy}` : yy
  const date = `${year}-${mm}-${dd}`

  let md
  try {
    const { value: html } = await mammoth.convertToHtml({ path: file })
    // Los .docx traen imágenes-basura de 1px; los artículos son 100% texto
    md = turndown.turndown(html).replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  } catch (e) {
    errores.push(`${name} — no se pudo leer el .docx: ${e.message}`)
    continue
  }

  // Primera línea no vacía = título; si la siguiente es el autor, se descarta
  const clean = (s) => (s ?? '').replace(/^#+\s*/, '').replace(/[*_\\]/g, '').trim()
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  const title = clean(lines[i])
  i++
  while (i < lines.length && !lines[i].trim()) i++
  if (slugify(clean(lines[i])) === slugify(rawAuthor)) i++
  const body = lines.slice(i).join('\n').trim()

  if (!title || !body) {
    errores.push(`${name} — no pude separar título/contenido, revisar a mano`)
    continue
  }

  const dest = join(contentDir, year, `${date}-${slugify(title)}.md`)
  if (!force && (await exists(dest))) { saltados++; continue }

  const fm = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `author: ${JSON.stringify(author)}`,
    `date: ${date}`,
    '---',
  ].join('\n')

  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, `${fm}\n\n${body}\n`)
  console.log(`✓ ${name} → ${relative(repoRoot, dest)}`)
  nuevos++
}

// ---- 3. Regenerar index.json desde los .md --------------------------------

const FM_RE = /^---\n([\s\S]*?)\n---/
const index = []

if (await exists(contentDir)) {
  for await (const file of walk(contentDir, '.md')) {
    const raw = await readFile(file, 'utf8')
    const fm = raw.match(FM_RE)?.[1]
    const field = (k) => {
      const v = fm?.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim()
      return v?.startsWith('"') ? JSON.parse(v) : v
    }
    const title = field('title'), author = field('author'), date = field('date')
    if (!title || !author || !date) {
      errores.push(`${relative(repoRoot, file)} — frontmatter incompleto, fuera del índice`)
      continue
    }
    index.push({
      slug: basename(file, '.md'),
      title,
      author,
      authorSlug: slugify(author),
      date,
      year: Number(date.slice(0, 4)),
      path: relative(repoRoot, file),
    })
  }
}

index.sort((a, b) => b.date.localeCompare(a.date))
await writeFile(indexFile, JSON.stringify(index, null, 2) + '\n')

// ---- Resumen ----------------------------------------------------------------

const autores = new Set(index.map((a) => a.authorSlug))
console.log(`\n${nuevos} nuevos, ${saltados} ya existían — índice: ${index.length} artículos, ${autores.size} autores`)
if (errores.length) {
  console.log(`${errores.length} con problemas:`)
  errores.forEach((e) => console.log(`  ✗ ${e}`))
  process.exitCode = 1
}
