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
//   • **依赖靠 inject 声明**（见下），绝不靠 `ctx.get()` 的"缺了就跳过" —— 那会把整件事变静默。
//   • 索引的解析规则与 check-sites.mjs 完全一致：**表格第一格是反引号包住的整个域名**。
const name = 'dsh-site-experience'

// ⚠️⚠️ 必须声明 inject —— 这是本插件踩过的最大的一个坑，别再删掉。
//
// 冷启动时 loader 会在这四个服务就绪【之前】就调用 apply，`ctx.get()` 全返回 undefined，
// 于是那些 `if (x !== undefined)` 的"防御性 guard"会**把整件事静默跳过**：
// 路由不注册（设置页拿到 404）、工具不注册（模型看不见）、提示词段也不注册 ——
// 而 **Client 半照常加载**，所以设置页看起来"能打开、但读不到数据"，极难定位。
//
// 实测证据（2026-10-14，DSH 0.2.0-rc.2）：
//   • 冷启动后：/api/site-experience/* 全部 401/404；Tool.listTools 里没有本插件的工具；
//   • 同一份缓存模块，仅把 bundle 关掉再打开（让 apply 重跑一次）⇒ /list 立刻 200、
//     /health 报 services 全 true、toolsRegistered=2、toolsError=null。
//   ⇒ 代码没问题，**问题就是 apply 来得太早**。声明 inject 后 cordis 会等到服务可用才调用。
//
// 取舍：声明成硬依赖 = "缺任一服务的 profile 里本插件整体不激活"。这是**故意**的 ——
// 宁可整体不激活（可见），也不要"加载了却什么也没注册"（不可见）。
const inject = ['fs', 'webServer', 'systemPrompt', 'tools']

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

// ─────────── agent 面向的工具定义 ───────────
// 目的：把"检索前先看站点列表、再读对应经验"从"提示词里的要求"变成**有名字的机制** ——
// agent 不需要知道库在哪、也不需要自己拼路径。
//
// ⚠️ 只在**只读**这条线上加工具：`save` 故意不做 —— 写回手册需要产出带四个小节的中文散文，
//    agent 用自己的编辑工具写质量更好；把"写"塞进一个工具只会限制它。
const makeTools = (readLib) => [
  {
    name: 'site_experience_list',
    description: 'List the platform experience library: domains, platform names, last-updated dates. Call this BEFORE researching a platform-provided question, so you start from prior experience instead of trial and error.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const text = await readLib(INDEX_PATH)
      const sites = parseIndex(text)
      return { libDir: LIB_DIR, count: sites.length, sites }
    },
  },
  {
    name: 'site_experience_read',
    description: "Read one platform's experience manual (entry URL, form fields, search syntax, pitfalls, verified log). Call it once you know which platform you will search.",
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain exactly as listed by site_experience_list, e.g. s.wanfangdata.com.cn' },
      },
      required: ['domain'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: String(value.text) }],
    },
    async execute(args) {
      const domain = String((args && args.domain) ?? '')
      if (!/^[A-Za-z0-9._-]{1,128}$/u.test(domain)) {
        return { domain, text: `域名不合法：${domain}（只接受 [A-Za-z0-9._-]）` }
      }
      // ⚠️ 找不到手册**不能抛异常**：模型传错一个域名就拿到原始 fs 报错，是最没用的一种失败。
      //    换成一句有指导性的话 —— 顺便把"这个平台还没记过"变成"该建手册了"。
      //    （这个 bug 是离线 harness 在重启之前抓到的。）
      try {
        const text = await readLib(`${SITES_DIR}/${domain}.md`)
        return { domain, text }
      } catch (err) {
        return {
          domain,
          text: [
            `这个平台还没有手册：${domain}`,
            '',
            `库里现有手册在：${SITES_DIR}`,
            '如果你本轮确实访问了它，收工时按格式新建 `<域名>.md`',
            '（必须含 `## 入口` / `## 检索要点` / `## 坑与对策` / `## 实测记录` 四个小节），',
            '并往 INDEX.md 的表里加一行 —— 先读一个已有手册照抄格式。',
            '',
            `原始错误：${String((err && err.message) || err)}`,
          ].join('\n'),
        }
      }
    },
  },
]

function apply(ctx) {
  const fs = ctx.get('fs')
  const webServer = ctx.get('webServer')
  const systemPrompt = ctx.get('systemPrompt')
  const tools = ctx.get('tools')

  // 声明了 inject 之后这四个必然在。万一不在，说明框架行为变了 —— 要响，不要静默。
  // （就是这个静默让本插件在冷启动时"加载了却什么都没注册"，排查了很久。）
  const missing = Object.entries({ fs, webServer, systemPrompt, tools })
    .filter(([, v]) => v === undefined).map(([k]) => k)
  if (missing.length > 0) {
    console.error(`[dsh-site-experience] 已声明 inject 但服务缺失: ${missing.join(', ')}`
      + ' —— 本插件将什么都注册不上；请检查 profile 是否装配了这些服务。')
  }

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
          '   省事做法：用工具 **`site_experience_list`** 拿平台列表、**`site_experience_read`** 读某个平台的手册',
          '   （它们已经知道库在哪，不用自己拼路径）；也可以直接读上面那两个路径。',
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

  // ─────────── ② 把"先看列表、再读经验"做成**工具**（只读） ───────────
  // ⚠️ 风险隔离：工具是新东西，包在 try/catch 里 —— 注册失败【不许】拖垮
  //    提示词段、数据路由与设置页（那几件是已验证可用的）。失败原因进 toolsError，
  //    并由 /health 路由暴露出来，不静默。
  // ⚠️ 工具定义在模块级，但 execute 需要 apply 内的 readLib 闭包 ⇒ 用工厂把它注入进来。
  //    （直接在模块级写 const TOOLS = [...] 会在**调用工具时**才报 readLib is not defined，
  //      加载期一切正常、最难查的那种。）
  const TOOLS = makeTools(readLib)
  let toolsError = null
  let toolsRegistered = 0
  if (tools !== undefined && fs !== undefined) {
    try {
      for (const def of TOOLS) {
        ctx.effect(() => tools.register(def))
        toolsRegistered += 1
      }
    } catch (err) {
      toolsError = String((err && err.message) || err)
      console.error('[dsh-site-experience] 注册工具失败:', toolsError)
    }
  }

  // ─────────── ③ 健康检查 ───────────
  // 一眼看出各部件到底有没有装起来；**工具注册失败也在这里现形**（否则它只在 stderr 里）。
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/site-experience/health',
      handler: (req, res) => json(res, 200, {
        ok: true,
        libDir: LIB_DIR,
        services: {
          fs: fs !== undefined,
          webServer: webServer !== undefined,
          systemPrompt: systemPrompt !== undefined,
          tools: tools !== undefined,
        },
        toolsRegistered,
        toolsError,
      }),
    }))
  }

  // ─────────── ④ 给设置页的数据路由 ───────────
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

export { name, inject, apply }
export default { name, inject, apply }
