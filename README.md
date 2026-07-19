# Atlas · 具身智能 & 视觉模型图鉴

一个面向中文读者的纯静态多页 Web 应用。它把具身智能（VLA）、世界模型、目标检测、视觉表征、分割与机器人多模态模型放在同一套可检索坐标系中，并配有本地论文库与领域趋势解读。

- 无后端、无框架、无 CDN、无运行时构建
- 原生 HTML / CSS / JavaScript ES Module，暖白杂志风视觉（衬线标题 + 赤陶色点缀）
- **162 个模型条目**（VLA 39 / 世界模型 29 / 目标检测 38 / 表征 19 / 分割 18 / 多模态 19），每个都有中文分节详解，全站详解约 10.2 万字（102493 字符）
- **457 篇本地 arXiv 中文导读 + 多来源实时发现**：OpenAlex、Semantic Scholar、Hugging Face Papers 并行补充，支持来源 / 方向 / 时间 / 排序 / 关键词筛选
- **187 条可检索术语**，其中社区/黑话/歧义词 52 条、35 条带真实 Issue/Discussion/评论证据、36 条带至少两个来源
- **11 个正式页面**：模型、论文、站内全文阅读器、谱系、时间线、趋势、术语与学术发表脉络分工呈现；不包含学习页或答题页
- **学术追踪三视图**：8 个期刊入口、10 个会议入口、10 条已由正式出版页或官方论文集核验的发表事件，并使用 E1–E5 证据等级
- 收藏仅保存在浏览器 `localStorage`
- 不确定的年份、机构或链接统一写为字符串 `"unknown"`

## 启动

### 最简单：双击启动

双击项目根目录的 `启动图鉴.bat`，它会启动本地静态服务器并打开：

```text
http://127.0.0.1:8000/index.html
```

### 手动启动

```bash
python -m http.server 8000 --bind 0.0.0.0
```

本机仍打开 `http://127.0.0.1:8000/index.html`；绑定 `0.0.0.0` 同时允许同一局域网设备通过本机 IPv4 访问。浏览器会限制 `file://` 页面读取 JSON 和加载 ES Module，请务必通过静态服务器访问。

### 同一 Wi-Fi 的手机访问

把服务绑定到局域网网卡：

```bash
python -m http.server 8000 --bind 0.0.0.0
```

在 Windows PowerShell 运行 `ipconfig` 找到当前 Wi-Fi 的 IPv4 地址，然后在手机打开 `http://<IPv4>:8000/index.html`。例如 `ipconfig` 当次显示 `192.168.1.23`，才访问 `http://192.168.1.23:8000/index.html`；示例地址不能照抄，重新联网后也要重新确认。若本机可访问而手机打不开，应检查 Windows 防火墙的“专用/公用网络”入站规则；不能只用 `127.0.0.1` 的结果宣称手机已验证。

如果 Windows 把当前 Wi-Fi 标成“公用网络”并拦截手机访问，可先双击项目根目录的 `允许手机访问.bat`，接受一次 UAC 提示。它只新增/启用一条 `LocalSubnet → TCP 8000` 入站规则，不会开放其他端口；随后再双击 `启动图鉴.bat`。真实手机仍需在同一 Wi-Fi 下实际打开页面才算验收完成。

### 迁移到另一台电脑并启用每日循环

便携 ZIP 必须先完整解压，再双击 `启动图鉴.bat`。如果接收电脑已经安装、登录并至少启动过一次 Codex Desktop，可再双击 `安装每日优化循环.bat`；安装器会根据实际解压目录创建每天本地时间 09:00 的项目自动任务。完整步骤与能力边界见 `迁移到新电脑.md`。

ZIP 不包含原电脑的登录状态、API key、浏览器会话、模型权限或额度。电脑关机、Codex 未运行、断网或额度不足时，网页本身不能在后台修改项目；接收者仍需运行一次安装器、重启 Codex，并在“自动化”页确认任务启用。

## 页面

| 页面 | 内容 |
| --- | --- |
| `index.html` | 粒子网络 Hero、全局搜索、近期公开模型、六类入口、技术脉络、论文快照与术语速查 |
| `explore.html` | 模型卡片；类别 / 年份 / 国家地区 / A 级 / 开源 / 收藏 / 机构筛选；支持按引用数排序 |
| `model.html?id=...` | 模型详情：分节长文详解（带目录导航）、引用数快照、A 级架构动画与逐行注释代码、谱系与仓库热度 |
| `compare.html?ids=...` | 2–3 个模型并排对比 |
| `lineage.html` | 按“方法继承代际”分列的可拖拽缩放谱系图（源头在最左，子代在右） |
| `timeline.html` | 2012–2026 滚动时间线 |
| `trends.html` | 样本统计图 + 六篇领域主线深度解读文章 |
| `glossary.html` | 187 条可搜索、可分类并带公开来源的中文术语 |
| `radar.html` | 论文雷达：本地 arXiv 中文导读库 + OpenAlex / Semantic Scholar / Hugging Face Papers 实时发现、来源状态与去重 |
| `venues.html?view=...` | 学术追踪：`journals` 看 SCI 期刊入口，`conferences` 看会议入口，`compare` 做会议与期刊的六方向对比、手法观察和编辑总结 |

所有详情页都支持 URL 参数直达分享，例如：

```text
model.html?id=openvla
compare.html?ids=rt-2,openvla,pi0
lineage.html?category=vla&focus=openvla
explore.html?category=detection&country=CN&open=1&sort=cites
radar.html?category=world&range=90&sort=cites&source=openalex
venues.html?view=journals
venues.html?view=conferences
venues.html?view=compare
```

## 目录结构

```text
.
├─ assets/
│  ├─ css/main.css          # 全站视觉（暖白杂志风）、响应式与动效
│  └─ js/
│     ├─ app.js             # 页面入口与按需加载
│     ├─ core.js            # 导航、搜索、收藏、卡片、缓存等共享能力
│     └─ pages/             # 每页独立 ES Module
├─ data/
│  ├─ details/<id>.json     # ★ 每个模型一个文件，唯一权威数据源（含分节详解）
│  ├─ index.json            # 由 build_index.py 生成的轻量索引（列表/搜索/筛选用）
│  ├─ papers.json           # 本地 arXiv 稳定库（fetch_papers.py 抓取 + 手写中文导读）
│  ├─ glossary.json         # 术语表
│  ├─ academic_tracker.json # 期刊、会议、六方向对比、方法与来源证据（人工核验）
│  ├─ academic_candidates.json # 学术发表待审队列；前端不读取
│  ├─ archive/models-v1.json# 旧版单文件主数据的归档备份
│  └─ candidates.json       # update.py 生成的待审核候选（运行后出现）
├─ scripts/
│  ├─ build_index.py        # 从 details/ 重建 index.json（编辑数据后必跑）
│  ├─ merge_sections.py     # 把分节详解内容包合并进 details/
│  ├─ fetch_papers.py       # 抓取近期 arXiv 论文构建论文库（保留已写导读）
│  ├─ merge_paper_intros.py # 把中文导读内容包合并进 papers.json
│  ├─ update.py             # arXiv/OpenAlex/S2/HF Papers/GitHub/HF Models 多来源候选，绝不改主数据
│  ├─ update_academic.py    # 期刊/会议发表事件候选，只写 academic_candidates.json
│  ├─ merge_glossary_candidates.py # 合并已经逐条审核的术语候选
│  ├─ install_daily_automation.ps1 # 在接收设备写入可迁移的 Codex 日更任务
│  └─ validate_data.py      # 本地结构、产品约束与便携文件一致性检查
├─ .codex/
│  ├─ portable-automation-prompt.txt # 可迁移日更提示
│  └─ atlas-maintenance-state.json   # 跨轮续做状态
├─ requirements.txt         # 联网脚本仅依赖 requests
├─ 启动图鉴.bat
├─ 允许手机访问.bat
├─ 安装每日优化循环.bat
└─ 迁移到新电脑.md
```

## 数据架构

- **`data/details/<id>.json` 是唯一权威数据源**：每个模型一个文件，包含基础字段、`sections`（分节详解）、`citations`（引用数快照）、A 级条目的 `architecture` 与 `code`。
- **`data/index.json` 是派生索引**：仅含列表页需要的轻量字段（含 `citations` 数值用于排序）。**编辑或新增任何 details 文件后，必须运行**：

```bash
python scripts/build_index.py
```

- 详情页按需加载 `details/<id>.json`，索引一次性加载，全站因此可以扩展到成百上千条目而不拖慢列表页。

## 如何新增模型

1. 在 `data/details/` 新建 `<id>.json`，基础字段：

```json
{
  "id": "model-slug",
  "name": "模型名称",
  "org": "机构或 unknown",
  "country": "CN / US / EU / ... / unknown",
  "year": 2026,
  "paper_url": "https://... 或 unknown",
  "github_url": "https://github.com/... 或 unknown",
  "category": "vla",
  "sub_category": "子方向",
  "one_liner_zh": "一句话说明它解决什么问题。",
  "key_idea_zh": "用中文解释真正关键的机制。",
  "tags": ["tag-1", "tag-2"],
  "tier": "B",
  "lineage_parent": "上游模型 id 或 unknown",
  "sections": [
    {"title": "背景与动机", "body": "……"},
    {"title": "方法详解", "body": "……"}
  ]
}
```

2. `category` 只能是 `vla / world / detection / representation / segmentation / multimodal`。
3. 运行 `python scripts/build_index.py`，再运行 `python scripts/validate_data.py`。

### A 级条目

每类固定 4 个 A 级模型。除基础字段外，还要提供 `architecture`（真实公开架构的模块与连线）与 `code`（标明真实来源仓库与文件路径的 15–40 行教学化摘录，`simplified: true`）。无法核实就不要提升为 A 级。

## 论文库

`radar.html` 先读取本地 `data/papers.json`，因此断网或公开 API 限流时仍能正常搜索 457 篇带人工中文导读的 arXiv 论文；页面随后独立并行查询：

- **OpenAlex**：近期作品、作者、开放链接、引用快照与来源机构元数据。
- **Semantic Scholar（S2）**：论文标识、摘要、作者、发布日期和引用快照；未认证公共接口可能返回 `429`。
- **Hugging Face Papers**：每日公开论文条目、arXiv 标识、摘要及公开项目/仓库线索。

实时结果按 arXiv id、DOI、规范化标题合并。每张卡保留全部来源标签和来源记录；标题、日期、DOI 或 arXiv id 不一致时会显示“来源有差异”，不会自动选一个值覆盖其他来源。每个来源独立超时和报错，一个来源失败不会清空本地库或其他实时结果。浏览器缓存按“来源 + 类别 + 查询词 + 时间窗”保存 1 小时；请求失败时最多使用 24 小时内、且明确标为“旧缓存”的结果。

> 2026-07-16 实测：OpenAlex、Semantic Scholar 与 Hugging Face Papers 支持从本地静态站跨域读取；arXiv Atom 与 OpenReview API 响应未提供浏览器 CORS 许可。因此前端不绕过来源策略，也不依赖不稳定的公共代理：arXiv 由本地快照提供，OpenReview 暂不接入前端。公开 API 的 CORS 与限流策略可能变化，页面会把变化显示成单源状态。

### 论文雷达与学术追踪的分工

`radar.html` 以**具体论文**为中心：展示标题、作者、日期、摘要、来源、引用快照和原文入口。`venues.html` 以**发表环境与方法信号**为中心，不再复制论文卡片、摘要或中文导读：

- `venues.html?view=journals`：跟踪 SCI 期刊的稳定官方入口、覆盖方向、来源证据和 Atlas 观察；“SCI”只是检索视角，不等于本站已经替期刊完成当期索引认证。
- `venues.html?view=conferences`：跟踪会议官网、论文集入口、覆盖方向和常见研究手法；不缓存容易过期的截稿日期或录用率。
- `venues.html?view=compare`：按六类方向对比会议与期刊适合观察的信号，并把可核验事实和编辑理解分栏展示。

同一研究在 arXiv、会议论文集、期刊页或多个聚合平台出现时，论文雷达只保留一个规范身份。去重身份顺序为：**规范化 DOI → 去版本号的 arXiv ID → 官方 proceedings / PMLR / DBLP / OpenReview / Anthology 等同一来源的稳定 ID → 规范化标题 + 第一作者 + 首次公开年份**。预印本、会议版和期刊扩展版确属同一研究时共享一个 `paper_id`，各版本的 DOI、arXiv ID 与 venue 作为版本记录保留，不重复标题、摘要和导读；标识、作者或标题冲突时禁止自动合并，进入人工核验。若期刊扩展版有实质不同贡献，则保留关联关系并说明差异，不能为了减少数量强行合并。

学术追踪可以引用论文雷达中的规范论文或原始来源作为例子，但不得再造第二份论文正文库。每天的学术观察固定使用三段式：

1. **事实摘要**：只写可由论文、期刊/会议官网、官方论文集或可靠元数据源直接核验的变化，并附链接与日期；
2. **Atlas 理解**：明确标成编辑判断，解释该变化对六类方向、实验设计或常用手法可能意味着什么，不伪装成来源事实；
3. **待核验**：列出索引状态、版本关系、指标、机构或方法细节等尚缺一手证据的内容，并给出下一步应查的来源。

`journals / conferences / compare` 三个视图必须各自维护独立的 `editorial_summaries`：期刊视图只总结期刊事实与缺口，会议视图只总结会议事实与缺口，对比视图只总结可比样本和版本增量；不得把同一段模板复制到三个视图。每轮还要检查论文全文清单、正式版本关系、中文导读与 `paper_analysis_index.json`，优先为已取得全文但尚未解析的论文补充初学者说明、方法步骤、局限、五维证据判断和结构化动态流程图。合法公开全文可保存到本机研究库；付费墙内容不得绕过访问控制。

`data/academic_tracker.json` 只接受人工核验后的更新。当前其中有 10 条已核验发表事件：4 条来自 Springer 正式期刊页，6 条来自 CVPR 2026 官方论文集。不得猜测或从旧榜单抄写 JCR 分区、影响因子、录用率和当期 SCI/SCIE 索引状态；无法从当期可靠来源确认时保留“待核验”或 `unknown`。平台数量本身只扩大**发现覆盖**，绝不自动提高证据等级；期刊/会议官网、出版方或官方论文集优先于聚合页和社区讨论。

论文“水平”与来源证据分开判断：E1–E5 只回答“发表事实有多确定”，不回答“论文有多好”。Atlas 不拿 venue 名称、引用数或仓库 star 直接打分，而是逐项检查 **主张与证据、验证广度、真实场景、可复现性、版本增量**，每项只写“证据充分 / 证据部分 / 暂不可判”。未读到正文、补充材料或真实评测时不得汇总总分，也不得用宣传演示补齐证据。

### 学术证据等级与待审队列

| 等级 | 含义 | 能证明什么 |
| --- | --- | --- |
| E1 · 正式出版 | 出版社正式目录、官方论文集或论文正式页 | 可确认已经出版或进入 proceedings |
| E2 · 官方决定 | 会议官方 decision、accepted list 或 program | 可确认接收，但不等于论文集已经出版 |
| E3 · 双元数据一致 | Crossref 与 DBLP 等独立书目源一致 | 可补版本关系，仍需回到出版方页面 |
| E4 · 聚合线索 | OpenAlex、Semantic Scholar 等聚合数据 | 只用于发现和交叉检查，不能单独证明录用 |
| E5 · 预印本 / 自述 | arXiv、仓库、实验室、作者或社区页面 | 只作为候选线索，不能单独证明正式发表 |

E1–E5 由**来源类型和可核验事实**决定，不按平台数量投票；多抓一个平台只增加发现机会。正式数据只在人工打开原始来源核验后写入 `data/academic_tracker.json.publication_events`。

建议每天运行一次学术候选更新；默认回溯 30 天，适合与每日 09:00 维护循环同频，无需高频轮询：

```bash
python scripts/update_academic.py --days 30

# 只检查网络、解析、去重和统计，不写文件
python scripts/update_academic.py --days 30 --dry-run

# 离线回归与结构门禁
python scripts/test_update_academic.py
python scripts/validate_data.py
```

`scripts/update_academic.py` 只读 `data/papers.json` 与 `data/academic_tracker.json`，唯一业务写入是 `data/academic_candidates.json`。该文件不是页面运行时数据源，所有条目始终保持 `status: "needs_review"` 与 `manual_review_required: true`；脚本不会直接合并 `data/details/`、旧 `data/models.json`、`data/index.json` 或 `data/academic_tracker.json`。人工核验时应先排除已经存在的 10 条正式事件，再决定是否手动补入版本关系或发表事件。

更新带中文导读的本地 arXiv 稳定库：

```bash
python -m pip install -r requirements.txt
python scripts/fetch_papers.py --per-category 80
```

脚本按六大方向抓取近期 arXiv 论文并批量查询 Semantic Scholar 引用数；**重新抓取时会按 arXiv id 保留已写好的 `intro_zh` 中文导读**，并保留人工复核后显式标记 `pinned: true` 的历史主线论文，结束时报告缺导读的数量。新论文的导读写成 `{ "<arxiv-id>": "导读文本" }` 内容包后合并：

```bash
python scripts/merge_paper_intros.py my-intros.json
```

模型详情页仍保留两个按需的实时接口：Semantic Scholar 引用数（点击查询）与 GitHub 仓库热度（未认证限每小时 60 次），失败时静默隐藏，不影响静态内容。

半自动扫描近期模型/论文候选（arXiv、OpenAlex、Semantic Scholar、Hugging Face Papers、GitHub 与 Hugging Face Models）：

```bash
python scripts/update.py --days 30 --min-stars 50
```

常用选项：

```bash
# 只验证 VLA 的全部论文源，不覆盖 candidates.json
python scripts/update.py --categories vla --days 30 --no-github --no-huggingface --dry-run

# 某个来源暂时限流时可单独跳过
python scripts/update.py --no-semantic-scholar
```

- `GITHUB_TOKEN`：提高 GitHub API 限额，只发送到 GitHub。
- `HF_TOKEN`：用于 Hugging Face 模型卡，只发送到 Hugging Face Models API；HF Papers 使用公开未认证会话。
- `S2_API_KEY`：可选的 Semantic Scholar API key，只发送到 S2。
- `OPENALEX_MAILTO`：可选的 OpenAlex polite-pool 联系邮箱。
- `--arxiv-only`：跳过全部其他来源；也可分别使用 `--no-openalex`、`--no-semantic-scholar`、`--no-hf-papers`、`--no-github`、`--no-huggingface`。

HF 模型候选默认需带 arXiv 标签，或至少达到 10 likes / 1000 downloads 之一，可用 `--min-hf-likes`、`--min-hf-downloads` 调整。输出仍只写入 `data/candidates.json`；同一候选的原始来源放在 `source_records`，冲突放在 `metadata_conflicts`。脚本绝不直接修改 `data/models.json`、`data/index.json` 或 `data/details/`，所有候选都必须人工审核后手动新增。

## 数据与谱系原则

1. 优先使用论文、官方项目页和官方仓库；无法可靠确认的信息写 `"unknown"`，不靠推测补齐。
2. `lineage_parent` 表示**主要方法继承或概念延续**（例如 YOLOv7 继承自 YOLOv4 团队的 E-ELAN 路线而非 v6），不等同于代码仓库的分支关系；谱系图按代际分列展示。
3. 分节详解基于论文原文与官方公开资料撰写；资料不足的条目明确标注“资料状态与提醒”。
4. 趋势页图表只统计当前图鉴样本，展示年发布量、六类模型构成与近三年新增；六篇主线文章是编者对公开工作的理解与判断，供读者参考。
5. `scripts/update.py` 与 `scripts/update_academic.py` 生成的内容永远是候选，不是事实库；平台数量只扩大覆盖，不能自动提升 E1–E5 证据等级，也不能替代论文、官方项目页、出版方或官方论文集的人工确认。
6. 学术追踪的期刊、会议、发表事件、手法与编辑总结也必须人工核验；不把编辑采样优先级写成 venue 排名，不猜 JCR 分区、影响因子、录用率或当期 SCI/SCIE 状态。

## 校验

编辑数据后运行：

```bash
python scripts/validate_data.py
```

它会检查：details 字段与类别、每类 A 级数量、谱系引用、A 级架构与代码、分节详解完整性、index 与 details 的一致性、术语表引用、论文库结构与导读覆盖率、11 个页面（含站内公开全文阅读器）、学术追踪三个视图、E1–E5、10 条已核验发表事件，以及 `academic_candidates.json` 的计数、来源统计、`needs_review`/人工审核边界和唯一业务写入路径。

## 浏览器建议

推荐近期版本的 Chrome、Edge、Firefox 或 Safari。页面遵循 `prefers-reduced-motion`；手机端筛选折叠为抽屉，模型卡单列，谱系支持触控拖拽与缩放按钮。

## 每日完整优化契约

自动循环和人工日更遵守同一份契约。一次完整循环不是“抓取后给出候选数量”，而是“发现 → 打开原始来源复核 → 做一项或多项安全改进 → 重建派生数据 → 桌面与手机验收 → 如实留痕”。只要有门禁未做，就只能报告“本轮部分完成”，不能写“全部通过”。

### 永久约束

1. 保持现有**暖白杂志风**；不得改回深色科技风。保留用户已有改动，不做破坏性 Git 操作，不自动提交或推送。
2. `data/details/<id>.json` 是模型唯一权威源，`data/index.json` 只能由 `scripts/build_index.py` 生成。`scripts/update.py` 只能写 `data/candidates.json`；`scripts/update_academic.py` 只能写 `data/academic_candidates.json`。两类候选都不得直接写 details、index、`academic_tracker.json` 或旧的 `models.json`，也不得被前端读取；必须人工审核后手动合并。
3. 年份、机构、国家地区、论文/仓库链接和谱系关系必须回到论文、官方项目页、官方仓库或机构公告核验；无法确认就写字符串 `"unknown"`。搜索结果摘要、模型聚合页和编号相邻都不能单独作为事实依据。
4. 学习页及其进度、Quiz、题库、答题控件和 checkbox 闯关均已移除；每日维护不得恢复这些入口、数据文件或运行时代码。
5. 单一 API 失败、断网、超时或 `403/429` 不能解释成“今天没有新论文”。保留其他来源结果，并在当天报告中写明来源、HTTP 状态/异常、是否使用缓存和未覆盖范围。
6. 最初六类必收模型名单是硬门禁，不以“总数够了”代替逐项存在性检查。`validate_data.py` 必须同时守住每类最低数量、每类恰好 4 个 A 级、YOLO v1–v13/YOLO26、Qwen/GR00T/SAM/InternVL/Emu3.5/Xiaomi-Robotics-U0 等已核实版本线，以及 A 级 15–40 行代码、来源路径和逐行中文注释。
7. 不把局域网服务称作公网托管，也不把候选称作已收录模型。长期公网地址未配置时必须写明；模型更新只在原始来源复核后日更落库，论文雷达才是页面打开时的多来源实时层。
8. 主导航保持“图鉴 / 论文雷达 / 学术追踪 / 谱系 / 时间线 / 趋势 / 术语表”；学术追踪固定提供 `journals / conferences / compare` 三个 URL 视图；搜索必须有明确按钮、页面滚动后结果仍在视口内可用，不恢复 `/` 快捷键提示；收藏为零时只显示“收藏”，不得显示孤立数字 `0`。
9. 趋势页只用年份、六类构成、近年新增和技术主线等中性信息，不恢复国产占比、国产与开源可验证性、开源比例或同义指标。
10. 每轮都要分别观察多来源论文、SCI 期刊、学术会议和六类常用研究手法；论文雷达只保存规范论文身份，学术追踪只保存 venue、来源覆盖、方法信号、已核验发表事件与编辑总结。去重固定为 DOI → arXiv → 官方论文集/PMLR/DBLP/OpenReview 等稳定 ID → 标题/第一作者/年份。当天报告固定输出“事实摘要 + Atlas 理解 + 待核验”，不得猜 JCR 分区、影响因子、录用率或当期 SCI/SCIE 状态。
11. 评价论文水平时先声明 E1–E5 不是质量分，再按主张与证据、验证广度、真实场景、可复现性、版本增量逐项给出“证据充分 / 证据部分 / 暂不可判”；不得用 venue 名气、引用数或 star 替代阅读全文和实验核验。
12. 每轮最终门禁同时检查 `安装每日优化循环.bat`、`scripts/install_daily_automation.ps1`、`.codex/portable-automation-prompt.txt` 与 `迁移到新电脑.md`；发布 ZIP 前必须从解压副本启动站点，并用隔离的临时 CodexHome 复验安装器，不能把本机账号、密钥、会话或真实自动任务目录打进包。

### 每次循环的执行顺序

#### 1. 建立基线

先重新阅读最新用户要求、项目交接文档和本 README，再记录 `git status --short`，避免覆盖并行或用户改动。自动任务同时读取 `.codex/atlas-maintenance-state.json` 的小型 schema v2：若上一轮因额度、断网、应用退出、真机缺席或公网未配置留下 `pending`，必须先续做；只保留当前基线、最近学术队列摘要和仍真实存在的未完成项，不再把整份历史报告塞进状态文件。只有八阶段全部通过才能写 `complete`。运行：

```bash
python scripts/validate_data.py
python -m compileall -q scripts
python scripts/test_update_merge.py
python scripts/test_update_academic.py
```

基线失败时先定位原因；不能在旧错误上继续堆数据。当前正常基线应报告 162 个模型（VLA 39 / 世界模型 29 / 目标检测 38 / 表征 19 / 分割 18 / 多模态 19）、24 个 A 级、约 10.2 万字（102493 字符）分节详解、457 篇均有中文导读的论文、187 条术语、11 个正式页面。数字随正式审核后的数据增长时，以脚本实际输出为准，并同步更新 README，不把旧数字当硬编码目标。

#### 2. 多平台发现新论文和新模型

每天运行一次两类完整候选扫描：

```bash
python scripts/update.py --days 30 --min-stars 50
python scripts/update_academic.py --days 30
```

`update.py` 默认扫描六类，并尝试 arXiv、OpenAlex、Semantic Scholar、Hugging Face Papers、GitHub 与 Hugging Face Models；`update_academic.py` 从 Crossref、OpenAlex、DBLP、CVF Open Access、PMLR 与 Robotics Proceedings 发现期刊/会议发表线索。每天还要按“论文 / 期刊 / 会议 / 常用手法”四组做人工作抽查：优先打开期刊与会议官网、出版方页面、官方论文集和机构公告，再在有公开访问条件时补查 OpenReview、ACL Anthology、ModelScope、Papers with Code 等入口。聚合页与社区帖子只能提供线索，不能替代第一方证据；平台越多只扩大覆盖，不自动提高 E1–E5 等级。报告必须逐组列出查询词、时间窗、结果数、失败和来源链接；没有结果也如实写明，不能假装已经覆盖“所有互联网”。

每天都要检查六类方向近期反复出现的研究手法，例如数据配方、预训练/后训练、动作表示、长时序建模、仿真到真实、开放词汇、提示机制、蒸馏/量化和评测设计；具体手法以当天来源为准，不能为了填满列表而套用。每一组观察都以“事实摘要 / Atlas 理解 / 待核验”三段输出；没有可核验变化时写清检索范围和“本轮未发现”，不得编造趋势。

每次都检查 `data/candidates.json` 的 `sources_attempted`、`raw_source_counts`、`failures`、`metadata_conflict_count` 与 `count`；同时检查 `data/academic_candidates.json` 的 `source_status`、`raw_source_counts`、`raw_record_count`、`candidate_count` 和 `skipped_authoritative_event_count` 是否与实际数组一致。学术候选必须全部是 `needs_review` 且 `manual_review_required: true`，已存在于 10 条正式事件中的记录只能进入跳过清单，不能重新入队。两类候选都要保留来源和冲突；预印本、会议版和期刊版遵守“论文雷达与学术追踪的分工”中的版本规则，不重复生成论文正文。限流接口本轮不高频重试；有 API key 时只发送给对应服务。

#### 3. 逐条复核后再落库

候选文件只是线索。维护者必须实际打开原始论文/项目页/仓库，确认它是“模型或方法”而非普通应用论文，并核对名称、版本、年份、机构、类别、开源状态和直接方法上游。优先处理：

- 六大类低于最初范围要求的缺口，以及国产模型覆盖；
- 最近 30 天的新模型、新版本和高关注公开仓库；
- YOLO、SAM、Qwen-VL、InternVL、GR00T 等有编号或版本的系列缺号；
- 论文已公开但图鉴仍缺失、或现有资料已经过期的条目。

YOLO 的数字不能自动推导谱系：逐项核对 v1–v13、YOLO26 及其他命名分支是否真实公开、是否同一团队/路线；“编号更大”不等于“直接继承”。可用下面的只读命令快速列出当前收录，再打开来源逐项比对：

```bash
python -c "import json; d=json.load(open('data/index.json',encoding='utf-8')); print('\n'.join('{} | {} | {} | parent={}'.format(x['name'],x['year'],x['org'],x['lineage_parent']) for x in d if x['name'].casefold().startswith('yolo')))"
```

证据充分的候选由维护者手动新建或修改 `data/details/<id>.json`；证据不充分的继续留在 candidates 并写明缺什么证据。任何脚本都不得绕过这个复核步骤批量灌入权威库。

期刊、会议与论文版本关系同样只能人工更新 `data/academic_tracker.json`。JCR 分区、影响因子、会议录用率和 SCI/SCIE 当期索引状态属于易变化且常有访问限制的字段：只有能打开当期权威来源并记录查询日期时才可写入；否则保持“待核验”或 `unknown`，不得从搜索摘要、旧榜单、论坛转述或相邻年份推算。

#### 4. 从真实社区语境维护术语

术语发现不能只从现有模型名和论文摘要抽取。每天轮查公开可追溯的 GitHub Issues / Discussions、Hugging Face Discussions / 模型卡、官方论坛、公开技术帖子和评论区，收集初学者实际会遇到的英文缩写、别名、报错说法和圈内黑话。不得抓取私密群、登录后私密内容或无公开 URL 的二手转述。

每条术语必须区分 `formal / community / slang / ambiguous`，写清分类、别名、中文释义、实际使用语境，并至少保留一个能直接打开的 `source_url`；社区说法优先保留两个不同帖子/讨论作为语境证据。每轮要报告社区型/歧义/黑话条目总数、含真实 Issue/Discussion/评论证据的数量和双来源数量，并优先补最常见英文词、缩写与报错黑话；只有 README/文档/论文来源的条目不能被统计成“已覆盖社区评论”。来源失效时先找同源归档或新公开证据，不能仅因临时网络错误删除。候选包逐条审核后才运行：

```bash
python scripts/merge_glossary_candidates.py <已审核候选.json>
python scripts/validate_data.py
```

#### 5. 审查真实谱系和图形布局

六个类别都要切换检查，不只看默认页。数据层检查悬空父节点、自环、环、父子年份倒置、跨类别关系和孤立节点；视觉层检查：

- 所有已确认节点是否出现在谱系图，`unknown` 上游是否进入独立区域；
- 节点、代际标题、说明文字是否越界或互相遮挡；
- 连线是否穿过节点/文字、在端口处重叠、长距离回折或大量交叉；
- 拖拽、滚轮/按钮缩放、分类切换与 `focus` URL 直达是否工作；
- 24 个 A 级详情的架构图是否与各自公开架构相符，模块、端口、箭头、标签和循环流动点是否重叠。
- 时间线 2012–2026 与 unknown 区、趋势页年发布量/六类构成/近三年新增是否和当前权威数据一致；Hero 粒子、逐字标题、滚动 stagger、卡片流光/视差/涟漪、数字滚动、谱系生长、A 级流动点和页面进场是否仍工作，并确认 `prefers-reduced-motion` 降级。

只有布局算法、样式或可逆交互问题可以直接修复。新增父子关系或改架构语义必须先完成第 3 步的来源核验；不得用“通用框图”替代真实架构。

#### 6. 论文雷达、学术追踪与详情实时数据

在 `radar.html` 至少验证一个预置方向和一个自定义关键词：预置方向、标题、作者、日期、摘要折叠、arXiv/原始来源与 GitHub 搜索按钮都要存在；本地库先显示，OpenAlex / Semantic Scholar / Hugging Face Papers 独立更新，来源标签、冲突提示、1 小时新缓存与 24 小时旧缓存标识正确。某一来源失败时，本地库和其他来源仍可用，错误态与重试可操作。浏览器直连 arXiv Atom 因无 CORS 时必须明确使用本地库/其他实时源降级，不得伪装成直连成功。

分别打开 `venues.html?view=journals`、`venues.html?view=conferences` 和 `venues.html?view=compare`：核对三视图 URL 可直达、期刊/会议官方与论文集链接可用、六类方向对比和方法标签非空，并确认页面始终把“可核验事实”与“Atlas 观察”分开。抽查同一研究的 arXiv、会议和期刊版本，确认 Radar 只有一个规范论文身份，学术追踪没有复制摘要/导读。每天更新的编辑总结必须包含“事实摘要 + Atlas 理解 + 待核验”；缺一手证据的 venue 指标继续标为待核验，不得用 JCR、影响因子或录用率猜测质量。

在一个有论文标题和 GitHub 仓库的详情页验证“查看引用数”和“仓库热度”；请求失败或限流时不应造成控制台未处理异常，也不能把旧缓存伪装成实时值。GitHub 未认证限额按 60 次/小时对待，24 小时缓存不可被日更循环无意义击穿。

#### 7. 三档浏览器与真实手机验收

用静态服务器测试最终文件：

```bash
python -m http.server 8000 --bind 0.0.0.0
```

在 `1280px`、`390px`、`320px` 三档视口打开 11 个正式页面，至少覆盖面包屑、名称/机构/tag 模糊搜索（含 `YOLO13`→`YOLOv13`）、手机菜单、筛选抽屉全部筛选/排序、收藏、详情 URL 直达、2–3 模型对比、六类谱系节点跳转/拖拽/缩放、时间线、趋势图、术语分类/英文别名搜索、论文雷达、站内 PDF 阅读器和学术追踪三个 URL 视图。每档都要求：主文档无意外横向溢出、文字和按钮不重叠、可操作触控目标至少 44px、JSON/ES Module 请求成功、坏图和残留骨架屏为 0、控制台零未处理错误；架构图内部设计为可横向滚动，不算主页面溢出。

随后必须用同一 Wi-Fi 的真实手机访问 `http://<本机 IPv4>:8000/index.html`，至少打开首页、图鉴、详情、谱系、术语、雷达和学术追踪对比视图。先用本机通过局域网 IP 请求到 `200` 只能证明服务已监听，不能替代真机。若被 Windows 防火墙、公用网络、电脑关机或设备不在场阻塞，报告必须写“真机未验证”和具体原因，不得写“手机可用”。

#### 8. 最终重建与语法门禁

无论当天是否新增模型，最终都运行：

```bash
python scripts/build_index.py
python scripts/validate_data.py
python -m compileall -q scripts
python scripts/test_update_merge.py
python scripts/test_update_academic.py
```

站点 JavaScript 共 12 个文件，另有 1 个架构几何检查脚本；使用可用的 Node.js 逐一运行语法检查，并执行几何门禁：

```powershell
Get-ChildItem assets/js -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
node --check scripts/check_architecture_geometry.mjs
node scripts/check_architecture_geometry.mjs
```

Windows 上如果 `node` 不在 `PATH`，可使用 Codex 自带运行时中实际存在的 `node.exe`；必须记录最终使用的路径。找不到运行时就把 JS 语法检查列为未通过，不能因为命令没运行而写“13/13 通过”。还要检查 HTML 本地引用与静态 URL 无 404、无 CDN/框架运行时依赖、运行时代码没有已移除的学习页、Quiz 或闯关残留，并逐页核对 A 级代码行号/复制反馈。任何数据、Python、JavaScript、架构几何、浏览器控制台或真机门禁失败，都要修复后重跑，或明确列入未完成项。

### 每日结果必须包含的证据

最终中文报告及 `.codex/atlas-maintenance-state.json` 的 `evidence` 至少列出：

1. 开始/结束时间、扫描时间窗，以及论文、期刊、会议、社区术语和模型平台各自实际尝试的来源；
2. 各来源原始结果数、规范论文数、模型候选数、学术候选数、跳过的已核验发表事件数、版本关联、元数据冲突数、失败/超时/限流和缓存使用情况；
3. 每个已接受、暂缓或拒绝候选的名称、理由和原始来源链接，并明确哪些只在 candidates 中、哪些经人工审核后落库；
4. 当天学术观察的**事实摘要**：六类方向分别发现了什么可核验论文、期刊/会议信号和常用手法，附来源与日期；没有变化的方向也写检索范围；
5. 当天的**Atlas 理解**：把编辑判断与来源事实分开，说明这些信号对方法、实验或发表形态的可能含义；
6. 当天的**待核验**：列出论文版本关系、venue 索引状态、方法细节、网络/访问限制和下一步应查的一手来源；不得用猜测补 JCR、影响因子或录用率；
7. 新增/修正的模型、论文、术语、谱系、学术追踪与页面布局，以及哪些内容因证据不足没有修改；
8. 六类模型数量、YOLO 等编号系列检查结果、24 张 A 级架构图检查结果；
9. 11 个正式页面在 1280 / 390 / 320 的溢出和控制台结果、学术追踪三视图结果，以及真实手机访问结果；
10. `build_index.py`、`validate_data.py`、Python 编译、模型候选桥接回归、学术候选回归、12 个站点 JavaScript 与几何脚本的原始摘要；
11. 六类谱系逐类节点/边/重叠/穿线/交叉数字、11 页逐页三档结果、术语社区证据覆盖数字，以及当天未解决的阻塞和下一轮第一优先级。

不允许只写“已优化”“全部正常”而不附上述数字和可复核证据。

每轮在最终发布前还必须做一次“网站增量机会审查”，分别列出可立即安全完善、需要更多一手证据、以及新颖但应小范围验证的想法；逐项说明初学者价值、证据、风格与十页边界兼容性、维护成本、风险和优先级。低风险且可逆的改进可以当轮实现并复测，其余进入 pending，不得为了新颖恢复学习页、Quiz 或堆砌功能。若配置了授权邮件通道，最终中文报告发送到指定收件人；邮件失败只记录错误并保留本地报告，不影响事实状态。
