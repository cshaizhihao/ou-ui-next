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
- **类型化 Control Plane 契约**
  - OpenAPI 规范：[docs/openapi/ou-ui-next-v1.yaml](docs/openapi/ou-ui-next-v1.yaml)
  - Zod 请求校验与统一 API 响应封装
- **服务化 HTTP Control Plane**
  - 本地后端入口：`src/server/control-plane/http-control-plane-main.ts`
  - 围绕执行记录、审计、幂等、outbox、运行时发布模型和权限持久化建立服务/仓储边界
  - 提供受保护的 `/events/v1/tasks` SSE 任务事件流，连接时先发送支持 `cursor` / `Last-Event-ID` 续连的任务状态历史与审计快照；任务状态事件会从持久化审计链回放 `queued/running/succeeded/failed/...` 全链路历史，后续再轮询持久读模型追踪新增 task/audit 事件；默认 SQLite 生产部署下，多实例面板可跨进程继续收到后续任务事件
  - 提供受保护的 `/events/v1/system-alerts` SSE 系统告警快照流，连接时发送当前活动告警，并在告警指纹变化时推送新快照；活动告警会与持久化 lifecycle 读模型对账，并把 `active` / `resolved` 生命周期记录持久化到控制面仓储；默认 SQLite 生产部署下，多实例面板也会跨进程看到后续告警快照，外部通知渠道仍在后续生产加固范围内
  - 服务化只读 API 会在读取前从持久化 task / Agent event / 订阅仓储重建当前读模型，因此受控主机、订阅、端口转发等快照在默认 SQLite 生产部署下可跨实例追平，不依赖单进程内存态或重启回放
  - 提供受保护的 `/api/v1/observability-metrics` 生产诊断指标快照，聚合任务状态、完成延迟、rollback 计数、command outbox backlog/租约/超时/dead-letter、ACK/result 延迟、Agent offline/degraded、系统告警严重级别、审计链校验状态、审计拒绝计数和 quota exceeded 审计计数
  - 提供受保护的 `/metrics` Prometheus 文本指标端点，将当前生产诊断快照导出为外部监控可抓取的 gauge 指标
  - 生产入口输出 JSON 结构化日志，覆盖 HTTP 请求、错误、任务、Agent poll/events 和命令下发，并带 `requestId`、`traceId`、`taskId`、`commandId`、`agentId` 等排障字段
  - Agent HTTP poll 租约会在 command outbox 读模型中记录安全的 `leaseOwnerId` 与 `leaseSessionId`；启用 Agent 认证时 owner 使用 credential ID，不暴露 runtime token
  - Agent 一键注册成功后会立即以 `provisioning` 状态进入受控主机读模型，并保留注册版本、平台和能力信息；受控主机卡片会直接显示状态 badge 与这些注册元数据，只有真实 heartbeat/telemetry 才会把主机推进为在线状态
  - Agent install token 兑换 runtime credential 会写入 `agent.credential.issued` 审计链事件；缺失、无效、过期 install token 或 Agent 身份不匹配的注册失败会写入 `audit.denied`，审计内容只包含脱敏凭据摘要、注册元数据和是否提交 token，不记录 raw token 或 token hash
  - Agent poll/events 的认证失败或身份不匹配会写入 `audit.denied`，审计只保留 endpoint、Agent/session 摘要和已认证 credential 摘要，不记录 bearer token
  - Operator 受保护 REST/SSE/Prometheus 接口的 bearer 认证失败会写入 `audit.denied`，只记录方法、后端路径和是否提交 token，不记录 bearer token；同一来源失败默认按 60 秒 / 20 次窗口限速，超过后返回 `429 operator_auth.rate_limited` 并只写入一条节流审计，避免审计链无界增长
  - 通过 HttpOnly operator session 认证的 `/api/v1` 变更类请求必须携带服务端签发的 `X-CSRF-Token`；不携带 session cookie 的 bearer token 自动化请求和 `/agent/v1/*` Agent 请求不要求 CSRF，CSRF 拒绝会写入脱敏 `audit.denied` 且不消耗登录失败节流窗口
  - Operator 会话会在服务端登记，可通过受保护的 `/api/v1/operator-sessions` 查看，并通过 `/api/v1/operator-sessions/{sessionId}/revoke` 精确撤销；撤销或退出登录后，原 session cookie 的后续受保护请求会被拒绝并写入审计链
  - 安全策略页会展示 Agent install/runtime 凭证的脱敏清单，只显示 `tokenPrefix`、用途、状态、会话和审计元数据，不显示原始 token 或 `tokenHash`；活跃 runtime 凭证可从面板触发撤销或轮换，操作会刷新凭证读模型并保留审计链证据
  - 审计仓储写入保持追加式护栏：重复 `auditLog.id` 会被拒绝，文件状态加载时也会拒绝重复审计 ID，避免重启后审计事件被覆盖或伪装追加
  - `/api/v1/audit-logs:verify` 支持校验当前持久化审计链，也支持提交导出的审计日志数组进行离线链完整性校验
  - 安装脚本生成的 Nginx 面板代理会对 `/events/v1/*` 保持无缓冲并显式返回 `text/event-stream`，避免浏览器或反向代理把事件流当作普通 HTML 响应
  - Agent 运行日志 chunk 支持受保护检索，并默认按 7 天、每 Agent 5000 条执行保留清理；前端“执行记录”页会展示最近保留的主机代理运行日志、任务 ID、命令 ID 和日志流，便于核对 Agent 真实执行结果，避免状态文件无界增长
  - Agent 运行脚本每轮 poll 后上报 heartbeat，并默认每 30 秒采集 ping 延迟、硬件、磁盘、网络和流量 telemetry；Master 短暂不可达时自动进入本地 pending 队列重试
  - Runtime apply 命令的 inline artifact checksum 由规范化 artifact JSON 生成；Agent 在创建本地 snapshot、执行 Xray/端口转发预检和写入运行时文件之前会校验 checksum 与 `sig-v1` 摘要，不匹配时回传失败结果
  - Runtime preflight read model 覆盖 artifact 完整性、配置 schema、端口冲突、运行时依赖可用性和回滚 snapshot；Agent 失败结果会按原因标记对应检查项，并保留失败 health summary
  - Agent result 即使声称成功，也必须回传与命令匹配的 `appliedConfigRevision`；Master 会把缺失或不匹配的结果改判为失败，并标记 result verification 检查项
  - 端口转发读模型只在所有目标 Agent result 成功且修订号校验通过后才把端口显示为“已分配”；Agent 回传端口绑定冲突时会把规则和绑定投影为“端口冲突”，Agent telemetry 只更新流量/配额读数，不再把部署中的端口提升为已分配，人工 task transition 也不能把转发运行时任务置为成功
  - Agent 端口转发 apply/remove 会按服务名清理旧 TCP/UDP systemd unit 后再按最新协议重建，编辑规则从 `tcp+udp` 收窄到单协议或删除规则时不会残留旧转发服务
  - 端口转发规则支持显式停用/恢复：`forward.pause` 会把规则保留在控制面读模型中，但要求 Agent 下线对应运行时服务并把绑定状态投影为“已停用”；`forward.resume` 会复用同一规则配置重新下发
  - 受控主机与端口转发流量读模型按 `monthlyResetDay` 计算 UTC 月度计费窗口；Agent 回传 `trafficBillingPeriod`，Master 只接纳当前周期样本，快照读取进入新周期时会清零旧周期用量，并把主机、端口转发和 Xray 客户端计数写入追加式流量历史统计读模型；系统总览页会按受控主机、端口转发和客户节点三种维度聚合这些真实历史样本；主机 telemetry 读模型会按采样间隔派生采样缺口状态，并路由为系统告警展示在受控主机卡片、仪表盘和 `/events/v1/system-alerts` 事件流
  - Xray 客户节点 artifact 带有客户流量上限、手工校准用量和月度重置日；Agent 通过 Xray StatsService 采集客户上/下行并回传 `xrayClientCounters`，Master 将其投影到对应客户节点的当前用量；当 StatsService 暂不可用时，Agent 仍会回传 `source: xray-guardrail` 的策略样本，Master 只更新配额/到期策略状态，不覆盖最后一份有效流量计数
  - `/api/v1/quota-policies` 不再停留在静态种子数据：服务化与 mock 适配器都会把受控主机、客户节点、订阅客户、端口转发账号和端口转发规则的真实配额状态聚合成统一读模型，安全策略页可按范围直接查看当前窗口用量、计费方向、重置日和停用原因
  - `/api/v1/customers` 会从客户节点、订阅身份和端口转发 owner 动态生成客户目录，不需要手工假客户种子；同名客户会跨来源去重，客户总用量按 `max(客户节点用量, 订阅用量) + 端口转发用量` 聚合，避免本地 Xray 与订阅重复计费，同时保留转发独立流量；前端“客户管理”页独立展示该目录、来源、资源计数、配额状态和最近活动
  - 受保护的 `POST /api/v1/quota-policies/{quotaPolicyId}/reset` 会创建真实 `quota.reset` 任务：写入 before/after 审计快照、立即清零对应读模型窗口用量，并为后续 Agent telemetry 与订阅客户公开输出建立新 baseline，避免把重置前的历史流量重新累计回来
  - 端口转发规则与转发账号配额进入超额状态后，Master 会自动创建系统 actor `forward.pause` 任务并复用原有 Agent apply/outbox 链路；当对应配额恢复（例如 reset 后）时，会自动创建 `forward.resume` 任务，保证端口转发配额处置与恢复都有任务、审计和回放证据
  - Xray Reality 客户节点区分服务端 `privateKey/target/serverNames/shortIds` 与客户端订阅 `pbk/fp/sid` 参数；UI 预览、API metadata、runtime artifact 和分享链接保持同一字段语义
  - Sing-box 公开订阅会输出 VLESS `flow`、Reality `public_key/short_id`、uTLS fingerprint 以及 WS/gRPC/HTTPUpgrade transport 字段，客户端订阅不会携带服务端 Reality 私钥
  - 删除最后一个 Xray 客户节点会停止并移除 `ou-ui-xray.service`，同时把被移除的 systemd unit 纳入本地 revision changed files，保证运行时收敛和回滚证据一致
  - 客户节点 Xray 运行时只投影当前已能编译和下发的 VLESS、VMess、Trojan、Shadowsocks；显式请求未支持协议的历史/异常任务不会生成假的客户节点读模型
  - 客户订阅读模型和公开订阅响应会从已选择的本地 Xray client 聚合当前用量与生成节点数；匹配到真实运行时客户节点时不再信任创建订阅任务中的静态 `usedTrafficGb` / `generatedNodeCount`；订阅客户 `user:*` 配额超限会让公开订阅下载返回 `subscription.quota_exceeded`，执行 reset 后 `subscription-userinfo` 流量头会从 reset baseline 重新计算并恢复输出
  - 订阅分组读模型会从当前外部订阅源、同步后的节点库存和导出配置动态生成全局分组与按导出配置划分的分组，健康度、源状态和生成节点数不再依赖静态种子分组
  - 外部订阅源同步只允许抓取 `http` / `https` 订阅地址，会在 fetch 前拦截 localhost、私网/本机 IP 字面量以及 DNS 解析到私网/本机 IP 的域名，默认生产读取会按已校验 DNS 公网地址建连并保留原始 Host / HTTPS SNI，可通过 `OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST` 限定允许访问的外部 host，并支持按订阅源配置远程请求超时和响应体大小上限；超时、超限、不支持协议、allowlist 未命中和被拦截地址会进入同步失败状态与审计链
  - 外部订阅源同步开始前会在持久订阅源读模型写入非敏感 sync lease；并发实例再次同步同一来源时会按 lease / refresh interval 返回 `subscription_source.rate_limited`，避免重复远程抓取
  - 外部订阅源同步会按 provider host 统计未过期的持久 sync lease，并默认限制同一上游 host 同时最多 2 个抓取任务；可通过 `OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST` 调整，防止多个来源同时打爆同一服务商
  - 外部订阅源同步会按当前去重策略识别跨源重复节点，将订阅源标记为 warning，并把非敏感同步告警展示在订阅源表格中
  - 外部订阅源同步成功、告警和失败结果会写入审计哈希链，记录同步前后状态、节点数量和告警代码
  - 订阅规则支持按协议、地区、来源、受控主机、运行状态、客户名称和流量条件筛选节点；本地 Xray 节点会携带客户、主机、状态、已用流量和总配额元数据参与筛选
  - 外部订阅同步会解析服务商返回的 `subscription-userinfo` 流量头，将上传、下载、总量和到期时间写入订阅源流量快照，随订阅源读模型持久化并展示在订阅源表格中
  - Xray 客户节点超出月度配额或到期后，Agent 会从运行时 inbound 中过滤对应 client、重建 Xray 配置并回传 `runtimeDisabledByPolicy` 与禁用原因；Master 会据此自动创建系统 actor `inbound.update` 任务，把对应客户节点真实下线并保留完整配置快照与审计链；当配额恢复或执行 `quota.reset` 后，会再自动创建 `inbound.update` 恢复任务，把 Agent runtime、读模型和审计证据重新收敛到启用状态
  - 高风险任务需要显式 `riskConfirmation`，其 `operation` 和 `targetId` 必须与任务本体一致；删除、回滚、运行时 reload、quota reset 和权限撤销等操作缺失或不匹配时会被拒绝并写入 `audit.denied`
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
主机代理安装完成后也会提供 `ou-agent` 快捷入口：`ou-agent` 打开菜单，`ou-agent status` 查看状态，`ou-agent update` 从 GitHub 更新 Agent 运行时且不会重新注册、不消耗新的安装 Token，`ou-agent uninstall` 卸载该主机代理。

更短的快捷入口也会自动安装：`ou p` 打印面板信息，`ou c` 打印登录信息，`ou rs` 重启服务，`ou u` 从 GitHub 更新，`ou b` 备份控制面状态，`ou f` 一键修复安装异常，`ou r` 重置控制面状态，`ou m` 修改端口/证书，`ou d` 运行安装诊断，`ou x` 卸载面板。

其中 `ou-ui credentials` / `ou c` 会打印完整面板地址、登录账号和登录密码；`ou-ui doctor` / `ou d` 会检查 Nginx、Basic Auth、服务状态、当前控制面存储路径、源码提交、前端构建提交和旧演示 seed 残留；`ou-ui backup-state` / `ou b` 会为当前控制面存储创建备份，默认写入控制面备份目录，也可追加自定义输出路径；`ou-ui restore-state <备份路径>` 会先验证 SQLite 备份、创建恢复前快照，再停服务并切换到指定备份，追加 `yes` 可跳过交互确认；`ou-ui fix` / `ou f` 会从 GitHub 更新源码、重建前端、刷新快捷命令、重启服务、重写 OU-UI 面板 Nginx 站点，并校验登录页、Basic Auth 和前端构建指纹，旧版本升级时如果静态文件已由本次构建刷新但缺少 `build-info.json`，会在同一次更新内补写指纹；刚安装后如果看到旧假数据、三台默认节点或 `mutation denied`，可运行 `ou fix --force` 自动清理控制面旧状态；`ou-ui repair-nginx` 会在不重建前端的情况下重新写入面板 Nginx 配置；`ou-ui reconfigure` / `ou m` 会重新打开安装向导，用于修改端口、证书和 Nginx 配置；`ou-ui reset-state` / `ou r` 用于刚安装后清除旧状态/旧假数据。`ou-ui` 与 `ouui` 也会作为等价快捷命令安装。

✅ 默认部署方式是从 GitHub 拉取 `cshaizhihao/ou-ui-next` 的 `main` 分支源码并在服务器上构建，不要求用户提前克隆仓库。只有开发调试场景才建议显式设置 `OU_UI_LOCAL_SOURCE_DIR=/path/to/ou-ui-next` 使用本地源码。
默认生产安装会把控制面状态持久化到控制面 SQLite 数据库文件；如果更新前仍是旧的 JSON 状态文件，安装器会保留旧状态来源并在首次切到 SQLite 时自动导入。安装后的管理 CLI 也提供了本地单机备份/恢复闭环，便于在升级前、修复前或事故回滚前先固化一份控制面快照。

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
