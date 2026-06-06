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
- **类型化 Control Plane 契约**
  - OpenAPI 规范：[docs/openapi/ou-ui-next-v1.yaml](docs/openapi/ou-ui-next-v1.yaml)
  - Zod 请求校验与统一 API 响应封装
- **服务化 HTTP Control Plane**
  - 本地后端入口：`src/server/control-plane/http-control-plane-main.ts`
  - 围绕执行记录、审计、幂等、outbox、运行时发布模型和权限持久化建立服务/仓储边界
  - 审计仓储写入保持追加式护栏：重复 `auditLog.id` 会被拒绝，文件状态加载时也会拒绝重复审计 ID，避免重启后审计事件被覆盖或伪装追加
  - `/api/v1/audit-logs:verify` 支持校验当前持久化审计链，也支持提交导出的审计日志数组进行离线链完整性校验；配置 `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` 后，每条新写入的审计日志都会把 `hash` / `prevHash` / action / result 等脱敏锚点追加写入该目录下的 `audit-anchors.jsonl`，便于在控制面状态之外核对审计链头
  - Agent HTTP poll 租约会在 command outbox 读模型中记录安全的 `leaseOwnerId` 与 `leaseSessionId`；启用 Agent 认证时 owner 使用 credential ID，不暴露 runtime token
  - Agent 一键注册成功后会立即以 `provisioning` 状态进入受控主机读模型，并保留注册版本、平台和能力信息；只有真实 heartbeat/telemetry 才会把主机推进为在线状态
  - Agent install token 兑换 runtime credential 会写入 `agent.credential.issued` 审计链事件，审计内容只包含脱敏凭据摘要和注册元数据，不记录 raw token 或 token hash
  - Agent runtime credential 临近过期时，真实 Agent 会用当前仍有效的 runtime token 调用 `/agent/v1/credentials/rotate` 主动换取新 token，原子写回本地 env 并在下一轮 runner 重新加载；显式撤销后的旧 token 仍会立即失效，不会复用一次性 install token 自动恢复
  - Operator 受保护 REST/SSE/Prometheus 接口的 bearer 认证失败会快速返回 `401 unauthorized` 并写入 `audit.denied`，只记录方法、后端路径和是否提交 token，不记录 bearer token；同一来源失败默认按 60 秒 / 20 次窗口限速，超过后返回 `429 operator_auth.rate_limited` 并只写入一条节流审计，避免审计链无界增长；SQLite-backed 生产仓储下拒绝审计使用同一事务读取审计链前序哈希，避免认证失败路径被仓储队列自阻塞
  - `/api/v1/observability-metrics` 与 `/metrics` 会聚合任务、outbox、Agent、审计与系统告警指标，系统告警同时按严重级别、告警类型和 webhook retry/dead-letter 队列计数，并暴露 Agent 运行日志 retained chunk 总量/字节/时间范围、日志归档桶数/片段数/字节/时间范围、retained 流量历史总量、按维度计数、最早/最新样本时间、累计 metered bytes、压缩归档桶数、归档原始样本数、最早/最新归档时间和归档累计计费，便于外部监控区分 Agent offline、采样缺口、高延迟、runtime service 异常、command outbox 超时/死信、runtime reload failed、quota exceeded、通知积压、日志与流量历史存储压力
  - 系统告警支持 webhook 外部通知：配置 `OU_UI_SYSTEM_ALERT_WEBHOOK_URL` 后，告警激活、更新和恢复会发送脱敏 JSON 事件；可用 `OU_UI_SYSTEM_ALERT_WEBHOOK_TIMEOUT_MS` 调整超时，用 `OU_UI_SYSTEM_ALERT_WEBHOOK_BEARER_TOKEN` 给 webhook 请求附加 bearer 认证；投递会先写入持久化队列，失败按 `OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_DELAY_MS` 重试，超过 `OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_ATTEMPTS` 后进入 dead-letter，后台扫描间隔和每轮上限可用 `OU_UI_SYSTEM_ALERT_WEBHOOK_RETRY_SWEEP_INTERVAL_MS` / `OU_UI_SYSTEM_ALERT_WEBHOOK_MAX_DELIVERIES_PER_SWEEP` 调整，投递日志只记录脱敏目标
  - 通过 HttpOnly operator session 认证的 `/api/v1` 变更类请求必须携带服务端签发的 `X-CSRF-Token`；不携带 session cookie 的 bearer token 自动化请求和 `/agent/v1/*` Agent 请求不要求 CSRF
  - Operator 会话会在服务端登记，可通过受保护的 `/api/v1/operator-sessions` 查看，并通过 `/api/v1/operator-sessions/{sessionId}/revoke` 精确撤销；撤销或退出登录后，原 session cookie 的后续受保护请求会被拒绝并写入审计链
  - 安全策略页会展示 Agent install/runtime 凭证的脱敏清单，只显示 `tokenPrefix`、用途、状态、会话和审计元数据，不显示原始 token 或 `tokenHash`；活跃 runtime 凭证可从面板触发撤销或轮换，操作会刷新凭证读模型并保留审计链证据
  - Agent 心跳与遥测事件会进入服务端读模型，并按 30 秒探测节奏推导在线、降级和离线状态；Agent telemetry 会包含 CPU/内存/磁盘、系统负载、网络流量以及 Agent/Xray/端口转发 systemd 服务健康状态，受控主机详情可直接查看，Agent offline、红色高延迟和必需服务异常会进入系统告警
  - Agent 运行日志 chunk 支持受保护检索和导出，并默认按 7 天、每台主机代理 5000 条执行保留清理；`GET /api/v1/agent-log-chunks:export` 可按主机、任务、命令和时间窗口导出 JSONL/JSON 诊断文件；被留存策略剪枝移除的日志会按 UTC 日、Agent、任务、命令和 stream 压缩成只含片段数、字节数、会话、时间范围和内容哈希的归档摘要，不保留完整正文；受保护的 `/api/v1/agent-log-archives` 与 `/api/v1/agent-log-archives:export` 可查询和导出这些摘要，“执行记录”页也会展示归档摘要并支持直接导出；配置 `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` 后，新生成的日志归档摘要还会追加写入该目录下的 `agent-log-archives.jsonl` 外部归档文件；`GET/PATCH /api/v1/agent-log-retention-policy`、快照与“执行记录”页会展示并编辑当前生效留存策略，策略会持久化到控制面仓储、写入 `agent.log_retention.updated` 审计链，并在后续 Agent `log_chunk` 上报时立即生效
  - Agent 运行脚本会显式执行 `health` 与 `telemetry` 命令，`telemetry` 会额外回传 `telemetry_sample` 刷新读模型，未知命令会回传失败结果而不是假装成功
  - Agent telemetry 会把受控主机、端口转发和 Xray 客户端计数写入流量历史统计读模型；系统总览页按三种维度聚合真实历史样本，支持直接导出当前维度的 JSONL 诊断文件，并在流量历史留存面板展示运行配置默认值、控制面覆盖值与当前生效值，操作员可直接保存 `maxAgeDays` / `maxRecordsPerScope` 覆盖，后续 telemetry 写入会按该策略剪枝并写入 `traffic.rollup_retention.updated` 审计链；被剪枝的原始 rollup 会压缩成按 UTC 日、维度、Agent、主体和计费周期聚合的归档桶，可通过受保护 API 查询和导出，系统总览页也会按当前维度展示归档桶数、原始样本数、累计计费、最新归档时间并支持直接导出归档 JSONL；配置 `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` 后，新生成的流量压缩归档桶还会追加写入该目录下的 `traffic-rollup-compactions.jsonl` 外部归档文件；retained 样本总量、按维度计数、最早/最新样本时间、累计 metered bytes、压缩归档桶数、归档原始样本数和归档累计计费会进入 observability 与 Prometheus 指标
  - Agent ACK/result/log 事件的 `commandId`、`taskId` 和 `agentId` 必须同时匹配 command outbox 记录；错绑事件会返回 `agent_event.command_task_mismatch`，不会写入 Agent event、更新 outbox 或污染任务投影，批量 `/agent/v1/events` 中会作为不可重试项计入 `rejected`
  - 端口转发读模型只在所有目标 Agent result 成功且修订号校验通过后才把端口显示为“已分配”；Agent 回传端口绑定冲突时会把规则和绑定投影为“端口冲突”，Agent telemetry 只更新流量/配额读数，不伪造部署成功
  - Agent 端口转发 apply/remove 会按服务名清理旧 TCP/UDP systemd unit 后再按最新协议重建，编辑规则从 `tcp+udp` 收窄到单协议或删除规则时不会残留旧转发服务
  - Xray 客户节点的配额/到期 guardrail 会作用到 Agent 运行时配置；即使 Xray StatsService 暂不可用，Agent 也会回传 `source: xray-guardrail` 策略样本，Master 只更新策略状态并保留最后有效流量计数，策略恢复后会重新启用此前由 runtime guardrail 停用的客户节点读模型
  - `/api/v1/quota-policies` 会从受控主机、客户节点、订阅客户、端口转发账号和端口转发规则聚合真实配额状态；订阅客户 `user:*` 配额超限会阻断公开订阅下载并返回 `subscription.quota_exceeded`，执行 `quota.reset` 后会写入 reset baseline，客户订阅读模型和公开订阅 `subscription-userinfo` 流量头只统计重置后的用量
  - `/api/v1/customers` 会从客户节点、订阅身份和端口转发 owner 动态生成客户目录，不依赖手工假客户种子；同名客户跨来源去重，总用量按 `max(客户节点用量, 订阅用量) + 端口转发用量` 聚合；前端“客户管理”页独立展示该目录、来源、资源计数、配额状态和最近活动
  - Xray Reality 客户节点区分服务端 `privateKey/target/serverNames/shortIds` 与客户端订阅 `pbk/fp/sid` 参数；UI 预览、API metadata、runtime artifact 和分享链接保持同一字段语义
  - Sing-box 公开订阅会输出 VLESS `flow`、Reality `public_key/short_id`、uTLS fingerprint 以及 WS/gRPC/HTTPUpgrade transport 字段，客户端订阅不会携带服务端 Reality 私钥
  - 本地 Xray inbound 如果包含多个 client，公开订阅会按 client 展开节点并按订阅身份过滤，只输出当前客户自己的 UUID/password/auth、用量和链接，不再默认使用 inbound 的第一个 client
  - 外部订阅源同步只允许抓取 `http` / `https` 订阅地址，会在 fetch 前拦截 localhost、私网/本机 IP 字面量以及 DNS 解析到私网/本机 IP 的域名，默认生产读取会按已校验 DNS 公网地址建连并保留原始 Host / HTTPS SNI
  - 外部订阅源同步开始前会在持久订阅源读模型写入非敏感 sync lease；并发实例再次同步同一来源时会按 lease / refresh interval 返回 `subscription_source.rate_limited`
  - 外部订阅源同步会按 provider host 统计未过期的持久 sync lease，并默认限制同一上游 host 同时最多 2 个抓取任务；可通过 `OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST` 调整
  - 删除最后一个 Xray 客户节点会停止并移除 `ou-ui-xray.service`，同时把被移除的 systemd unit 纳入本地 revision changed files，保证运行时收敛和回滚证据一致
  - 删除、回滚、运行时 reload、quota reset 和权限撤销等高风险任务需要显式 `riskConfirmation`，`operation` 与 `targetId` 必须和任务本体一致；缺失或不匹配会拒绝并写入 `audit.denied`
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
ou-ui reset-state
ou-ui uninstall
```

最短入口是 `ou`：安装完成后直接输入 `ou` 会打开交互式快捷菜单，不需要记完整命令。
如果你安装的是旧版本，服务器上还没有 `ou` / `ou-ui` 命令，可以先执行下面的救援命令刷新快捷入口，再运行 `ou f --force` 修复前端、Nginx 与旧状态：

```bash
sudo bash -c 'bash <(curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh) repair-cli'
```

状态检查分两层：`ou s` 只查看 systemd 服务状态，`ou d` 会执行完整安装诊断，包含 Nginx、Basic Auth、面板地址、服务状态、控制面状态文件、源码提交和前端构建提交。
卸载前请先确认是否需要备份数据；`ou x` / `ou-ui uninstall` 会删除安装目录、配置目录、状态目录、Web 静态目录、Nginx 站点和 systemd 服务。
使用 `OU_UI_LOCAL_SOURCE_DIR` 的本地源码部署只建议开发调试；生产更新应使用 GitHub 安装路径，这样 `ou u` / `ou f` 才能直接从远端拉取最新版本。
主机代理安装完成后也会提供 `ou-agent` 快捷入口：`ou-agent` 打开菜单，`ou-agent status` 查看状态，`ou-agent update` 从 GitHub 更新 Agent 运行时且不会重新注册、不消耗新的安装 Token，`ou-agent uninstall` 卸载该主机代理。

更短的快捷入口也会自动安装：`ou p` 打印面板信息，`ou c` 打印登录信息，`ou rs` 重启服务，`ou u` 从 GitHub 更新，`ou f` 一键修复安装异常，`ou r` 重置控制面状态，`ou m` 修改端口/证书，`ou d` 运行安装诊断，`ou x` 卸载面板。

其中 `ou-ui credentials` / `ou c` 会打印完整面板地址、登录账号和登录密码；`ou-ui doctor` / `ou d` 会检查 Nginx、Basic Auth、服务状态、控制面状态文件、源码提交和前端构建提交；`ou-ui fix` / `ou f` 会从 GitHub 更新源码、重建前端、刷新快捷命令、重启服务、重写 OU-UI 面板 Nginx 站点，并校验登录页、Basic Auth 和前端构建指纹，旧版本升级时如果静态文件已由本次构建刷新但缺少 `build-info.json`，会在同一次更新内补写指纹；刚安装后如果看到旧假数据可运行 `ou fix --force` 自动清理控制面旧状态；`ou-ui repair-nginx` 会在不重建前端的情况下重新写入面板 Nginx 配置；`ou-ui reconfigure` / `ou m` 会重新打开安装向导，用于修改端口、证书和 Nginx 配置；`ou-ui reset-state` / `ou r` 用于刚安装后清除旧状态/旧假数据。`ou-ui` 与 `ouui` 也会作为等价快捷命令安装。

✅ 默认部署方式是从 GitHub 拉取 `cshaizhihao/ou-ui-next` 的 `main` 分支源码并在服务器上构建，不要求用户提前克隆仓库。只有开发调试场景才建议显式设置 `OU_UI_LOCAL_SOURCE_DIR=/path/to/ou-ui-next` 使用本地源码。

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
  - 自检前端登录页、全新安装空库存和 Agent 一键安装命令 API
  - 在安装结束时打印最终访问地址和凭据

### 🛡️ 零配置取向

安装脚本的设计取向是“少问问题，多自动化”：

- 面板入口由随机安全路径、前端登录页和服务端 HttpOnly operator session 共同保护，不应弹出浏览器 Basic Auth 认证框
- 安装脚本会在部署结束后自检面板 URL，确认返回的是 OU-UI Next 前端登录页、没有浏览器系统认证框、控制面库存为空，且能够生成真实 Agent 一键安装命令
- 默认推荐使用 `8443` / `9443` 等独立面板端口；`443` 可以手动选择，但脚本会要求二次确认，因为它最容易与已有网站、反向代理或旧面板冲突
- 如果遇到浏览器系统账号密码弹窗，优先运行 `ou d` 查看是否命中了旧 Nginx 站点、同端口冲突或 Basic Auth 残留；重新安装时优先避开 `443`
- 如果刚安装后发现前端不是最新版本、旧演示节点仍然出现、快捷命令缺失、或面板地址仍返回 Basic Auth，直接运行 `ou fix --force`；它会更新到 GitHub 最新代码、重写 Nginx 面板站点、清理旧控制面状态，并确认受控主机库存回到空状态
- API 请求通过 nginx 代理到后端；浏览器侧 `/api`、`/events` 和 `/metrics` 会先通过 `auth_request` 校验 HttpOnly session，校验通过后才由反代层注入后端 operator token。session-backed `/api/v1` mutation 会额外校验 `X-CSRF-Token`，operator token 和登录密码都不写入前端构建产物，避免浏览器侧泄露
- 当前浏览器退出登录会命中 `DELETE /api/v1/auth/session`；安全策略页会单独拉取 operator session 列表并支持按会话撤销，服务端撤销后旧 cookie 会立即失效
- 安装器和 `ou fix --force` 的 Agent 安装命令 API 自检会从 session 登录响应读取 CSRF token，并在 cookie-backed mutation 中自动带上 `X-CSRF-Token`，避免修复/重置流程被 CSRF 防护误拦
- Agent 一键安装命令默认从 GitHub raw 拉取 `public/install/ou-agent.sh`，避免依赖 Master 本地静态文件或被面板登录保护拦截
- 新安装的生产面板默认不注入演示节点；受控主机只有在 Agent 完成注册后才会出现，注册后先显示为等待真实心跳/遥测的 provisioning 状态
- Agent 安装命令只负责注册与初始化运行组件，主机名称、月度流量、到期时间和探测目标在面板中单独编辑
- 当可用域名存在时，SSL 证书签发和 nginx 接线由脚本处理
- 没有域名的主机仍可使用 IP + 端口完成部署

这套自动化覆盖的是当前 Master 控制平面的部署表面。安装后的管理命令已提供带 SHA-256 manifest 的本地单节点备份/恢复路径，并会默认配置外部归档目录，把留存剪枝产生的日志归档摘要、流量压缩归档桶和审计链锚点追加写入控制面状态之外的 JSONL 文件，便于更新、修复或回滚前验证控制面存储快照、归档证据与审计链头；完整多节点生产加固、对象存储级归档、第三方时间戳锚定、外部持久化数据库选择、操作者身份策略、Agent 注册与轮换策略等能力仍需要继续实现和验证。

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

当前 V1.0 生产验收矩阵维护在 [docs/architecture/v1-production-acceptance.md](docs/architecture/v1-production-acceptance.md)。每次核心模块迭代都应同时更新验收状态、README 或架构文档，并通过测试、lint、typecheck 和构建。

默认本机安装验证端口约定为 `8778`。域名部署目标为 `ouui.zze.cc`；部署或修复 nginx 时必须只写入 OU-UI Next 面板站点，避免影响同机其他应用。

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
