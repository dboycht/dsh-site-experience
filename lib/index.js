// dsh-site-experience —— 站点经验库插件（Host 半）
//
// 把「检索前先看站点列表 → 再读对应平台经验 → 收工写回」从"往工作区根塞一个注入文件"
// 改成插件自己的能力：
//
//   ① 库在插件自己的配置目录里：knowledge/INDEX.md（索引）+ knowledge/sites/<域名>.md（手册）
//   ② systemPrompt 段：把三条硬要求注入每个挂了本插件的模式（不再依赖工作区根的文件注入）
//   ③ webServer 路由：把库暴露给设置页（Client 半），供浏览与查看
//
// 设计取舍：
//   • 服务全部用 ctx.get() 取（缺了不抛异常），但**失败要响** —— 路由返回 500 并带上原因，
//     提示词段里也会写明库路径，避免"看起来挂了其实什么都没发生"。
//   • 索引的解析规则与 check-sites.mjs 完全一致：**表格第一格是反引号包住的整个域名**。
const name = 'dsh-site-experience'

// 插件自身目录（ESM）。
// ⚠️ 坑（第一次装就踩到）：本文件在 `<包>/lib/index.js`，所以 `import.meta.dirname`
//    是 **`<包>/lib`** 而不是包根 —— 库在**上一级**的 knowledge/ 里。
//    （当时路由返回 500 并打出了算错的真实路径，所以一眼能定位；这就是"失败要响"的价值。）
const PKG_ROOT = (import.meta.dirname ?? process.cwd()).replace(/[\\/]lib$/u, '')
const LIB_DIR = `${PKG_ROOT}/knowledge`
const INDEX_PATH = `${LIB_DIR}/INDEX.md`
const SITES_DIR = `${LIB_DIR}/sites`

function json(res, code, value) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

/** 抽出索引里「表格第一格是反引号域名」的行 —— 与 check-sites.mjs 同一套机器约定。 */
function parseIndex(text) {
  const rows = []
  for (const raw of String(text).split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = line.slice(1).split('|').map((c) => c.trim())
    const m = /^`([^`]+)`$/.exec(cells[0] ?? '')
    if (m === null) continue
    rows.push({ domain: m[1], name: cells[1] ?? '', updated: cells[2] ?? '' })
  }
  return rows
}

function apply(ctx) {
  const fs = ctx.get('fs')
  const webServer = ctx.get('webServer')
  const systemPrompt = ctx.get('systemPrompt')

  const readLib = async (path) => {
    const target = await fs.resolve(path)
    return await fs.readText(target)
  }

  // ─────────── ① 提示词段：把纪律做成机制，而不是靠工作区根的文件注入 ───────────
  if (systemPrompt !== undefined) {
    ctx.effect(() => systemPrompt.section({
      name: 'site-experience',
      order: 60,
      text: () => {
        if (fs === undefined) return '## 站点经验库\n\n（库不可用：本进程没有 fs 服务。）'
        return [
          '## 站点经验库（由 dsh-site-experience 插件提供）',
          '',
          '这是本部署积累的**平台检索经验**。同一个平台第二次遇到时不要再从零试错。',
          '',
          `- 库根目录：\`${LIB_DIR}\``,
          `- **索引（开工前先读它）**：\`${INDEX_PATH}\``,
          `- **各平台手册**：\`${SITES_DIR}\\<域名>.md\`（按需读一个平台的，不要把整本读进来）`,
          '',
          '三条硬要求：',
          '',
          '1. **开工前第 0 步，不可跳过**：读索引 → 命中平台就打开对应手册，',
          '   按它写好的入口、字段名、检索式走。**不要从零试错。**',
          '2. **收工前最后一步，不可跳过**：把本轮**新验证到**的事实写回手册 ——',
          '   已有条目就补 / 更正；没有条目就新建 `sites\\<域名>.md`，',
          '   必须含 `## 入口`、`## 检索要点`、`## 坑与对策`、`## 实测记录` 四个小节，',
          '   并往索引里加一行。**只写亲眼在页面上验证过的**，推断要标「待确认」。',
          '3. **交付时必须点名**：这次用的是哪条既有经验（或新建了哪条）。',
          '   **说不出来，就等于前两步没做。**',
          '4. **写完跑一次门禁**（它检查索引 ↔ 手册双向一一对应、手册是否含四个小节），必须 exit 0：',
          `   \`node ${PKG_ROOT}/check-sites.mjs\``,
          '   报错就先修好再收工。',
        ].join('\n')
      },
    }))
  }

  // ─────────── ② 给设置页的数据路由 ───────────
  if (webServer !== undefined && fs !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/site-experience/list',
      handler: async (req, res) => {
        try {
          const rows = parseIndex(await readLib(INDEX_PATH))
          json(res, 200, { ok: true, libDir: LIB_DIR, count: rows.length, sites: rows })
        } catch (err) {
          json(res, 500, { ok: false, message: String(err && err.message ? err.message : err) })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/site-experience/read',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const domain = url.searchParams.get('domain') ?? ''
          // 只放行 [A-Za-z0-9._-]：域名当文件名用，必须杜绝路径穿越
          if (!/^[A-Za-z0-9._-]{1,128}$/u.test(domain)) {
            json(res, 400, { ok: false, message: '域名不合法' })
            return
          }
          const text = await readLib(`${SITES_DIR}/${domain}.md`)
          json(res, 200, { ok: true, domain, text })
        } catch (err) {
          json(res, 404, { ok: false, message: String(err && err.message ? err.message : err) })
        }
      },
    }))
  }
}

export { name, apply }
export default { name, apply }
