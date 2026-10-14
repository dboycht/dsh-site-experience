// dsh-site-experience —— 站点经验库插件（Client 半）
//
// 在「设置」里注册一个页面（settings.section，id = site-experience），
// 列出插件配置目录里 knowledge/INDEX.md 的全部平台，并可点开查看对应手册全文。
// 数据来自 Host 半的 webServer 路由（/api/site-experience/*）。
//
// 约定（照 DSH 官方 skill）：
//   • 组件是纯渲染，副作用（注入样式）放在 apply 里并用 ctx.effect 归还清理函数；
//   • 只用宿主主题 token（--dsw-alias-*），不写字面色，深/浅色自动跟随；
//   • 不 require 任何 DSH 客户端包，只 require('react')。
window.__ModuleLoader__.load({
  id: 'dsh-site-experience',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const CSS = `
.sxp-root { display:flex; flex-direction:column; gap:12px; color:var(--dsw-alias-label-primary); font-size:13px; }
.sxp-head { display:flex; flex-direction:column; gap:4px; }
.sxp-title { font-size:15px; font-weight:600; }
.sxp-sub { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:1.5; }
.sxp-path { font-family:ui-monospace,Consolas,monospace; font-size:11px; color:var(--dsw-alias-label-secondary); word-break:break-all; }
.sxp-list { border:1px solid var(--dsw-alias-border-l1); border-radius:8px; overflow:hidden; background:var(--dsw-alias-bg-layer-1); }
.sxp-row { display:flex; align-items:center; gap:10px; padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--dsw-alias-border-l1); }
.sxp-row:last-child { border-bottom:none; }
.sxp-row:hover { background:var(--dsw-alias-bg-layer-2); }
.sxp-row-open { background:var(--dsw-alias-bg-layer-2); }
.sxp-domain { font-family:ui-monospace,Consolas,monospace; font-size:12px; min-width:190px; }
.sxp-name { color:var(--dsw-alias-label-secondary); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sxp-updated { color:var(--dsw-alias-label-secondary); font-size:11px; font-variant-numeric:tabular-nums; }
.sxp-view { border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-1); overflow:hidden; }
.sxp-view-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); }
.sxp-view-title { font-family:ui-monospace,Consolas,monospace; font-size:12px; }
.sxp-btn { border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-primary); border-radius:6px; padding:3px 10px; font-size:12px; cursor:pointer; }
.sxp-btn:hover { background:var(--dsw-alias-bg-overlay); }
.sxp-pre { margin:0; padding:12px; max-height:460px; overflow:auto; white-space:pre-wrap; word-break:break-word;
  font-family:ui-monospace,Consolas,monospace; font-size:11.5px; line-height:1.6; color:var(--dsw-alias-label-primary); }
.sxp-msg { padding:12px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); }
.sxp-err { color:var(--dsw-alias-state-error-primary); }
.sxp-warn { color:var(--dsw-alias-state-warn-primary); }
`

    async function getJson(url) {
      const r = await fetch(url, { headers: { accept: 'application/json' } })
      let body = null
      try { body = await r.json() } catch (err) { body = null }
      if (!r.ok || body === null || body.ok === false) {
        throw new Error((body && body.message) || ('HTTP ' + r.status))
      }
      return body
    }

    function Page() {
      const [list, setList] = React.useState({ loading: true, error: null, libDir: '', sites: [] })
      const [open, setOpen] = React.useState(null)
      const [doc, setDoc] = React.useState({ loading: false, error: null, text: '' })

      React.useEffect(() => {
        let alive = true
        getJson('/api/site-experience/list')
          .then((b) => { if (alive) setList({ loading: false, error: null, libDir: b.libDir, sites: b.sites ?? [] }) })
          .catch((e) => { if (alive) setList({ loading: false, error: String((e && e.message) || e), libDir: '', sites: [] }) })
        return () => { alive = false }
      }, [])

      const openDoc = (domain) => {
        setOpen(domain)
        setDoc({ loading: true, error: null, text: '' })
        getJson('/api/site-experience/read?domain=' + encodeURIComponent(domain))
          .then((b) => setDoc({ loading: false, error: null, text: b.text ?? '' }))
          .catch((e) => setDoc({ loading: false, error: String((e && e.message) || e), text: '' }))
      }

      const rows = list.sites.map((s) => h('div', {
        key: s.domain,
        className: 'sxp-row' + (open === s.domain ? ' sxp-row-open' : ''),
        onClick: () => openDoc(s.domain),
        role: 'button',
        tabIndex: 0,
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDoc(s.domain) } },
      },
        h('span', { className: 'sxp-domain' }, s.domain),
        h('span', { className: 'sxp-name' }, s.name),
        h('span', { className: 'sxp-updated' }, s.updated),
      ))

      const viewer = open === null ? null : h('div', { className: 'sxp-view' },
        h('div', { className: 'sxp-view-head' },
          h('span', { className: 'sxp-view-title' }, open + '.md'),
          h('button', { className: 'sxp-btn', onClick: () => { setOpen(null); setDoc({ loading: false, error: null, text: '' }) } }, '关闭'),
        ),
        doc.loading ? h('div', { className: 'sxp-msg' }, '读取中…')
          : doc.error !== null ? h('div', { className: 'sxp-msg sxp-err' }, '读取失败：' + doc.error)
            : h('pre', { className: 'sxp-pre' }, doc.text),
      )

      return h('div', { className: 'sxp-root' },
        h('div', { className: 'sxp-head' },
          h('div', { className: 'sxp-title' }, '站点经验库'),
          h('div', { className: 'sxp-sub' },
            'agent 在做信息检索前会先读这里的索引与对应平台手册，收工再把新验证到的事实写回。',
            '这就是「同一个平台第二次不用从零试错」的来源。',
          ),
          list.libDir ? h('div', { className: 'sxp-path' }, '库位置：' + list.libDir) : null,
        ),
        list.loading ? h('div', { className: 'sxp-msg' }, '读取中…')
          : list.error !== null ? h('div', { className: 'sxp-msg sxp-err' }, '读不到站点列表：' + list.error)
            : list.sites.length === 0 ? h('div', { className: 'sxp-msg' }, '库是空的：knowledge/INDEX.md 里还没有任何平台。')
              : h('div', null,
                h('div', { className: 'sxp-sub sxp-warn' }, '共 ' + list.sites.length + ' 个平台 —— 点一行看它的手册。'),
                h('div', { className: 'sxp-list' }, rows),
              ),
        viewer,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 样式随插件装载注入；卸载时归还清理函数（官方 skill 要求）
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.pluginCss = 'dsh-site-experience'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => { tag.remove() }
        })

        const slots = ctx.get('slots')
        if (slots === undefined) return
        slots.inject('settings.section', () => slots.register(
          // id 用自有的，不与随附条目冲突（order 130 = 排在 dsh-web-search 120 之后）
          { name: 'settings.section', id: 'site-experience', order: 130, label: () => '站点经验' },
          () => h(Page, {}),
        ))
      },
    }
  },
})
