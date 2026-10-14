// check-sites.mjs —— 站点经验库的机械门禁。
//
// 校验两件事，缺一即 exit 1：
//   ① 索引 ↔ 实体【双向一一对应】：knowledge/INDEX.md 表格第一格的反引号域名
//      与 knowledge/sites/*.md 文件名互为全集；
//   ② 每个手册文件具备必需小节（说明性文件不算手册）。
//
// ⚠️ 2026-10-14 插件化后**去掉了"注入存根"那一条断言**：库搬进本插件、
//    库位置改由插件自己的 systemPrompt 段注入，工作区根的 SITES.md 存根已删除。
//    （门禁的不变量必须跟着架构走 —— 它当时正是靠这条断言报出了"存根不见了"，逼我来改它。）
//
// 用法：
//   node check-sites.mjs             # 校验真实库
//   node check-sites.mjs --self-test # 漂移自测：合成样例，确认「好的过、坏的必须红」
//
// 纯 ASCII 代码 + 显式 utf8（工作区规则 15）。
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 本脚本【自我定位】：索引与手册都在本包内的 knowledge/ 下 ⇒ 换机器 / 换目录都不用改。
const PROJ = import.meta.dirname
const INDEX_MD = join(PROJ, 'knowledge', 'INDEX.md')
const SITES_DIR = join(PROJ, 'knowledge', 'sites')

// 手册必须有的小节（改这里就要同步改 README 与 prompts 里的说明）
const REQUIRED_SECTIONS = ['## 入口', '## 检索要点', '## 坑与对策', '## 实测记录']

/** 从 SITES.md 里抽出「表格第一格是反引号域名」的那些域名 */
function domainsFromIndex(text, problems) {
  const domains = []
  const lines = text.split('\n')
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const first = line.slice(1).split('|')[0].trim()
    const m = /^`([^`]+)`$/.exec(first)
    if (!m) {
      // 第一格有反引号但不是「整格就是一个域名」⇒ 极可能是格式被改坏了
      if (first.includes('`')) problems.push(`SITES.md:${i + 1} 第一格的格式不对（应是整格一个反引号域名）: ${first}`)
      continue
    }
    domains.push(m[1])
  }
  return domains
}

function runCheck({ sitesMdPath, sitesDir }) {
  const problems = []

  if (!existsSync(sitesMdPath)) {
    return { problems: [`读不到索引文件: ${sitesMdPath}`], indexed: [], files: [] }
  }
  if (!existsSync(sitesDir)) {
    return { problems: [`读不到手册目录: ${sitesDir}`], indexed: [], files: [] }
  }

  const indexed = domainsFromIndex(readFileSync(sitesMdPath, 'utf8'), problems)
  const files = readdirSync(sitesDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))

  const dupIdx = indexed.filter((d, i) => indexed.indexOf(d) !== i)
  if (dupIdx.length > 0) problems.push(`索引里重复的域名: ${[...new Set(dupIdx)].join(', ')}`)
  const dupFile = files.filter((f, i) => files.indexOf(f) !== i)
  if (dupFile.length > 0) problems.push(`目录里重复的文件名: ${[...new Set(dupFile)].join(', ')}`)

  // ① 双向一一对应
  for (const d of indexed) if (!files.includes(d)) problems.push(`索引里有「${d}」，但 ${d}.md 不存在`)
  for (const f of files) if (!indexed.includes(f)) problems.push(`存在 ${f}.md，但索引 SITES.md 里没有它`)

  // ② 必需小节
  for (const f of files) {
    const p = join(sitesDir, `${f}.md`)
    const body = readFileSync(p, 'utf8')
    const missing = REQUIRED_SECTIONS.filter((s) => !body.includes(s))
    if (missing.length > 0) problems.push(`${f}.md 缺少必需小节: ${missing.join(' / ')}`)
    if (body.trim().length < 400) problems.push(`${f}.md 太短（${body.trim().length} 字符），像是空壳`)
  }

  return { problems, indexed, files }
}

function report({ problems, indexed, files }, title) {
  console.log(`--- ${title} ---`)
  console.log(`  索引里 ${indexed.length} 个域名: ${indexed.join(', ') || '(无)'}`)
  console.log(`  目录里 ${files.length} 个手册: ${files.join(', ') || '(无)'}`)
  if (problems.length === 0) {
    console.log('  RESULT: OK')
  } else {
    console.log(`  RESULT: FAIL (${problems.length})`)
    for (const p of problems) console.log(`    - ${p}`)
  }
  return problems.length === 0
}

// ─────────────────────────── 主流程 ───────────────────────────
if (process.argv.includes('--self-test')) {
  const root = mkdtempSync(join(tmpdir(), 'check-sites-'))
  let allGood = true
  try {
    const md = join(root, 'SITES.md')
    const dir = join(root, 'sites')
    mkdirSync(dir, { recursive: true })

    const goodBody = REQUIRED_SECTIONS.map((s) => `${s}\n`).join('\n') + '\n' + 'x'.repeat(500) + '\n'
    writeFileSync(join(dir, 'a.com.md'), goodBody, 'utf8')
    writeFileSync(join(dir, 'b.com.md'), goodBody, 'utf8')
    writeFileSync(md, [
      '# t',
      '| 域名 | 平台 |',
      '|---|---|',
      '| `a.com` | A |',
      '| `b.com` | B |',
    ].join('\n'), 'utf8')

    const clean = runCheck({ sitesMdPath: md, sitesDir: dir })
    if (!report(clean, '自测 1：完好的库应当通过')) allGood = false

    // 漂移 A：索引多一条，实体没有
    writeFileSync(md, [
      '# t',
      '| 域名 | 平台 |',
      '|---|---|',
      '| `a.com` | A |',
      '| `b.com` | B |',
      '| `ghost.com` | 幽灵 |',
    ].join('\n'), 'utf8')
    if (report(runCheck({ sitesMdPath: md, sitesDir: dir }), '自测 2：索引多一条 → 必须红')) allGood = false

    // 漂移 B：有条目但缺小节
    writeFileSync(md, ['# t', '| 域名 | 平台 |', '|---|---|', '| `a.com` | A |', '| `b.com` | B |'].join('\n'), 'utf8')
    writeFileSync(join(dir, 'b.com.md'), '## 入口\n' + 'x'.repeat(500), 'utf8')
    if (report(runCheck({ sitesMdPath: md, sitesDir: dir }), '自测 3：缺小节 → 必须红')) allGood = false

    // 漂移 C：目录多一个文件，索引没有
    writeFileSync(md, ['# t', '| 域名 | 平台 |', '|---|---|', '| `a.com` | A |'].join('\n'), 'utf8')
    writeFileSync(join(dir, 'b.com.md'), goodBody, 'utf8')
    if (report(runCheck({ sitesMdPath: md, sitesDir: dir }), '自测 4：目录多一条 → 必须红')) allGood = false
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  console.log(allGood ? '\nSELF-TEST: OK（好的过、三类漂移都红）' : '\nSELF-TEST: FAIL（自测本身有问题）')
  process.exitCode = allGood ? 0 : 1
} else {
  console.log(`--- 库位置（自我定位） ---\n  ${INDEX_MD}`)
  const ok = report(runCheck({ sitesMdPath: INDEX_MD, sitesDir: SITES_DIR }), '站点经验库门禁')
  if (!ok) {
    console.log('\n修法：索引与手册必须一一对应；手册缺小节就补，多了幽灵条目就删。')
    console.log('（改了 INDEX.md 的表格格式导致解析不到，也会落进这里。）')
  }
  process.exitCode = ok ? 0 : 1
}
