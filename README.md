# dsh-site-experience —— 站点经验库插件

> 把一个部署积累的**平台检索经验**做成 DeepSeek Harness 的插件能力：
> agent 在检索前先看站点列表 → 读对应平台的手册 → 收工把**新验证到**的事实写回。
> 同一台机器上的第二个会话、第二个模式，都能直接复用这些经验。

## 它解决什么

在大模型检索类任务里，真正的耗时不在"搜"，而在**同一个平台反复从零试错**：

- 这个平台的结果计数在哪儿看？
- 时间范围作用于「申请日」还是「公开日」？
- 「法律状态」是检索表单的字段，还是只能去结果页的分面加？
- 翻页会不会读到上一页的旧 DOM？

这些**一次搞清楚、写下来就永远不用再搞**。本插件就是那个"写下来"的地方，
而且**检索流程本身**（先看列表、再读手册、收工写回）由插件通过提示词段注入，
不依赖某个 preset 里写死的路径。

## 结构

```
dsh-site-experience/
├── package.json          插件清单：dsh.bundle.patch（Host 半）+ dsh.client（Client 半）
├── cordis.patch.yml      插入一行
├── lib/
│   ├── index.js          Host 半：库读取 + 提示词段 + 给设置页的数据路由
│   └── client.js         Client 半：设置页「站点经验」
├── check-sites.mjs       门禁：索引 ↔ 手册双向一一对应 + 手册四小节（自带漂移自测）
└── knowledge/            ★ 经验库本体（"配置文件夹里的站点文件夹与索引文件"）
    ├── INDEX.md          索引：一行一个平台（域名 / 平台名 / 最后更新 / 手册路径）
    └── sites/*.md        各平台手册：入口 / 检索要点 / 坑与对策 / 实测记录
```

## 四道机制

| 部件 | 做什么 |
|---|---|
| **提示词段**（`systemPrompt.section`） | 把库的**绝对路径**与四条硬要求注入每个挂了本插件的模式：开工前先读索引与手册、收工写回、交付时点名用了哪条、**跑门禁**。 |
| **数据路由**（`webServer.register`） | `GET /api/site-experience/list` 列出索引；`GET /api/site-experience/read?domain=<域名>` 返回手册全文。域名参数只放行 `[A-Za-z0-9._-]`，杜绝路径穿越。 |
| **设置页**（`settings.section`） | 在「设置」里新增一页 **站点经验**（order 130）：列出全部平台、点开看手册全文。数据来自上面那两条路由。 |
| **门禁**（`check-sites.mjs`） | 索引 ↔ 手册**双向一一对应** + 手册必须含四个小节；**自带漂移自测**（确认它真的会红）。 |

## 安装

```
plugin_manager  action: install_bundle  target: <本目录绝对路径>
```

装完在**设置 → 站点经验**里应能看到平台列表。页面只读（查看），编辑由 agent 在检索收工时写回文件。

## 与 preset（Chrome信息检索模式）的关系

`dsh-preset-research` 是**消费方**：它原先自带一份同样的库，并靠 `agent-instructions` 把指针注入
工作区根的一个 `SITES.md`。**2026-10-14 已全部交接给本插件**：

- preset 里的 `knowledge\`、`check-sites.mjs`、以及工作区根的 `SITES.md` **都已删除**；
- preset 的 `instructionFileCandidates` 回到 `AGENTS.md, CLAUDE.md`；
- preset 的 persona §零 压成一句指针，并带兜底：**插件不可用时要如实说"不可用"，不许假装用过经验**；
- 库与门禁的**唯一来源就是本插件**（不会再有两份互相漂移）。

⇒ 因此**本插件必须先于 preset 发布** —— preset 依赖它。
