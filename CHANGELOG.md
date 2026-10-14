# 更新日志

## 0.1.0 — 2026-10-14

首个版本。把一个部署积累的**平台检索经验**做成 DeepSeek Harness 插件：
agent 在检索前先看站点列表 → 读对应平台的手册 → 收工把**新验证到**的事实写回。

### 四道机制

- **提示词段**（`systemPrompt.section`）：把库的绝对路径与四条硬要求注入每个挂了本插件的模式 ——
  开工前先读索引与对应手册、收工写回、交付时点名用了哪条、跑门禁 exit 0。
  这替掉了原先"往工作区根塞一个注入文件"的做法（那时 18 个平台的表让每轮请求白付几千 token）。
- **数据路由**（`webServer.register`）：`GET /api/site-experience/list` 与
  `GET /api/site-experience/read?domain=<域名>`。域名参数只放行 `[A-Za-z0-9._-]`，杜绝路径穿越。
- **设置页**（`settings.section`，id `site-experience`，order 130）：设置里新增一页「站点经验」，
  列出全部平台、点开看手册全文。只用宿主主题 token（`--dsw-alias-*`），深/浅色自动跟随。
- **门禁**（`check-sites.mjs`）：索引 ↔ 手册**双向一一对应** + 手册必须含四个小节；**自带漂移自测**。

### 随附经验库

18 份平台手册（万方数据、中国专利公布公告、WIPO Patentscope、必应、百度系、知乎、贴吧、
B 站、抖音、萌娘百科、米游社、NGA 等），每份含 `## 入口` / `## 检索要点` / `## 坑与对策` / `## 实测记录`。

### 安装

```
plugin_manager  action: install_bundle  target: <本目录绝对路径>
```

装完在**设置 → 站点经验**里应能看到平台列表。

> ⚠️ **改宿主半（`lib/index.js`）之后必须重启 DSH**：宿主模块按路径缓存，
> `set_bundle` 开关与 `remove_bundle` + `install_bundle` 都**不会**重新加载它。
> Client 半（设置页）由 HTTP 供给，刷新页面即可。

### 已知限制

- 自注册的 `webServer` 路由**不在应用鉴权之后**（应用自己的 `/` 返回 401，这些路由不带凭证也能读）。
  仅绑 loopback，但本机任何能发 HTTP 的进程都可读 —— 返回敏感数据前请自行加校验。
- 设置页当前**只读**（浏览与查看）；写回由 agent 在检索收工时完成。
- 可见文案暂未接入 Client 本地化服务。
