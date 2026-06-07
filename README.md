# 🚀 OU-UI Next

> Master-to-Any 分布式网关、流量编排网络与 Universal Agent 控制平面。

OU-UI Next 是一个面向生产落地的控制平面项目，用于管理分布式网关、转发网络、订阅编排以及 Universal Agent 生命周期。它把已有的 HTML/Tailwind 视觉蓝图工程化为 Vite + React + TypeScript 产品，并补上类型化前端、服务化 HTTP Control Plane、契约校验 API 与部署自动化。

默认文档使用简体中文，适配主要中文使用者。英文版本单独维护：

- 🇨🇳 简体中文：当前文件
- 🇺🇸 English: [README.en.md](README.en.md)

## 🎯 项目定位

OU-UI Next 面向需要集中管理以下工作的运维者和项目维护者：

- 管理 Master-to-Any 节点纳管与 Universal Agent 部署
- 编排 TCP/UDP 转发、配额、订阅生成与路由策略
- 通过执行记录、审计和回滚证据约束关键操作流程
- 在保留严肃运维结构的同时，让首次部署尽量简单

项目的核心目标很直接：

> ✨ 小白上手即用。

仓库提供交互式一键 Master 安装脚本。脚本会询问必要信息，然后自动完成常见部署路径，尽量减少手写 nginx 配置、手动复制证书、反复拼接多步骤面板启动流程等容易出错的工作。

## 🧭 架构蓝图

```text
 OOOOOOO  UU   UU        UU   UU IIIII  NN   NN EEEEEEE XX   XX TTTTTTT
OO     OO UU   UU        UU   UU  III   NNN  NN EE       XX XX    TTT
OO     OO UU   UU ------ UU   UU  III   NN N NN EEEEE     XXX     TTT
OO     OO UU   UU ------ UU   UU  III   NN  NNN EE       XX XX    TTT
 OOOOOOO   UUUUU          UUUUU  IIIII  NN   NN EEEEEEE XX   XX   TTT

[ Architecture: Master-to-Any Distributed Modular Matrix ]

+========================================================================+
|                     MASTER NODE (Control Plane)                        |
|                                                                        |
|  +----------------+  +-------------------+  +-----------------------+  |
|  | UI Dashboard   |  | Deployment Engine |  | Core Database         |  |
|  | (React/Vite)   |  | (SSH / Installer) |  | (Nodes/Rules/Stats)   |  |
|  +----------------+  +---------+---------+  +-----------------------+  |
|                                |                                       |
|                      +---------v---------+                             |
|                      |  Config Compiler  |                             |
|                      +-------------------+                             |
+================================|=======================================+
                                 |
   [ Secure Control Channel : SSH Deploy / WebSocket / gRPC API ]
   [ Master dynamically injects Agents, Configs & Protocol Binaries ]
                                 |
+------------------+-------------+-------------+------------------+------+
|                  |             |             |                  |      |
v                  v             v             v                  v      v
+----------+    +----------+  +----------+  +----------+       +----------+
| HOST 001 |    | HOST 002 |  | HOST 003 |  | HOST ... |  ...  | HOST N   |
+----------+    +----------+  +----------+  +----------+       +----------+
| AGENT    |    | AGENT    |  | AGENT    |  | AGENT    |       | AGENT    |
+==========+    +==========+  +==========+  +==========+       +==========+
| [x]Xray  |    | [x]Xray  |  | [ ]Xray  |  | runtime  |       | [x]Xray  |
| [x]转发  |    | [ ]转发  |  | [x]转发  |  | modules  |       | [x]转发  |
| [x]遥测  |    | [x]遥测  |  | [x]遥测  |  | telemetry|       | [x]遥测  |
+----------+    +----------+  +----------+  +----------+       +----------+
| quota    |    | quota    |  | quota    |  | policy   |       | quota    |
+----------+    +----------+  +----------+  +----------+       +----------+
```

## 🧩 当前工程范围

当前仓库已经包含：

- **Vite + React + TypeScript 前端**
  - 应用外壳、导航、仪表盘、客户管理、节点、转发、订阅、路由、安全、调优、执行记录与审计等界面
  - 主导航使用生产术语：客户管理、受控主机、客户节点、端口转发、订阅管理、分流策略、安全策略、系统调优、执行记录与审计日志；旧入口名“节点订阅”不再作为产品导航文案出现
  - 客户管理、客户节点与受控主机是三个独立顶级页面：客户管理读取客户目录聚合读模型，客户节点维护 Xray 协议入站与客户配置，受控主机只处理 Agent 接入、遥测和主机设置；Agent 安装命令只在受控主机页展示，不会混入客户节点名称或客户业务参数
  - 登录页标题固定为“OU-UI Next 控制面板”；浏览器文档标题和登录卡片标题会随语言切换保持一致，用户名/密码占位符与非生产兜底凭据不使用内置管理员默认值
  - 安全策略页的内置演示授权主体使用 `operator:bootstrap-owner`，不会把 `operator:admin` 渲染成默认账号提示
  - 配置类操作统一以页面内浮窗呈现，不再从右侧拉出长面板；客户节点协议配置浮窗的默认中文字段已本地化：流控模式、客户端指纹、Reality 公钥/私钥、回落目标等表单标签不再残留普通英文标签；切换英文时仍使用独立英文文案
  - Telegram 通知设置和管理员账户设置已经是实际系统页面：可编辑 Telegram Bot 设置、生成一次性绑定码、创建/撤销客户绑定、调整通知策略、发送测试通知、重试投递、查看当前登录身份、查看凭据轮换命令，并撤销操作员会话
  - 客户节点创建页保留协议模板、VLESS/VMess/Trojan/Shadowsocks 字段、Reality 客户端材料、订阅链接预览和二维码生成；新增的 `qrcode` 依赖只用于浏览器侧订阅二维码渲染
  - 端口转发页现在展示配额状态、计费方向、单向/双向限速方向和显式停用/恢复操作，前端控制面与 Agent runtime guardrail 保持同一语义
- **类型化 Control Plane 契约**
  - OpenAPI 规范：[docs/openapi/ou-ui-next-v1.yaml](docs/openapi/ou-ui-next-v1.yaml)
  - 生产验收矩阵：[docs/architecture/v1-production-acceptance.md](docs/architecture/v1-production-acceptance.md)，当前证据审计：[docs/qa/2026-06-06-v1-production-acceptance-audit.md](docs/qa/2026-06-06-v1-production-acceptance-audit.md)
  - OpenAPI V1 契约已覆盖 Telegram operator API、公开 webhook 入口、手动 long polling 触发、绑定/策略/投递 schema，以及系统总览 snapshot 中返回的 Telegram 字段
  - Zod 请求校验与统一 API 响应封装
- **服务化 HTTP Control Plane**
  - 本地后端入口：`src/server/control-plane/http-control-plane-main.ts`
  - 围绕执行记录、审计、幂等、outbox、运行时发布模型和权限持久化建立服务/仓储边界
  - Telegram Bot V1 已接入 service-backed API、HTTP client/server、mock API 以及 in-memory/file/sqlite 仓储：设置和仅后端可见的密钥、聊天/客户绑定、一次性绑定挑战与挑战码 hash、通知策略、投递历史、重试请求、webhook update 处理、long-polling offset 和审计证据都会持久化，重启后可恢复，同时 API 不返回 bot token、webhook secret、proxy 凭据或原始订阅链接
  - Telegram 公开更新通过 `POST /telegram/webhook/{secret}` 进入，不要求 operator CSRF，而是由配置的 secret path 鉴权；long polling 通过同一命令处理器调用 `getUpdates`、持久推进 offset，并可作为控制面后台作业运行
  - Telegram 主动通知现在会由生产入口后台扫描客户绑定的流量阈值、到期提醒、订阅输出更新、订阅源 provider sync warning/failed、管理员日/周运营报告和活动系统告警管理员 fan-out，按通知策略生成持久化 delivery 队列记录并用 dedupeKey 防止重复提醒；实际发送继续由后台 sweep 统一处理到期的 `pending` / `failed` 投递，遵守 Bot API `retry_after`、配置的最大尝试次数和每轮上限，成功/失败/dead-letter 状态会持久化并进入结构化日志
  - Telegram Bot API 出站现在会在生产默认路径拦截 localhost、私网/链路本地/组播目标、解析后落入这些地址的 custom API/proxy 主机，并支持按 `egressAllowlist` 限定允许的远端主机；配置 HTTP/HTTPS/SOCKS5 proxy 后，`sendMessage` 和 `getUpdates` 会通过后端代理 dispatch，错误持久化前会脱敏 bot token、proxy URL 和 custom API URL
  - 已实现 Telegram 客户命令 `/start <code>`、`/help`、`/menu`、`/status`、`/traffic`、`/subscription`、`/nodes`、`/expiry`、`/notify status|on|off`，以及管理员命令 `/admin`、`/admin status`、`/admin alerts`、`/admin quota`、`/admin expiring`、`/admin search`、`/admin test`、`/admin bindings`；订阅链接受私聊和策略约束，并在投递历史中脱敏
  - Telegram 架构、操作员规则和安全边界记录在 [docs/architecture/telegram-bot-notifications-v1.md](docs/architecture/telegram-bot-notifications-v1.md)
  - 提供受保护的 `/events/v1/tasks` SSE 任务事件流，连接时先发送支持 `cursor` / `Last-Event-ID` 续连的任务状态历史与审计快照；任务状态事件会从持久化审计链回放 `queued/running/succeeded/failed/...` 全链路历史，后续再轮询持久读模型追踪新增 task/audit 事件；默认 SQLite 生产部署下，多实例面板可跨进程继续收到后续任务事件
  - 提供受保护的 `/events/v1/system-alerts` SSE 系统告警快照流，连接时发送当前活动告警，并在告警指纹变化时推送新快照；活动告警会覆盖 Agent 离线、采样缺口、红色高延迟、必需 runtime service 异常、command outbox 超时/死信、runtime apply 健康失败自动回滚、runtime reload 失败、审计写失败、外部归档 sink 失败、告警通知投递逾期/死信、外部订阅源同步 warning/failed 以及 quota exceeded，command outbox dead-letter 告警会在 metadata 中汇总 ACK 超时、result 超时、未知和其它原因分布，订阅源同步告警只暴露源 ID、名称、状态、节点数和非敏感 warning 摘要，外部归档失败告警会记录失败批次数、失败记录数和最近失败类型，并在系统总览活动告警卡片直接展示；这些告警会与持久化 lifecycle 读模型对账，把 `active` / `resolved` 生命周期记录持久化到控制面仓储；默认 SQLite 生产部署下，多实例面板也会跨进程看到后续告警快照；配置 `OU_UI_SYSTEM_ALERT_WEBHOOK_URL` / `OU_UI_SYSTEM_ALERT_WEBHOOK_URLS` 后，告警激活、更新和恢复会按 webhook 通道发送脱敏 JSON 通知，每个通道都有独立的持久化 retry/dead-letter 投递记录，默认投递路径会拦截 localhost、私网/链路本地/组播目标和解析后落入这些地址的目标，并固定到已验证公网地址投递，投递结果会带通道 ID/名称和脱敏目标进入结构化日志
  - 服务化只读 API 会在读取前从持久化 task / Agent event / 订阅仓储重建当前读模型，因此受控主机、订阅、端口转发等快照在默认 SQLite 生产部署下可跨实例追平，不依赖单进程内存态或重启回放
  - 提供受保护的 `/api/v1/observability-metrics` 生产诊断指标快照，聚合任务状态、完成延迟、按操作拆分的完成延迟、按 runtime module 拆分的 apply 延迟、rollback 计数、command outbox backlog/租约/超时/dead-letter、ACK/result 延迟、Agent offline/degraded、系统告警严重级别与告警类型（含 Agent offline、采样缺口、高延迟、runtime service 异常、command outbox 超时/死信、runtime apply 健康失败自动回滚、runtime reload 失败、审计写失败、外部归档 sink 失败、告警通知投递逾期/死信、订阅源同步 warning/failed 和 quota exceeded）、告警 webhook retry/dead-letter 队列与按通道聚合的投递健康、Telegram 投递 pending/failed/delivered/dead-letter/suppressed/overdue 健康、quota policy 总量/超限/停用/按 scope 与 enforcement state 聚合/used 与 limit bytes、Agent 运行日志 retained chunk 总量/字节/时间范围、剪枝归档桶数/片段数/字节/时间范围、流量历史 retained 样本总量、按维度计数、最早/最新样本时间和累计 metered bytes、审计链校验状态、审计拒绝计数、quota exceeded 审计计数、HTTP 进程观测到的审计写失败计数，以及外部归档 sink 失败次数和失败记录数
  - 提供受保护的 `/metrics` Prometheus 文本指标端点，将当前生产诊断快照导出为外部监控可抓取的 gauge 指标，包含 quota policy scope/state/used/limit time series、外部归档 sink 失败次数/失败记录数、告警通知 `channel_id` / `channel_label` / `status` 通道维度、Telegram 投递 `status` 维度，并为任务完成、按操作完成、runtime apply、command ACK/result 延迟输出 `_bucket` / `_sum` / `_count` histogram
  - 生产入口输出 JSON 结构化日志，覆盖 HTTP 请求、错误、任务、Agent poll/events、审计写失败和命令下发，并带 `requestId`、`traceId`、`taskId`、`commandId`、`agentId` 等排障字段
  - Agent HTTP poll 租约会在 command outbox 读模型中记录安全的 `leaseOwnerId` 与 `leaseSessionId`；启用 Agent 认证时 owner 使用 credential ID，不暴露 runtime token
  - 受保护的 `/api/v1/agent-sessions` 会暴露脱敏 Agent session liveness/progress 读模型，包含 session 状态、事件 seq、poll 侧 `lastSeenCommandSeq`、最近心跳、版本与能力；权限页的 Agent 凭证表会把绑定 session 的这些诊断字段展示在凭证行内
  - Agent 一键注册成功后会立即以 `provisioning` 状态进入受控主机读模型，并保留注册版本、平台和能力信息；真实安装脚本会把安装 profile 作为注册 `capabilities` 提交，受控主机卡片会直接显示状态 badge 与这些注册元数据，只有真实 heartbeat/telemetry 才会把主机推进为在线状态
  - Agent install token 兑换 runtime credential 会写入 `agent.credential.issued` 审计链事件；缺失、无效、过期 install token 或 Agent 身份不匹配的注册失败会写入 `audit.denied`，审计内容只包含脱敏凭据摘要、注册元数据和是否提交 token，不记录 raw token 或 token hash
  - mock 控制面与 service-backed 注册边界保持一致：内部只用完整 install token 摘要匹配注册请求，同 `tokenPrefix` 但原文不同的伪 token 会被拒绝，对外凭据清单和审计仍只暴露脱敏摘要
  - 受控主机删除任务必须由 Agent result 成功收敛；删除命令成功后，服务内核会在同一事务撤销该主机所有活跃 runtime credential，并写入 `agent.credential.revoked` 审计，避免删除后的 Agent 继续用旧 token 认证
  - Agent runtime credential 临近过期时，真实 Agent 会用当前仍有效的 runtime token 调用 `/agent/v1/credentials/rotate` 主动换取新 token，原子写回本地 env 并在下一轮 runner 重新加载；显式撤销后的旧 token 仍会立即失效，不会复用一次性 install token 自动恢复
  - Agent install/runtime token、Agent ID 以及前端客户节点 UUID/password/Reality short ID 只使用 Web Crypto / Node CSPRNG 生成；缺少安全随机源时直接拒绝生成，不再回退到 `Math.random`
  - Agent poll/events 和自轮换请求的认证失败或身份不匹配会写入 `audit.denied`，审计只保留 endpoint、Agent/session 摘要和已认证 credential 摘要，不记录 bearer token
  - Operator 受保护 REST/SSE/Prometheus 接口的 bearer 认证失败会快速返回 `401 unauthorized` 并写入 `audit.denied`，只记录方法、后端路径和是否提交 token，不记录 bearer token；同一来源失败默认按 60 秒 / 20 次窗口限速，超过后返回 `429 operator_auth.rate_limited` 并只写入一条节流审计，避免审计链无界增长；SQLite-backed 生产仓储下拒绝审计使用同一事务读取审计链前序哈希，避免认证失败路径被仓储队列自阻塞；如果拒绝审计写入失败，HTTP 入口保留原始认证响应，记录脱敏结构化日志，累加进程内审计写失败指标，并派生 `audit.write_failed` 严重系统告警
  - 通过 HttpOnly operator session 认证的 `/api/v1` 变更类请求必须携带服务端签发的 `X-CSRF-Token`；不携带 session cookie 的 bearer token 自动化请求和 `/agent/v1/*` Agent 请求不要求 CSRF，CSRF 拒绝会写入脱敏 `audit.denied` 且不消耗登录失败节流窗口
  - Operator 会话会在服务端登记，可通过受保护的 `/api/v1/operator-sessions` 查看，并通过 `/api/v1/operator-sessions/{sessionId}/revoke` 精确撤销；成功登录签发会写入 `operator.session.issued`，精确撤销或浏览器退出会写入 `operator.session.revoked`，受保护接口发现过期会话时会写入 `operator.session.expired`，原 session cookie 的后续受保护请求会被拒绝并追加脱敏认证拒绝审计
  - 安全策略页会展示 Agent install/runtime 凭证的脱敏清单，只显示 `tokenPrefix`、用途、状态、会话和审计元数据，不显示原始 token 或 `tokenHash`；活跃 runtime 凭证可从面板触发撤销或轮换，操作会刷新凭证读模型并保留审计链证据
  - 审计仓储写入保持追加式护栏：重复 `auditLog.id` 会被拒绝，文件状态加载时也会拒绝重复审计 ID，避免重启后审计事件被覆盖或伪装追加
  - `/api/v1/audit-logs:verify` 支持校验当前持久化审计链，也支持提交导出的审计日志数组进行离线链完整性校验；配置 `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` 后，每条新写入的审计日志都会把 `hash` / `prevHash` / action / result 等脱敏锚点追加到该目录下的 `audit-anchors.jsonl`，便于在控制面状态之外核对审计链头
  - 外部归档 sink 支持本地文件、webhook 与 S3 兼容对象存储组合投递：`OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` 继续把审计锚点、Agent 日志归档摘要和流量压缩归档桶写入控制面状态之外的 JSONL 文件；配置 `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL` / `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URLS` 后，审计链锚点、retention 剪枝产生的 Agent 日志归档摘要与流量压缩归档桶会按通道投递为脱敏 JSON batch，可用 `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_TIMEOUT_MS`、`OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_BEARER_TOKEN` 和 `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_EGRESS_ALLOWLIST` 控制超时、认证与允许域名；配置 `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID` 和 `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY` 后，同一批归档会以 SigV4 `PUT` 写入对象存储，也可用 `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_PREFIX`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SESSION_TOKEN`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_TIMEOUT_MS`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_FORCE_PATH_STYLE`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_EGRESS_ALLOWLIST`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_MODE`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_RETENTION_DAYS` 和 `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_LEGAL_HOLD` 控制对象前缀、STS token、超时、path-style/virtual-hosted-style、允许域名和可选 S3 Object Lock 保留头；默认投递路径会拦截 localhost、私网/链路本地/组播目标和解析后落入这些地址的目标，并固定到已验证公网地址投递，同时只把通道 ID/名称、endpoint/bucket/key 和脱敏目标写入结构化日志；单个归档通道失败会继续计入现有 external archive sink 失败指标与系统告警
  - 安装脚本生成的 Nginx 面板代理会对 `/events/v1/*` 保持无缓冲并显式返回 `text/event-stream`，避免浏览器或反向代理把事件流当作普通 HTML 响应
  - Agent 运行日志 chunk 支持受保护检索和导出，并默认按 7 天、每台主机代理 5000 条执行保留清理；真实 Agent 会在 command ACK 之后、result 之前上报有上限的 `log_chunk` 事件，包含 runtime 命令行/退出码、stdout/stderr 片段和 result 摘要，默认每个 command 最多 20 片且单片小于后端 64 KiB 契约上限；Master 会按 Agent / task / command / `chunkSeq` 对日志片去重，API、导出和指标读模型不会重复展示同一逻辑分片；`GET /api/v1/agent-log-chunks:export` 可按主机、任务、命令和时间窗口导出 JSONL/JSON 诊断文件；被留存策略剪枝移除的日志会按 UTC 日、Agent、任务、命令和 stream 压缩成只含片段数、字节数、会话、时间范围和内容哈希的归档摘要，不保留完整正文；受保护的 `/api/v1/agent-log-archives` 与 `/api/v1/agent-log-archives:export` 可查询和导出这些摘要，“执行记录”页也会展示归档摘要并支持直接导出；配置 `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` 后，每次留存剪枝产生的新日志归档摘要还会追加写入该目录下的 `agent-log-archives.jsonl` 外部归档文件；`GET/PATCH /api/v1/agent-log-retention-policy`、快照与前端“执行记录”页会展示并编辑当前生效留存策略，策略会持久化到控制面仓储、写入 `agent.log_retention.updated` 审计链，并在后续 Agent `log_chunk` 上报时立即用于剪枝，便于核对 Agent 真实执行结果并避免状态文件无界增长
  - Agent 运行脚本每轮 poll 后上报 heartbeat，并默认每 30 秒采集 ping 延迟、CPU/内存/磁盘、系统负载、网络流量和受管 systemd 服务健康 telemetry；Xray 健康不只看 `ou-ui-xray.service` 是否 active，还会探测本地 Xray Stats API，服务 active 但 API 不可用会作为 runtime service `unknown` 上报并进入现有系统告警链路；主机级配额或到期 guardrail 会停用受管 Xray/端口转发 unit，策略恢复后只恢复此前由该 guardrail 停掉且当前仍属于受管清单的 unit，并通过 `hostGuardrailStoppedUnits` / `hostGuardrailRestoredUnits` 回传证据；Master 短暂不可达时自动进入本地 pending 队列重试，队列默认最多保留 1000 条事件并优先保留 command ACK/result 等部署证据，受控主机详情会展示负载、Agent/Xray/端口转发服务状态以及 guardrail 停用/恢复证据，离线、红色高延迟和必需服务异常会进入系统告警
  - Agent pending event 队列会继续重试网络/服务异常，但会丢弃 Master 明确返回的不可重试事件冲突（如 command deadline 已过、event seq 已回放，或事件的 command/task 绑定不匹配），避免旧事件永久阻塞后续 heartbeat、telemetry 和 result 上报；如果本地队列达到上限，会先修剪常规 heartbeat/telemetry，再保留 log、ACK 和 result；如果 ACK 被 Master 判定为过期命令，Agent 会跳过该命令而不是继续执行 stale runtime apply；批量 `/agent/v1/events` 上报中单条 stale event 或错绑事件会进入 `rejected` 计数，后续有效事件继续处理
  - Agent 本地 runner 日志 `agent.log` 默认按 5 MiB 轮转并保留 3 份备份，可通过 `OU_AGENT_LOG_MAX_BYTES` / `OU_AGENT_LOG_BACKUP_COUNT` 调整；pending 队列上限可通过 `OU_AGENT_MAX_PENDING_EVENTS` 调整，避免 Master 长期不可达时本机状态目录无界增长
  - Runtime apply 命令的 inline artifact checksum 由规范化 artifact JSON 生成；Agent 在创建本地 snapshot、执行 Xray/端口转发预检和写入运行时文件之前会校验 checksum 与 `sig-v1` 摘要，不匹配时回传失败结果
  - Runtime preflight read model 覆盖 artifact 完整性、配置 schema、端口冲突、运行时依赖可用性和回滚 snapshot；Agent 失败结果会按原因标记对应检查项，并保留失败 health summary
  - Agent result 即使声称成功，也必须回传与命令匹配的 `appliedConfigRevision`；Master 会把缺失或不匹配的结果改判为失败，并标记 result verification 检查项
  - runtime apply 的 post-apply health check 失败时，Master 会基于失败命令的 `snapshotBeforeId` 自动创建 system actor `agent.rollback` 任务并下发到同一 Agent，原失败任务会记录 `rollbackTaskId`；该失败会派生 `runtime.apply_health_failed` 系统告警并进入通知/指标/lifecycle 读模型，后续同 target 的成功 Agent-result proof apply 或 rollback 会恢复告警；checksum、schema 等预检类失败只标记失败，不触发健康回滚
  - command outbox 到达 `completed` / `failed` / `expired` / `dead_letter` 后进入终态；同一 command 后续乱序或重试上报的 ACK/result 会保留 Agent 事件留痕，但不能覆盖 outbox 终态、任务状态或已验证的 runtime deployment proof；ACK/result/log 事件的 `commandId`、`taskId` 和 `agentId` 必须同时匹配 command outbox 记录，否则 Master 返回 `agent_event.command_task_mismatch` 且不写入事件或更新 outbox；所有会生成 Agent command 的 runtime 任务都不能通过人工 task transition 置为成功，必须由 Agent result 收敛
  - Agent 重连 poll 携带 `lastSeenCommandSeq` 时，Master 会对同一 `sessionId`、仍未 ACK、且 `seq` 大于 Agent 已见序号的 dispatched command 立即补发，不必等待 lease 过期；已 ACK 或终态命令不会被该机制重新下发
  - 端口转发读模型只在所有目标 Agent result 成功且修订号校验通过后才把端口显示为“已分配”；Agent 回传端口绑定冲突时会把规则和绑定投影为“端口冲突”，Agent telemetry 只更新流量/配额读数，不再把部署中的端口提升为已分配
  - Agent 端口转发 apply/remove 会按服务名清理旧 TCP/UDP systemd unit 后再按最新协议重建，编辑规则从 `tcp+udp` 收窄到单协议或删除规则时不会残留旧转发服务
  - 端口转发规则的 `rateLimitMode` / `rateLimitDirection` 会进入 runtime artifact；Agent 使用 GOST `limiter.in` / `limiter.out` 区分单向入站、单向出站和双向限速，旧任务未设置新字段时保持双向限速默认
  - 端口转发规则支持显式停用/恢复：`forward.pause` 会把规则保留在控制面读模型中，但要求 Agent 下线对应运行时服务并把绑定状态投影为“已停用”；`forward.resume` 会复用同一规则配置重新下发
  - 受控主机与端口转发流量读模型按 `monthlyResetDay` 计算 UTC 月度计费窗口；Agent 回传 `trafficBillingPeriod`，Master 只接纳当前周期样本，快照读取进入新周期时会清零旧周期用量，并把主机、端口转发和 Xray 客户端计数写入追加式流量历史统计读模型；系统总览页会按受控主机、端口转发和客户节点三种维度聚合这些真实历史样本，支持直接导出当前维度的 JSONL 诊断文件，并在流量历史留存面板展示运行配置默认值、控制面覆盖值与当前生效值，支持直接保存 `maxAgeDays` / `maxRecordsPerScope` 覆盖；受保护的 `/api/v1/traffic-rollups` 支持按维度、Agent、主体和时间窗口筛选，`/api/v1/traffic-rollups:export` 可导出 JSONL/JSON 诊断文件；`GET/PATCH /api/v1/traffic-rollup-retention-policy` 会展示并持久化当前流量历史留存策略，默认按 62 天、每个维度/Agent/主体 scope 200000 条剪枝，并写入 `traffic.rollup_retention.updated` 审计链；被留存策略移除的原始 rollup 会压缩为按 UTC 日、维度、Agent、主体和计费周期聚合的归档桶，受保护的 `/api/v1/traffic-rollup-compactions` 与 `/api/v1/traffic-rollup-compactions:export` 可查询和导出这些压缩历史，系统总览页也会按当前维度展示归档桶数、原始样本数、累计计费、最新归档时间并支持直接导出归档 JSONL；配置 `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` 后，新生成的流量压缩归档桶也会追加写入该目录下的 `traffic-rollup-compactions.jsonl` 外部归档文件；retained rollup 的总量、按维度计数、最早/最新样本时间、累计 metered bytes，以及压缩归档的桶数、原始样本数、最早/最新归档时间和累计计费都会进入 `/api/v1/observability-metrics` 与 `/metrics`，用于观测流量历史存储压力；主机读模型会按心跳/telemetry 年龄派生离线状态、按采样间隔派生采样缺口状态，并把离线与超过红色阈值的延迟路由为系统告警，展示在受控主机卡片、仪表盘和 `/events/v1/system-alerts` 事件流
  - 受控主机手动校准用量会参与服务端月度总用量派生：当 Agent 兼容上报只包含入站/出站计数而缺少显式总用量时，Master 会按双向、单向、只入站或只出站模式把手动校准值加进当前月用量；配额策略不会低估到低于手动校准值，quota reset 回放也会写回派生后的月度总用量
  - Xray 客户节点 artifact 带有客户流量上限、手工校准用量和月度重置日；Agent 通过 Xray StatsService 采集客户上/下行并回传 `xrayClientCounters`，Master 将其投影到对应客户节点的当前用量；当 StatsService 暂不可用时，Agent 仍会回传 `source: xray-guardrail` 的策略样本，Master 只更新配额/到期策略状态，不覆盖最后一份有效流量计数
  - `/api/v1/quota-policies` 不再停留在静态种子数据：服务化与 mock 适配器都会把受控主机、客户节点、订阅客户、端口转发账号、转发链路和端口转发规则的真实配额状态聚合成统一读模型，安全策略页可按范围直接查看当前窗口用量、计费方向、重置日和停用原因
  - `/api/v1/customers` 会从客户节点、订阅身份和端口转发 owner 动态生成客户目录，不需要手工假客户种子；同名客户会跨来源去重，客户总用量按 `max(客户节点用量, 订阅用量) + 端口转发用量` 聚合，避免本地 Xray 与订阅重复计费，同时保留转发独立流量；前端“客户管理”页独立展示该目录、来源、资源计数、配额状态和最近活动
  - 受保护的 `POST /api/v1/quota-policies/{quotaPolicyId}/reset` 会创建真实 `quota.reset` 任务：写入 before/after 审计快照、立即清零对应读模型窗口用量，并为后续 Agent telemetry 与订阅客户公开输出建立新 baseline，避免把重置前的历史流量重新累计回来
  - 端口转发规则、转发账号与转发链路配额进入超额状态后，Master 会自动创建系统 actor `forward.pause` 任务并复用原有 Agent apply/outbox 链路；当对应配额恢复（例如 reset 后）时，会自动创建 `forward.resume` 任务，保证端口转发配额处置与恢复都有任务、审计和回放证据
  - Xray Reality 客户节点区分服务端 `privateKey/target/serverNames/shortIds` 与客户端订阅 `pbk/fp/sid` 参数；UI 预览、API metadata、runtime artifact 和分享链接保持同一字段语义
  - 本地 Xray VLESS 公开订阅 URI 会使用当前 client 的 `flow`，多 client inbound 不会被 inbound 顶层兜底值覆盖，保证分享链接和实际下发的客户参数一致
  - Sing-box 公开订阅会输出 VLESS `flow`、Reality `public_key/short_id`、uTLS fingerprint 以及 WS/gRPC/HTTPUpgrade transport 字段，客户端订阅不会携带服务端 Reality 私钥
  - 本地 Xray inbound 如果包含多个 client，公开订阅会按 client 展开节点并按订阅身份过滤，只输出当前客户自己的 UUID/password/auth、用量和链接，不再默认使用 inbound 的第一个 client
  - 删除最后一个 Xray 客户节点会停止并移除 `ou-ui-xray.service`，同时把被移除的 systemd unit 纳入本地 revision changed files，保证运行时收敛和回滚证据一致
  - 客户节点 Xray 运行时只投影当前已能编译和下发的 VLESS、VMess、Trojan、Shadowsocks；显式请求未支持协议的历史/异常任务不会生成假的客户节点读模型
  - 客户订阅读模型和公开订阅响应会从已选择的本地 Xray client 聚合当前用量与生成节点数；匹配到真实运行时客户节点时不再信任创建订阅任务中的静态 `usedTrafficGb` / `generatedNodeCount`；订阅客户 `user:*` 配额超限会让公开订阅下载返回 `subscription.quota_exceeded`，执行 reset 后 `subscription-userinfo` 流量头会从 reset baseline 重新计算并恢复输出
  - 订阅分组读模型会从当前外部订阅源、同步后的节点库存和导出配置动态生成全局分组与按导出配置划分的分组，健康度、源状态和生成节点数不再依赖静态种子分组
  - 外部订阅源同步只允许抓取 `http` / `https` 订阅地址，会在 fetch 前拦截 localhost、私网/本机 IP 字面量以及 DNS 解析到私网/本机 IP 的域名，默认生产读取会按已校验 DNS 公网地址建连并保留原始 Host / HTTPS SNI，可通过 `OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST` 限定允许访问的外部 host，并支持按订阅源配置远程请求超时和响应体大小上限；超时、超限、不支持协议、allowlist 未命中和被拦截地址会进入同步失败状态与审计链
  - 外部订阅源同步开始前会在持久订阅源读模型写入非敏感 sync lease；并发实例再次同步同一来源时会按 lease / refresh interval 返回 `subscription_source.rate_limited`，避免重复远程抓取
  - 外部订阅源同步会按 provider host 统计未过期的持久 sync lease，并默认限制同一上游 host 同时最多 2 个抓取任务；可通过 `OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST` 调整，防止多个来源同时打爆同一服务商
  - 外部订阅源可配置非敏感 `providerAccountId`、每日抓取次数预算和每日响应字节预算；同步租约事务会按 provider 账户（未配置时按 provider host）聚合同一 UTC 日窗口内的持久消耗，超出预算时返回 `subscription_source.rate_limited`，成功抓取后会把本次响应字节写回订阅源读模型并在订阅源表格展示
  - 外部订阅源同步会按当前去重策略识别跨源重复节点，将订阅源标记为 warning，并把非敏感同步告警展示在订阅源表格中；`warning` / `failed` 来源会派生系统告警，进入 SSE、webhook、指标和系统总览活动告警
  - 外部订阅源同步成功、告警和失败结果会写入审计哈希链，记录同步前后状态、节点数量和告警代码
  - 订阅规则支持按协议、地区、来源、受控主机、运行状态、客户名称和流量条件筛选节点；订阅身份浮窗提供独立“流量条件”控件并合成为 `traffic:*` 规则，本地 Xray 节点会携带客户、主机、状态、已用流量和总配额元数据参与筛选
  - 外部订阅同步会解析服务商返回的 `subscription-userinfo` 流量头，将上传、下载、总量和到期时间写入订阅源流量快照，随订阅源读模型持久化并展示在订阅源表格中
  - Xray 客户节点超出月度配额或到期后，Agent 会从运行时 inbound 中过滤对应 client、重建 Xray 配置并回传 `runtimeDisabledByPolicy` 与禁用原因；Master 会据此自动创建系统 actor `inbound.update` 任务，把对应客户节点真实下线并保留完整配置快照与审计链；当配额恢复或执行 `quota.reset` 后，会再自动创建 `inbound.update` 恢复任务，把 Agent runtime、读模型和审计证据重新收敛到启用状态
  - 高风险任务需要显式 `riskConfirmation`，其 `operation` 和 `targetId` 必须与任务本体一致；删除、回滚、运行时 reload、quota reset 和权限撤销等操作缺失或不匹配时会被拒绝并写入 `audit.denied`
  - 权限判定会过滤已撤销、已过期或时间格式异常的 grant；`permission.grant` / `permission.revoke` 会按 `permissionChange.resourceType` 与 `resourceId` 同时校验授权范围，避免跨类型复用授权提权
  - Control Plane 启动后默认运行 command timeout sweep 后台作业，自动处理 command deadline、ACK 超时、result 超时并写入任务失败审计
  - 生产服务默认使用真实系统时间生成任务、outbox deadline 与后台 sweep 观测时间；测试场景才显式注入固定 clock，避免新任务被后台 sweep 误判为过期
  - 权限撤销内置安全护栏：如果撤销会移除某资源最后一条具备 `grant` 权限的管理路径，服务端会拒绝并写入 `audit.denied`
- **Mock 与 HTTP Adapter 分离**
  - 前端可使用 Mock 数据进行界面迭代
  - 也可连接服务化 HTTP Control Plane
- **自动化验证**
  - Vitest
  - ESLint
  - TypeScript typecheck
  - 生产 Vite 构建

## ⚡ 一键 Master 部署

面向操作者的部署入口是：

```bash
sudo bash -c 'bash <(curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh)'
```

如果你已经是 `root` 用户，也可以直接执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh)
```

安装完成后可以随时使用快捷管理命令：

```bash
ou-ui menu
ou-ui credentials
ou-ui restart
ou-ui update
ou-ui fix
ou-ui repair-nginx
ou-ui reconfigure
ou-ui doctor
ou-ui smoke
ou-ui browser-smoke
ou-ui acceptance
ou-ui acceptance-verify /var/lib/ou-ui-next/acceptance/20260606T120000Z
ou-ui final-acceptance --telegram-admin-chat-id 123456
ou-ui production-release-acceptance --telegram-admin-chat-id 123456 --include-archive-smoke --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json --install-evidence /root/ou-ui-receipts/clean-install-summary.json --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z
ou-ui backup-state
ou-ui restore-state /path/to/control-plane-backup.sqlite
ou-ui reset-state
ou-ui uninstall
```

最短入口是 `ou`：安装完成后直接输入 `ou` 会打开交互式快捷菜单，不需要记完整命令。
如果你安装的是旧版本，服务器上还没有 `ou` / `ou-ui` 命令，可以先执行下面的救援命令刷新快捷入口，再运行 `ou f --force` 修复前端、Nginx 与旧状态：

```bash
sudo bash -c 'bash <(curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh) repair-cli'
```

状态检查分两层：`ou s` 只查看 systemd 服务状态，`ou d` 会执行完整安装诊断，包含 Nginx、Basic Auth、面板地址、服务状态、控制面存储路径、源码提交、前端构建提交和旧演示 seed 残留检查。
卸载前请先确认是否需要备份数据；`ou x` / `ou-ui uninstall` 会删除安装目录、配置目录、状态目录、Web 静态目录、Nginx 站点和 systemd 服务。
使用 `OU_UI_LOCAL_SOURCE_DIR` 的本地源码部署只建议开发调试；生产更新应使用 GitHub 安装路径，这样 `ou u` / `ou f` 才能直接从远端拉取最新版本。
主机代理安装完成后也会提供 `ou-agent` 快捷入口：`ou-agent` 打开菜单，`ou-agent status` 查看服务状态，`ou-agent doctor` / `ou-agent d` 运行本机诊断且不输出 runtime token，`ou-agent qa` 生成 Agent 本机验收证据包（doctor、服务状态、脱敏日志尾部、脱敏 `runtime-summary.json` 和 SHA-256 manifest），`ou-agent qv <证据包目录或 manifest.json>` 校验证据包完整性，`ou-agent qv --require-runtime-evidence <证据包目录或 manifest.json>` 会在归档后强制检查 manifest.createdAt 为有效 UTC ISO 时间、非空 manifest.bundleDirectory、主 manifest 证据文件路径，以及 `runtime-summary.json` 中的 Xray inbound、端口转发服务、pending queue 和 guardrail 健康证据，`ou-agent qv --require-final-summary <证据包目录或 manifest.json>` 会复核 `ou-agent qf` 生成的 `final-acceptance-summary.json` createdAt 有效、bundleDirectory 非空且与 manifest.bundleDirectory 一致、`final-acceptance-verify.txt` 路径/大小/SHA-256 及 strict gate 标记，`ou-agent qvf <证据包目录或 manifest.json>` 会一次性复核 Agent runtime 与 final summary strict gate，`ou-agent qf` 会生成 Agent 证据包并立即执行严格 runtime 校验，把 transcript 保存为 `final-acceptance-verify.txt`、机器摘要保存为 `final-acceptance-summary.json`，`ou-agent update` 从 GitHub 更新 Agent 运行时且不会重新注册、不消耗新的安装 Token，`ou-agent uninstall` 卸载该主机代理。`runtime-summary.json` 只记录 runtime 文件状态、模块运行状态、Xray inbound 数、端口转发服务数、guardrail 计数和 pending event 数，不归档原始 artifact、客户端 UUID/邮箱、转发目标地址或 Agent token。

更短的快捷入口也会自动安装：`ou p` 打印面板信息，`ou c` 打印登录信息，`ou rc` 轮换登录凭据，`ou rs` 重启服务，`ou u` 从 GitHub 更新，`ou b` 备份控制面状态，`ou f` 一键修复安装异常，`ou r` 重置控制面状态，`ou m` 修改端口/证书，`ou d` 运行安装诊断，`ou sm` 运行 HTTP 生产烟测，`ou bs` 运行真实浏览器烟测，`ou ns` 运行真实 Telegram 通知烟测，`ou ws` 运行真实 webhook 烟测，`ou as` 运行真实外部归档烟测，`ou ape` 生成归档 provider 证据，`ou te` 生成第三方时间戳证据，`ou cie` 生成干净安装证据，`ou qa` 生成验收证据包，`ou qv` 校验证据包完整性，`ou qf` 运行最终现场验收，`ou qvf` 一次性复核最终验收包，`ou qvr` 强制复核全部生产发布门槛，`ou qfa` 运行全量生产发布验收编排，`ou x` 卸载面板。

其中 `ou-ui credentials` / `ou c` 会打印完整面板地址、登录账号和登录密码；追加 `--help` / `-h` 只显示用法，不读取或输出登录凭据，带其它额外参数会拒绝执行以避免误泄露；安装、更新和修复自检创建面板会话时，会把登录 payload 先做 JSON 编码再经 stdin 传给 `curl`，不会把密码拼进命令行参数；`ou-ui rotate-credentials` / `ou rc` 会生成新的随机操作员账号密码，更新后端 `scrypt:v1` hash，清理后端明文密码，并让旧浏览器会话失效，适合旧安装检测到默认/弱凭据后立即轮换；`ou-ui doctor` / `ou d` 会检查 Nginx、Basic Auth、服务状态、当前控制面存储路径、SQLite schema 校验、外部归档目录/webhook/对象存储配置健康、operator 密码 hash/明文状态、root-only 凭据权限、浏览器烟测脚本/Playwright/Chromium 状态、登录凭据强度、源码提交、前端构建提交和旧演示 seed 残留；`ou-ui backup-state` / `ou b` 会为当前控制面存储创建备份，默认写入控制面备份目录，也可追加自定义输出路径，并同时写入 `.manifest.json` sidecar，记录备份 SHA-256、大小、存储类型、创建时间和源码提交；`ou-ui restore-state <备份路径>` 会先校验 manifest 中的 SHA-256 与文件大小、验证 SQLite 备份、创建恢复前快照，再停服务并切换到指定备份，追加 `yes` 可跳过交互确认；`ou-ui fix` / `ou f` 会从 GitHub 更新源码、重建前端、刷新快捷命令、重启服务、重写 OU-UI 面板 Nginx 站点，并校验登录页、Basic Auth 和前端构建指纹，旧版本升级时如果静态文件已由本次构建刷新但缺少 `build-info.json`，会在同一次更新内补写指纹；刚安装后如果看到旧假数据、三台默认节点或 `mutation denied`，可运行 `ou fix --force` 自动清理控制面旧状态；`ou-ui repair-nginx` 会在不重建前端的情况下重新写入面板 Nginx 配置；`ou-ui reconfigure` / `ou m` 会重新打开安装向导，用于修改端口、证书和 Nginx 配置；`ou-ui reset-state` / `ou r` 用于刚安装后清除旧状态/旧假数据。`ou-ui` 与 `ouui` 也会作为等价快捷命令安装。

`ou-ui repair-nginx` 的修复路径会重新写入面板 Nginx 配置，并重新应用服务用户运行时权限，不会重建前端。

✅ 默认部署方式是从 GitHub 拉取 `cshaizhihao/ou-ui-next` 的 `main` 分支源码并在服务器上构建，不要求用户提前克隆仓库。只有开发调试场景才建议显式设置 `OU_UI_LOCAL_SOURCE_DIR=/path/to/ou-ui-next` 使用本地源码。
默认生产安装会把控制面状态持久化到控制面 SQLite 数据库文件；如果更新前仍是旧的 JSON 状态文件，安装器会保留旧状态来源并在首次切到 SQLite 时自动导入。SQLite 仓储和维护工具都会校验 `schema_version`、`state_format` 和 `control_plane_migrations` 迁移账本，遇到未来版本、未知格式或被篡改的迁移记录会拒绝启动、备份或恢复，避免旧程序静默降级控制面数据库；旧 v1 SQLite 在后端打开或执行备份时会补写当前迁移账本，旧 v1 备份恢复到目标库时也会补齐迁移账本。生产登录的 operator 密码会以 `scrypt:v1` hash 形式交给后端服务进程，明文只保存在 root-only 凭据文件中供 `ou c`、自检登录和人工找回使用，不会写入前端构建产物。安装后的管理 CLI 也提供了带 SHA-256 manifest 的本地单机备份/恢复闭环；底层 SQLite 维护工具 `scripts/control-plane-sqlite-tool.cjs backup` 会直接写入 `.manifest.json`，`validate` / `restore` 在发现 manifest 时会校验 schema、文件大小和 SHA-256，manifest 也会记录 SQLite 迁移账本，便于在升级前、修复前或事故回滚前先固化并校验控制面快照。安装器还会默认配置 `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY`，把留存剪枝产生的日志归档摘要、流量压缩归档桶和审计链锚点追加写入控制面状态之外的 JSONL 归档文件；也可配置 `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL` / `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URLS` 把审计链锚点、日志归档摘要和流量压缩归档桶投递到外部归档 webhook，配合 `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_TIMEOUT_MS`、`OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_BEARER_TOKEN` 和 `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_EGRESS_ALLOWLIST` 控制超时、认证与可投递域名；也可配置 `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID` 和 `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY` 写入 S3 兼容对象存储，配合 `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_PREFIX`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SESSION_TOKEN`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_TIMEOUT_MS`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_FORCE_PATH_STYLE`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_EGRESS_ALLOWLIST`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_MODE`、`OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_RETENTION_DAYS` 和 `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_LEGAL_HOLD` 控制对象前缀、STS token、超时、path-style/virtual-hosted-style、允许域名和可选 S3 Object Lock 保留头。目录、webhook 和对象存储可同时启用；远端投递目标会阻断本机/私网/链路本地/组播与解析后落入这些地址的目标，并保留脱敏投递日志；剩余验收重点是使用真实 provider 跑通投递证据、取得 provider 侧不可变桶/保留策略证明和 SIEM/warehouse 专用管线。

### 🧪 生产烟测

真实部署完成后，可以直接用安装器生成的管理命令运行 HTTP 生产烟测，快速验证面板登录、HttpOnly session、CSRF 防护、受保护 API、SSE 和 Prometheus 代理是否从真实入口闭环：

```bash
sudo ou sm
```

需要保存现场验收证据时，可以输出脱敏 JSON 报告：

```bash
sudo ou sm --report /var/lib/ou-ui-next/acceptance/smoke-$(date -u +%Y%m%dT%H%M%SZ).json
```

HTTP 烟测报告会写入脱敏的 runtime acceptance summary，记录 Agent、Agent session、Xray inbound、端口转发规则/端口、配额、任务、告警、命令死信和审计状态的计数，不包含 Agent ID、session ID、端口转发 ID、token 或密码。最终现场验收真实 Agent/Xray/端口转发闭环时，可加硬门槛：

```bash
sudo ou sm --require-runtime-evidence --report /var/lib/ou-ui-next/acceptance/smoke-runtime-$(date -u +%Y%m%dT%H%M%SZ).json
```

该模式要求至少存在一个在线或降级可见的 Agent session、至少一个 Xray inbound、至少一个端口转发规则/端口，且没有 critical 系统告警或命令死信；不满足时 smoke 会失败并把失败原因写入报告。

需要验证真实浏览器业务流时，可以运行浏览器烟测。它会使用安装器生成的面板地址和 root-only 凭据文件，在 headless 浏览器里完成登录、关键页面导航、截图取证和退出登录；报告不会写入登录密码、cookie、CSRF token 或 bearer token：

```bash
sudo ou bs --report /var/lib/ou-ui-next/acceptance/browser-smoke-$(date -u +%Y%m%dT%H%M%SZ).json --screenshot-dir /var/lib/ou-ui-next/acceptance/browser-screenshots
```

如果部署机提示缺少 Playwright 浏览器二进制或系统依赖，可在安装目录执行 `sudo npx playwright install chromium` 后重试。也可以手动运行同一脚本：

```bash
cd /opt/ou-ui-next/current
sudo env OU_UI_BROWSER_SMOKE_BASE_URL="https://你的域名:8443/安全路径/" npm run smoke:browser
```

需要验证真实外部通知链路时，可以运行通知烟测。它会使用安装器生成的面板地址和 root-only 凭据文件登录面板，读取 Telegram 设置，并调用测试通知 API 真实发送一条 Telegram 消息；必须显式指定管理员 chat 或已绑定客户，报告不会写入登录密码、cookie、CSRF token、bot token、chat id 或 binding id：

```bash
sudo ou ns --telegram-admin-chat-id 123456 --report /var/lib/ou-ui-next/acceptance/notification-smoke-$(date -u +%Y%m%dT%H%M%SZ).json
sudo ou ns --telegram-binding-id telegram-binding-001 --language en
```

也可以手动运行同一脚本：

```bash
cd /opt/ou-ui-next/current
sudo env OU_UI_NOTIFICATION_SMOKE_BASE_URL="https://你的域名:8443/安全路径/" npm run smoke:notifications -- --telegram-admin-chat-id 123456
```

需要验证系统告警 webhook 或外部通知 webhook 端点时，可以运行 webhook 烟测。安装后的 `ou ws` 默认读取后端 env 中的 `OU_UI_SYSTEM_ALERT_WEBHOOK_URL` / `OU_UI_SYSTEM_ALERT_WEBHOOK_URLS` 和 bearer token，向每个目标发送一条脱敏测试 JSON；报告不会写入 bearer token、完整 URL path 或 query：

```bash
sudo ou ws --report /var/lib/ou-ui-next/acceptance/webhook-smoke-$(date -u +%Y%m%dT%H%M%SZ).json
sudo ou ws --url https://hooks.example.com/ou-ui-alerts --report /var/lib/ou-ui-next/acceptance/webhook-smoke.json
```

也可以手动运行同一脚本：

```bash
cd /opt/ou-ui-next/current
sudo env OU_UI_WEBHOOK_SMOKE_ENV_FILE=/etc/ou-ui-next/master.env npm run smoke:webhooks -- --report /var/lib/ou-ui-next/acceptance/webhook-smoke.json
```

需要验证真实外部归档 provider 时，可以运行归档 smoke。安装后的 `ou as` 默认读取后端 env 中的 `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY`、`OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL(S)` 和 S3 兼容对象存储配置，向已配置的 sink 写入一条脱敏审计锚点、一条 Agent 日志归档摘要和一条流量压缩归档桶；该命令会真实写本地归档目录、外部归档 webhook 和对象存储，报告不会写入 webhook token、对象存储密钥或完整 URL path/query。若对象存储启用了可选 Object Lock，报告只记录 mode、retentionDays 和 legalHoldEnabled 摘要：

```bash
sudo ou as --report /var/lib/ou-ui-next/acceptance/archive-smoke-$(date -u +%Y%m%dT%H%M%SZ).json
```

也可以手动运行同一脚本：

```bash
cd /opt/ou-ui-next/current
sudo env OU_UI_ARCHIVE_SMOKE_ENV_FILE=/etc/ou-ui-next/master.env npm run smoke:archive -- --report /var/lib/ou-ui-next/acceptance/archive-smoke.json
```

归档 smoke 默认不会随 `ou qa` / `ou qf` 运行，避免每次生成验收包都对外部归档 provider 产生真实写入；需要把外部归档现场投递纳入同一个证据包时，可显式传入 `--include-archive-smoke`，并保存 provider 侧接收记录。

也可以直接生成完整生产验收证据包，包含 `ou d` 诊断输出、HTTP 烟测终端输出、浏览器烟测终端输出、通知/webhook/归档烟测跳过或执行记录、可选外部 provider 回执附件、可选干净服务器安装证据附件、可选 Agent 主机证据附件、脱敏 JSON 报告、浏览器截图归档和带文件大小/SHA-256 的 manifest：

```bash
sudo ou qa
```

真实 Agent/Xray/端口转发现场验收建议使用：

```bash
sudo ou qa --require-runtime-evidence
```

默认 `ou qa` 不会发送 Telegram 消息，只会写入 `notification-smoke.txt` 和 `notification-smoke-report.json` 说明通知烟测已跳过。需要把真实 Telegram 通知纳入同一个证据包时，显式开启并提供目标：

```bash
sudo ou qa --include-notification-smoke --telegram-admin-chat-id 123456
sudo ou qa --include-notification-smoke --telegram-binding-id telegram-binding-001 --notification-language en
```

默认 `ou qa` 也不会投递 webhook，只会写入 `webhook-smoke.txt` 和 `webhook-smoke-report.json` 说明 webhook 烟测已跳过。需要把真实外部 webhook 投递纳入同一个证据包时，显式开启；未传 `--webhook-url`/`--webhook-urls` 时会读取安装后的后端 env，报告会为每个目标记录 UTC ISO `checkedAt` 且不写入 bearer token、完整 path 或 query：

```bash
sudo ou qa --include-webhook-smoke
sudo ou qa --include-webhook-smoke --webhook-url https://hooks.example.com/ou-ui-alerts --webhook-bearer-token-file /run/secrets/ou-ui-webhook-token
```

默认 `ou qa` 也不会写外部归档 provider，只会写入 `archive-smoke.txt` 和 `archive-smoke-report.json` 说明归档烟测已跳过。需要把真实外部归档投递纳入同一个证据包时，显式开启：

```bash
sudo ou qa --include-archive-smoke
```

外部平台的接收回执、对象存储上传回执、工单截图导出的 JSON/TXT 等材料应先由运维脱敏成文件，再显式纳入证据包；`ou qa` 只复制这些文件、写入 `external-receipts-manifest.json` 并记录 SHA-256，不会替 operator 自动清洗文件内容：

```bash
sudo ou qa --external-receipt /root/ou-ui-receipts/provider-receipt.json
```

如果要把对象存储 provider 侧不可变/保留策略证明也纳入机器门槛，回执文件可以使用脱敏 JSON schema `ou-ui-next.archive-provider-evidence.v1`：`status` 必须是 `passed`，`objectStorage.deliveryStatus` 必须是 `delivered`，并记录 `bucket`、`objectCount`、`objectLock.mode`、`retentionDays` 或 `retentionUntil`、`legalHoldEnabled`、`bucketObjectLockEnabled=true` 和 `retentionPolicyVerified=true`；不要写入 access key、secret、token、password、完整带 query 的 URL 或未脱敏截图正文。安装后的 root-only CLI 可用 `ou archive-provider-evidence` 把已通过的 `archive-smoke-report.json` 和 operator 确认整理成该 schema：命令要求显式传入 `--object-storage-delivery-confirmed --bucket-object-lock-confirmed --retention-policy-confirmed`，默认写入 `/var/lib/ou-ui-next/acceptance/archive-provider-evidence-<UTC>.json`，只保留 URL origin、bucket、对象数量和 Object Lock/retention 摘要；快捷菜单 `ou ape` 也会逐项要求输入 `yes`。该命令方便现场生成 strict gate 可读回执，但不替代 provider 控制台/API 导出的真实不可变策略证据。推荐用 `ou qa --archive-provider-evidence <文件>` 纳入验收包；它仍写入 `external-receipts-manifest.json`，但在 `ou qf` 最终验收中会自动启用 `--require-external-receipts` 和 `--require-archive-provider-evidence`。

```bash
sudo ou as --report /root/ou-ui-receipts/archive-smoke-report.json
sudo ou archive-provider-evidence --archive-smoke-report /root/ou-ui-receipts/archive-smoke-report.json --object-storage-delivery-confirmed --bucket-object-lock-confirmed --retention-policy-confirmed
sudo ou qa --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json
```

如果要把第三方时间戳锚定也纳入机器门槛，可先让外部 TSA / OpenTimestamps / 等价服务对已脱敏 artifact 出具 receipt，再用 `ou timestamp-evidence` 生成脱敏 JSON summary，schema 为 `ou-ui-next.timestamp-evidence.v1`：它只记录被锚定 artifact 的 basename、大小、SHA-256，第三方 receipt 的 basename、大小、SHA-256，`timestampedAt`、可选 `verifiedAt`、`verificationStatus=verified`，以及 `thirdPartyTimestampConfirmed` / `receiptSanitized` / `verificationConfirmed` 三项确认；不会复制 receipt 原文。该命令默认写入 `/var/lib/ou-ui-next/acceptance/timestamp-evidence-<UTC>.json`，快捷菜单 `ou te` 会逐项要求输入 `yes`。推荐对 `archive-provider-evidence.json` 或其它已脱敏发布证据做时间戳锚定，然后用 `ou qa --timestamp-evidence <文件>` 纳入验收包；`ou qf` 会自动启用 `--require-external-receipts` 和 `--require-timestamp-evidence`。

```bash
sudo ou timestamp-evidence --artifact /root/ou-ui-receipts/archive-provider-evidence.json --receipt /root/ou-ui-receipts/archive-provider-evidence.tsr.redacted --timestamped-at 2026-06-07T12:00:00Z --third-party-timestamp-confirmed --receipt-sanitized --verification-confirmed
sudo ou qa --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json
sudo ou qv --require-timestamp-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
```

干净服务器安装 transcript、安装摘要、工单导出的 TXT/JSON 等材料也应先由运维脱敏后显式纳入证据包；`ou qa` 只复制文件、写入 `install-evidence-manifest.json` 并记录 SHA-256，不会替 operator 自动清洗安装日志。若要把该项纳入机器门槛，至少提供一个脱敏 JSON summary，schema 为 `ou-ui-next.clean-install-evidence.v1`：`status` 必须是 `passed`，`installation.mode` 必须是 `fresh`，`installation.exitCode` 或 `installerExitCode` 必须是 `0`，`environment.cleanServer=true`，`environment.preExistingOuUi=false` 或 `preExistingOuUiNext=false`，并且 `results.managementCliInstalled=true`、`results.serviceActive=true`、`results.panelReachable=true` 或 `frontendLoginPageVerified=true`；不要写入 token、password、cookie、CSRF、bearer、secret、带 query 的 URL 或未脱敏路径。安装后的 root-only CLI 可用 `ou clean-install-evidence` 生成这种脱敏摘要：命令要求显式传入 `--clean-server-confirmed --fresh-install-confirmed`，默认写入 `/var/lib/ou-ui-next/acceptance/clean-install-evidence-<UTC>.json`，可选 `--transcript <path>` 只记录已脱敏 transcript 的 basename、大小和 SHA-256，不复制原文；快捷菜单 `ou cie` 会要求两次输入 `yes` 后才生成。该命令会检查后端服务、管理 CLI 和面板入口，或要求运维提供已有外部证据确认参数；它方便现场产出 strict gate 可读证据，但不替代真实干净服务器安装本身。之后可用 `ou qv --require-clean-install-evidence` 或在最终验收时传入 `--install-evidence` 强制检查。

```bash
sudo ou clean-install-evidence --clean-server-confirmed --fresh-install-confirmed
sudo ou clean-install-evidence --clean-server-confirmed --fresh-install-confirmed --transcript /root/ou-ui-receipts/install-transcript.redacted.txt
sudo ou qa --install-evidence /root/ou-ui-receipts/clean-install-summary.json
sudo ou qv --require-clean-install-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
```

Agent 主机侧的 `ou-agent qa` 或 `ou-agent qf` 证据包也可以显式纳入 Master 验收包；`ou qa` 只复制 Agent 包里的 `manifest.json`、`runtime-summary.json`，以及可选 `final-acceptance-summary.json` / `final-acceptance-verify.txt`，写入 `agent-evidence-manifest.json` 并记录 SHA-256。普通 `--require-agent-evidence` 仍可复核 `ou-agent qa` 的 runtime evidence，并要求附加 Agent manifest 中 `bundleDirectory` 非空、`serviceStatus=0`、`runtimeSummaryStatus=0`；生产发布复核 `qvr/qfa` 会额外要求 `ou-agent qf` 生成的 Agent 最终主机验收摘要和 transcript：

```bash
sudo ou qa --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z
```

`ou qa` 会固定使用当前安装的面板 URL、root-only 凭据文件、后端 env 文件、证据包内 `smoke-report.json`、`browser-smoke-report.json`、`browser-screenshots/`、`notification-smoke-report.json`、`webhook-smoke-report.json`、`archive-smoke-report.json`、`external-receipts-manifest.json`、`install-evidence-manifest.json` 和 `agent-evidence-manifest.json`，因此不接受 `--report`、`--base-url`、`--credentials-file`、`--screenshot-dir` 或 `--env-file`；可透传 `--timeout-ms`、`--insecure-tls`、`--skip-csrf-probe`、`--require-runtime-evidence`、`--include-notification-smoke`、`--telegram-admin-chat-id`、`--telegram-binding-id`、`--notification-language`、`--include-webhook-smoke`、`--webhook-url`、`--webhook-urls`、`--webhook-bearer-token`、`--webhook-bearer-token-file`、`--allow-local-webhook`、`--include-archive-smoke`、`--external-receipt`、`--archive-provider-evidence`、`--timestamp-evidence`、`--install-evidence`、`--require-archive-provider-evidence`、`--require-timestamp-evidence`、`--require-clean-install-evidence` 和 `--agent-evidence`，低资源服务器可显式使用 `--skip-browser-smoke` 降级。生成的 `manifest.json` 会记录 `doctor.txt`、`smoke.txt`、`smoke-report.json`、`browser-smoke.txt`、`browser-smoke-report.json`、`browser-screenshots.tar.gz`、`notification-smoke.txt`、`notification-smoke-report.json`、`webhook-smoke.txt`、`webhook-smoke-report.json`、`archive-smoke.txt`、`archive-smoke-report.json`、`external-receipts-manifest.json`、`install-evidence-manifest.json` 和 `agent-evidence-manifest.json` 的路径、字节数和 SHA-256；回执 manifest 会记录每个 provider / timestamp 附件在 `external-receipts/` 下的相对路径、记录路径、字节数和 SHA-256，安装证据 manifest 会记录每个附件在 `install-evidence/` 下的相对路径、记录路径、字节数和 SHA-256，Agent 证据 manifest 会记录每个 Agent 附件目录在 `agent-evidence/` 下的相对路径和关键文件哈希，便于归档后核对现场证据是否被改动。

归档或传输后可校验证据包完整性：

```bash
sudo ou qv /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv /var/lib/ou-ui-next/acceptance/20260606T120000Z/manifest.json
```

默认 `ou qv` 只校验 manifest 中记录的文件大小和 SHA-256，兼容旧证据包；需要把归档后的证据包作为现场验收门槛时，可以追加强制检查，要求 manifest.createdAt 为有效 UTC ISO 时间、manifest.bundleDirectory 非空、主 manifest 证据文件路径指向当前证据包或原始 bundleDirectory，HTTP/runtime、浏览器、通知和 webhook 烟测报告的 schemaVersion 与 startedAt/completedAt 均有效且 completedAt 不早于 startedAt，HTTP/runtime、浏览器和通知报告的 `checks` 非空、每项都有非空 `name`、有效 UTC ISO `checkedAt` 且位于 startedAt/completedAt 窗口内、全部 `passed`，并且 runtime strict 标记 `runtimeEvidenceRequired=true`、runtime acceptance summary check 标记 `required=true`、CSRF rejection probe 记录 `403 csrf.required`、runtime summary、浏览器烟测、浏览器截图归档、通知烟测，以及 webhook targets 的 UTC ISO `checkedAt` 位于 startedAt/completedAt 窗口内、HTTP 状态为 2xx、`responseBytes` 非负、全部 `passed` 且 URL 已脱敏；如果证据包是用 `ou qa --include-archive-smoke` 显式纳入真实外部归档投递生成的，还可以追加 `--require-archive-smoke`，要求 archive-smoke-report.json schemaVersion/createdAt 有效、`checks` 非空、每项都有非空 `name`、有效 UTC ISO `checkedAt` 且不早于 createdAt、全部 `passed`，并且真实归档 smoke 已通过；如果证据包附带了 provider 侧回执文件，可追加 `--require-external-receipts` 要求 external-receipts-manifest.json createdAt 有效、至少一个回执附件存在且路径/哈希匹配；如果回执包含 `ou-ui-next.archive-provider-evidence.v1` 脱敏 JSON，可追加 `--require-archive-provider-evidence` 要求至少一个回执证明对象存储投递和 provider 侧 Object Lock/retention 策略；如果回执包含 `ou-ui-next.timestamp-evidence.v1` 脱敏 JSON，可追加 `--require-timestamp-evidence` 要求至少一个回执证明第三方时间戳 receipt 已脱敏、已验证且 path/hash 匹配；如果证据包附带了干净服务器安装证据，可追加 `--require-clean-install-evidence` 要求 install-evidence-manifest.json createdAt 有效、至少一个安装 summary 符合 `ou-ui-next.clean-install-evidence.v1` 且路径/哈希匹配；如果证据包附带了 Agent 主机证据，可追加 `--require-agent-evidence` 要求 agent-evidence-manifest.json 和附加 Agent manifest 的 createdAt 有效、至少一个 Agent 证据包存在、Agent manifest.bundleDirectory 非空、`serviceStatus=0`、`runtimeSummaryStatus=0`、关键文件哈希匹配，并且 `runtime-summary.json` 证明 Xray inbound、端口转发 service、pending queue 和 guardrail 状态满足现场门槛；若要把 Agent 主机证据作为生产发布证据，还可追加 `--require-agent-final-summary`，要求 Agent 包包含 `ou-agent qf` 生成的 `final-acceptance-summary.json`、有效 UTC createdAt、与 Agent manifest.bundleDirectory 一致的非空 bundleDirectory 和校验 transcript，并复核其中记录的 manifest/transcript 路径、大小和 SHA-256；如果证据包来自 `ou qf`，还可以用 `--require-final-summary` 复核 Master 侧 `final-acceptance-summary.json` 的 createdAt 是否有效、bundleDirectory 是否非空且与 manifest.bundleDirectory 一致，并复核严格校验 transcript 路径、大小和 SHA-256 是否匹配；如果证据包来自 `ou qfa`，可用 `--require-release-summary` 复核 `release-acceptance-summary.json` 的 createdAt 是否有效、bundleDirectory 是否非空且与 manifest.bundleDirectory 或当前证据包目录一致、发布复核 transcript 路径、大小和 SHA-256，并把全量 gate 标记提升为本次内容校验：

```bash
sudo ou qv --require-runtime-evidence --require-browser-smoke /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-runtime-evidence --require-browser-smoke --require-notification-smoke --require-webhook-smoke /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-archive-smoke /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-external-receipts /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-archive-provider-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-timestamp-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-clean-install-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-agent-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-agent-final-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-final-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-release-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qvf /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qvr /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qvr --write-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z
```

也可以直接运行最终现场验收快捷命令。`ou qf` 会生成证据包，并立即执行严格 `ou qv --require-runtime-evidence --require-browser-smoke --require-notification-smoke --require-webhook-smoke`，校验 transcript 会保存为证据包内的 `final-acceptance-verify.txt`，机器可读摘要会保存为 `final-acceptance-summary.json`，其中记录 manifest 和校验 transcript 的路径、大小和 SHA-256，之后可用 `ou qvf <证据包>` 一次性复核 runtime、浏览器、通知、webhook 和 final summary strict gate；如果 final summary 记录 archive smoke、外部回执、provider evidence、timestamp evidence、干净安装、Agent evidence 或 Agent final summary gate 为 true，`qvf` 会自动把这些记录提升为本次 strict 校验并重新检查对应归档内容，同时要求 final summary 的 createdAt 是有效 UTC ISO 时间、bundleDirectory 与 manifest.bundleDirectory 保持一致，且 summary 内文件路径仍指向 manifest.bundleDirectory 或当前证据包目录下的对应文件，而不只信任 transcript marker。如果要把归档包作为“生产发布完成”门槛，用 `ou qvr <证据包>` 强制复核 archive smoke、外部回执、provider evidence、timestamp evidence、干净安装、Agent runtime evidence、Agent 最终主机验收摘要和 Master final summary 全部 strict gate，其中 archive smoke、外部回执、provider evidence、timestamp evidence、干净安装、Agent evidence 和 Agent final summary gate 也必须由 Master final summary 记录；若归档包已包含 `release-acceptance-summary.json`，`ou qvr` 还会自动复核 release summary 与 `release-acceptance-verify.txt`，要求 release summary 的 createdAt 是有效 UTC ISO 时间、bundleDirectory 与 manifest.bundleDirectory 或当前证据包目录保持一致，并把 release summary 记录的全量发布 gate 重新提升为内容校验；手动发布复核需要留证时可用 `ou qvr --write-summary <证据包>` 写入/覆盖这两个 release evidence 文件，本次复核通过或失败都会保留当前 bundleDirectory 和 transcript 路径/哈希，失败摘要会记录 `status=failed`。现场一次性执行生产发布验收时，用 `ou qfa`：它要求显式传入 `--include-archive-smoke`、`--archive-provider-evidence`、`--timestamp-evidence`、`--install-evidence` 和 `--agent-evidence`，先预检 provider、timestamp、clean-install 和 Agent 证据路径与内容，并要求 Agent 证据包含 `ou-agent qf` 最终主机验收摘要，再运行严格 `qf` 生成最终现场验收证据包，并把 Agent final summary gate 写入 Master transcript 与 `final-acceptance-summary.json`，随后立刻对同一证据包运行 `qvr`，把发布复核 transcript 保存为 `release-acceptance-verify.txt`、机器摘要保存为 `release-acceptance-summary.json`。`ou qf` 仍是普通最终现场验收入口，`ou qvr` 是归档包发布复核入口，`ou qfa` 是防止发布验收漏接 archive/provider/timestamp/clean-install/Agent 证据的编排入口。`ou qf` 会自动启用 runtime/通知/webhook 证据采集，默认不触发外部归档 smoke，禁止 `--skip-browser-smoke`，并要求显式提供 Telegram 测试目标。若最终验收同时显式传入 `--include-archive-smoke`、`--external-receipt`、`--archive-provider-evidence`、`--timestamp-evidence`、`--require-archive-provider-evidence`、`--require-timestamp-evidence`、`--install-evidence`、`--require-clean-install-evidence` 或 `--agent-evidence`，`qf` 会在同一次严格校验中自动追加对应 strict gate；其中 `--archive-provider-evidence` 会自动要求外部回执哈希和 provider evidence schema 同时通过，`--timestamp-evidence` 会自动要求外部回执哈希和 timestamp evidence schema 同时通过，`qfa` 会在 `--agent-evidence` 基础上额外要求 Agent final summary gate，并把这些可选 strict gate 写入 final summary，供 `ou qvf <证据包>` 归档后复核：

```bash
sudo ou qf --telegram-admin-chat-id 123456
sudo ou qf --telegram-binding-id telegram-binding-001 --notification-language en --webhook-url https://hooks.example.com/ou-ui-alerts
sudo ou qf --telegram-admin-chat-id 123456 --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json
sudo ou qf --telegram-admin-chat-id 123456 --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json
sudo ou qf --telegram-admin-chat-id 123456 --install-evidence /root/ou-ui-receipts/clean-install-summary.json
sudo ou qf --telegram-admin-chat-id 123456 --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z
sudo ou qfa --telegram-admin-chat-id 123456 \
  --include-archive-smoke \
  --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json \
  --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json \
  --install-evidence /root/ou-ui-receipts/clean-install-summary.json \
  --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z
```

`ou qfa` 只负责强约束编排，不会替 operator 生成真实 provider 控制台/API、第三方时间戳、干净服务器安装或 Agent 主机事实；这些证据仍必须来自真实现场并先完成脱敏。

也可以在安装目录手动运行同一个脚本：

```bash
cd /opt/ou-ui-next/current
sudo env OU_UI_SMOKE_BASE_URL="https://你的域名:8443/安全路径/" npm run smoke:production
```

如果使用自签名证书或 IP + HTTPS，可追加 `OU_UI_SMOKE_INSECURE_TLS=1`。脚本默认读取安装器生成的 `/etc/ou-ui-next/credentials.env`，不会打印登录密码、cookie、CSRF token 或后端 bearer token；非 root 用户也可以显式提供 `OU_UI_SMOKE_USERNAME` / `OU_UI_SMOKE_PASSWORD`，或用 `OU_UI_SMOKE_CREDENTIALS_FILE=/path/to/credentials.env` 指定凭据文件。`--report` 或 `OU_UI_SMOKE_REPORT_PATH` 写出的报告只包含检查项、HTTP 状态、时间戳和非敏感摘要，默认按 `0600` 权限保存。

烟测会检查：

- `/api/v1/boundary` 公开版本发现，安装器生成的 Nginx 安全路径代理必须让该精确路由绕过 session gate
- 未登录访问 `/api/v1/snapshot` 必须返回 `401`
- `POST /api/v1/auth/session` 登录并返回 session cookie 与 CSRF token
- 登录后读取 `/api/v1/snapshot`、`/api/v1/observability-metrics` 和 `/metrics`
- `/events/v1/tasks?once=1` 与 `/events/v1/system-alerts?once=1` 返回 `text/event-stream`
- `DELETE /api/v1/auth/session` 可注销当前会话

默认还会发起一次缺少 `X-CSRF-Token` 的无状态 POST 探针，并期望返回 `403 csrf.required`；这不会创建任务或修改业务配置，但会留下脱敏 `audit.denied` 证据。只想做纯只读烟测时可运行 `sudo ou sm --skip-csrf-probe`，或手动设置 `OU_UI_SMOKE_CSRF_PROBE=0` / 追加 `-- --skip-csrf-probe`。

安装脚本当前会做这些事：

- 显示交互式安装确认
- 询问 Master 面板监听端口
- 询问是否已有域名解析到当前主机
- 如果已有域名：
  - 安装并配置 `acme.sh`
  - 申请 Let's Encrypt 证书
  - 将证书安装到 OU-UI Next 配置目录
  - 写入 nginx HTTPS 配置，并配合 reload 流程
- 如果没有域名：
  - 使用 IP + 端口的 HTTP 方式部署
- 无论是否有域名，都会：
  - 生成 16 位安全访问路径
  - 生成随机管理员用户名
  - 生成随机管理员密码
  - 生成用于 HttpOnly 登录会话签名的 session secret
  - 生成用于后端代理链路的 operator token
  - 从 GitHub 同步最新 Master 源码
  - 部署 nginx、systemd 服务与持久化 Control Plane 状态目录
  - 在安装结束时打印最终访问地址和凭据

### 🛡️ 零配置取向

安装脚本的设计取向是“少问问题，多自动化”：

- 面板入口由随机安全路径、前端登录页和服务端 HttpOnly operator session 共同保护，不应弹出浏览器 Basic Auth 认证框
- 安装脚本会在部署结束后自检面板 URL，确认返回的是 OU-UI Next 前端登录页，并且没有浏览器系统认证框
- 默认推荐使用 `8443` / `9443` 等独立面板端口；如果手动选择 `443`，脚本会要求二次确认
- 如果打开面板时弹出浏览器系统账号密码框，通常说明当前端口/域名命中了其它 Nginx 站点；优先运行 `ou d` 查看冲突配置，重新安装时建议选择 `8443` / `9443` 等独立端口，避免与已有 443 服务冲突
- 如果刚安装后发现前端不是最新版本、旧演示节点仍然出现、快捷命令缺失、或面板地址仍返回 Basic Auth，直接运行 `ou fix --force`；它会更新到 GitHub 最新代码、重写 Nginx 面板站点、清理旧控制面状态，并确认受控主机库存回到空状态
- API 请求通过 nginx 代理到后端；浏览器侧 `/api`、`/events` 和 `/metrics` 会先通过 `auth_request` 校验 HttpOnly session，校验通过后才由反代层注入后端 operator token。session-backed `/api/v1` mutation 会额外校验 `X-CSRF-Token`，operator token 和登录密码都不写入前端构建产物，避免浏览器侧泄露
- 当前浏览器退出登录会命中 `DELETE /api/v1/auth/session`；安全策略页会单独拉取 operator session 列表并支持按会话撤销，服务端撤销后旧 cookie 会立即失效
- 安装器和 `ou fix --force` 的 Agent 安装命令 API 自检会从 session 登录响应读取 CSRF token，并在 cookie-backed mutation 中自动带上 `X-CSRF-Token`，避免修复/重置流程被 CSRF 防护误拦
- Nginx HTTPS 模板会根据本机版本自动选择现代 `http2 on;` 或旧版兼容写法，避免新版本产生弃用告警，同时保留旧版可安装性
- Agent 一键安装命令默认从 GitHub raw 拉取 `public/install/ou-agent.sh`，避免依赖 Master 本地静态文件或被面板登录保护拦截
- 新安装的生产面板默认不注入演示节点；受控主机只有在 Agent 完成注册后才会出现，注册后先显示为等待真实心跳/遥测的 provisioning 状态
- Agent 安装命令只负责注册与初始化运行组件，主机名称、月度流量、到期时间和探测目标在面板中单独编辑
- 当可用域名存在时，SSL 证书签发和 nginx 接线由脚本处理
- 没有域名的主机仍可使用 IP + 端口完成部署

这套自动化覆盖的是当前 Master 控制平面的部署表面。完整多节点生产加固、外部持久化数据库选择、操作者身份策略、Agent 注册与轮换策略等能力仍需要继续实现和验证。

## 🧑‍💻 本地开发

安装依赖：

```bash
npm install
```

启动前端：

```bash
npm run dev
```

本地启动服务化 Control Plane：

```bash
npm run start:control-plane
```

## ✅ 验证

运行项目检查：

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

真实部署后运行生产入口烟测：

```bash
sudo ou sm
```

生成可归档的生产验收证据包：

```bash
sudo ou qa
```

## 🗂️ 仓库导览

- `src/app` - 应用外壳、运行时配置与导航
- `src/components` - 可复用 UI 组件与布局脚手架
- `src/features` - 各业务功能界面
- `src/server/control-plane` - 服务化 Master Control Plane 运行时
- `src/services/api` - 类型化 API 契约、HTTP adapter 与 mock adapter 桥接
- `docs/architecture` - 后端与控制平面边界说明
- `docs/openapi` - 机器可读 API 契约
- `scripts/install-master.sh` - 一键 Master 部署入口

## 🧱 交付方向

OU-UI Next 正在以可验证、可增量交付的方式推进 V1：

- 从原始 UI 蓝图工程化出前端实现
- 建立类型化领域模型与 API 契约
- 建立服务化后端内核
- 梳理执行记录、审计、权限与运行时状态边界
- 围绕“小白上手即用”完善 Master 部署自动化

当前仓库已经具备实用基础，但仍应被视为持续演进中的 V1 实现，而不是已经完全加固的多节点运维平台。
