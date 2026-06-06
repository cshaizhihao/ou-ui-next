# OU-UI Next V1.0 Backend / Universal Agent Architecture Contract

状态：V1.0 生产级架构合约  
最后更新：2026-06-02  
适用范围：OU-UI Next Master-to-Any 分布式网关与流量分发控制面板的真实后端、Universal Agent、运行时模块和当前前端 Mock API 的替换边界。

## 0. 合约目标

OU-UI Next V1.0 的前端已经具备 React/Vite/Tailwind、Mock API、domain types、执行记录和审计模型。本文件定义后端与 Universal Agent 的生产边界，使当前 Mock 控制面板可以在不重写 UI 的前提下替换为真实 Master 控制面、Agent 命令通道和运行时模块生命周期。

参考能力来源只作为能力输入，不作为直接架构继承：

- miaomiaowu：订阅聚合、节点分组、外部订阅导入、客户端配置导出。
- miaomiaowuX：Master + SubAgent 模式、远程 Xray/Nginx 配置管理、Agent 心跳和流量采集。
- 3X-UI：Xray 多协议、多用户到期、流量/IP 限制、订阅链接和入站管理。
- FLVX（端口转发参考项目）：账号级流量转发、TCP/UDP、双向计费、限速、分组权限、批量操作、面板联邦。OU-UI Next 对外命名统一使用“端口转发”，不把 FLVX 或 tunnel 作为 V1 功能名。

V1.0 的核心原则：

- 前端只发出 typed intent，不直接拼接 Xray/GOST/port-forwarding 运行时配置。
- 所有高风险动作必须进入 `DeployTask`，并产生 append-only `AuditLog`。
- Master 是唯一决策点，Agent 是受控执行点，Runtime Module 是可替换能力插件。
- Mock API 只模拟 UI 数据和任务状态，不代表真实后端安全性、持久化、网络通道或运行时执行能力。

## 1. Backend / Universal Agent 模块边界

### 1.1 V1.0 总体分层

```text
React UI / Mock Adapter
        |
Versioned API Boundary (/api/v1, /events/v1, /agent/v1)
        |
Master Control Plane
        |
Command Channel + Event Stream
        |
Universal Agent
        |
Runtime Modules: Xray / GOST / Port Forwarding / Kernel Tuning
```

### 1.2 Master Control Plane 必做模块

| 模块 | 生产后端必做 | 当前 Mock 只模拟 |
| --- | --- | --- |
| `auth` | 登录、会话、MFA/OIDC 接入、API Token、CSRF、防爆破、Agent mTLS 或签名令牌、权限判定 | 已有 bootstrap bearer、HttpOnly operator session 与 session-backed mutation CSRF；仍缺 MFA/OIDC、持久用户库和可撤销会话 |
| `identity` | 用户、operator group、tenant、资源可见范围、最小权限 | 只存在静态 actor 字符串 |
| `agents` | Agent 注册、证书签发、版本管理、心跳、能力发现、在线/离线状态、命令队列、升级/回滚 | 返回静态 `Agent[]`，无连接和命令下发 |
| `nodes` | 节点归属、入口地址、模块清单、端口占用、健康状态、资源组绑定 | 返回静态 `ManagedNode[]` |
| `modules` | Runtime Module 安装、版本锁定、状态机、能力声明、热重载能力、快照关联 | 返回静态 `RuntimeModule[]` |
| `compiler` | 将业务 intent 编译为 Xray/GOST/port-forwarding/kernel 配置；生成 diff、checksum、snapshot、preflight plan | 不编译真实配置 |
| `tasks` | 持久执行记录、状态机、重试、取消、超时、rollback task、并发锁、outbox dispatch | `createTask` 与 `transitionTask` 只在内存中改状态 |
| `audit` | append-only 审计账本、拒绝事件、before/after、requestId、actor、sourceIp、hash chain、保留策略 | 按任务生成简化审计记录 |
| `subscriptions` | 外部订阅抓取、解析、去重、分组、导出 Clash/Mihomo/Sing-box/URI、token 访问、速率限制、流量头 | 返回静态订阅源 |
| `xray` | 入站/客户端/协议/Reality/TLS/fallback/IP 限制/流量限制/到期禁用的真实管理 | 返回静态 inbound |
| `forwarding` | tunnel account、forward rule、TCP/UDP、端口冲突、账号流量、双向计费、批量操作、联邦同步 | 返回静态 tunnel/forward rule |
| `quota` | 流量采样、账单方向、硬限制/软限制、限速、禁用、重置窗口、超额恢复 | 返回静态 quota policy |
| `permission` | `permission.grant` / `permission.revoke` 审批、资源组权限、批量授权、越权拒绝 | 返回静态 permission grant |
| `metrics` | Agent telemetry、runtime health、流量速率、历史窗口、告警、指标保留 | 返回静态 telemetry |
| `persistence` | PostgreSQL 或等价事务型存储；任务/audit 强一致；指标可用时序存储 | 无持久化 |

### 1.3 Universal Agent 必做边界

Universal Agent 是节点侧的最小可信执行器，必须保持通用，不把 Xray/GOST/port-forwarding 业务逻辑硬编码成不可替换控制面。

Agent 负责：

- 建立 Master 命令通道，完成注册、认证、心跳、ACK、结果回传和日志分片。
- 暴露节点能力：OS、arch、kernel、可用端口、runtime module 清单、热重载能力、权限能力。
- 接收 `apply` / `rollback` / `reload` / `health` / `telemetry` 命令。
- 调用 runtime module adapter 完成配置预检、写入、热重载、健康验证和回滚。
- 本地保存最近成功 snapshot，保证 Master 暂时不可达时可以安全恢复上一个已知可用配置。
- 上报 telemetry、流量计数、runtime health、命令日志和失败原因。

Agent 不负责：

- 决定用户是否有权限。
- 决定配额是否超限。
- 自行接收 UI 业务请求。
- 自行生成订阅导出。
- 绕过 Master 修改生产配置。

### 1.4 当前 Mock 边界声明

当前 `src/services/mock` 是前端演示适配器，只保证：

- 能列出 Agent、Node、Inbound、Subscription、Tunnel、ForwardRule、QuotaPolicy、PermissionGrant。
- 能创建 `DeployTask`。
- 能模拟 `queued` / `running` / `succeeded` / `failed` 等状态转换。
- 能附带生成简化 `AuditLog`。

当前 Mock 不保证：

- 认证、授权、租户隔离和资源组过滤。
- 真实 REST/WebSocket/SSE/gRPC 协议。
- 任务持久化、幂等、重试、并发锁和 exactly-once dispatch。
- Xray/GOST/port-forwarding 配置编译、预检、热重载或回滚。
- quota enforcement、限速、超额停用、双向计费和账单结算。
- append-only 审计、安全日志保留、hash chain、外部 hash anchor 或合规导出。

## 2. Versioned API Boundary

### 2.1 版本策略

生产 API 必须从 V1 开始显式版本化：

- REST base path：`/api/v1`
- UI event stream：`/events/v1`
- Agent command stream：`/agent/v1`
- 可选内部 gRPC package：`ouui.controlplane.v1`

破坏性变更必须进入 `/api/v2` 或新增 gRPC package。V1 字段只允许向后兼容新增，不允许改变语义。废弃字段至少保留两个 minor release，并通过 response header 与审计事件标记。

### 2.2 通用 HTTP 合约

所有 REST 请求必须使用 JSON，时间使用 RFC3339 UTC 字符串，字节数使用 integer bytes。

推荐 response envelope：

```json
{
  "data": {},
  "requestId": "req_01HY...",
  "taskId": "task_01HY...",
  "warnings": []
}
```

错误 envelope：

```json
{
  "error": {
    "code": "permission.denied",
    "message": "operator group cannot configure this tunnel group",
    "details": {}
  },
  "requestId": "req_01HY..."
}
```

必备 headers：

- `Authorization: Bearer <token>` 或 HttpOnly session cookie。
- `X-CSRF-Token: <token>`：通过 HttpOnly session 认证的 `/api/v1` mutation 必填；不携带 session cookie 的 bearer token 自动化和 `/agent/v1/*` Agent 请求不需要。
- `X-Request-Id: <globally unique id>`：所有 mutation 必填。
- `If-Match: <resourceVersion>`：更新有并发风险的资源时必填。
- `Idempotency-Key: <requestId>`：可与 `X-Request-Id` 相同。

### 2.3 认证边界

Operator UI：

- 当前 service-backed 入口支持 `POST /api/v1/auth/session` 签发 HttpOnly operator session cookie；安装器 Nginx 会先通过 `auth_request` 校验 session，再向后端注入 operator bearer token。session 签发、撤销/退出和过期都会写入审计链。
- 推荐最终形态仍是 OIDC + HttpOnly secure cookie；自建账号必须支持 MFA、密码策略和登录限速。
- CSRF token 由 `POST /api/v1/auth/session` 与 `GET /api/v1/auth/session` 返回，前端对 session-backed operator mutation 自动注入 `X-CSRF-Token`；不携带 session cookie 的有效 bearer token 请求和 Agent 路径不触发该校验。
- API token 仅用于自动化集成，必须绑定 operator group、resource group 和过期时间。

Agent：

- 首次注册使用一次性 registration token。
- 注册成功后签发 agent identity：mTLS client certificate 或短周期签名 JWT + key rotation。
- Agent 身份必须绑定 `agentId`、fingerprint、版本、platform 和 capability set。
- Agent 不接受普通 operator token 执行命令。

订阅访问：

- Subscription access token 与 operator token 分离。
- token 只允许读取指定 export profile，并受速率、过期时间、流量头和审计约束。

### 2.4 REST 资源边界

| 资源 | 方法与路径 | 说明 |
| --- | --- | --- |
| Session | `POST /api/v1/auth/session`、`DELETE /api/v1/auth/session` | 登录和退出 |
| Agents | `GET /api/v1/agents`、`POST /api/v1/agents/register-token`、`POST /api/v1/agents/{agentId}/commands` | Agent inventory 与命令入口 |
| Nodes | `GET /api/v1/nodes`、`PATCH /api/v1/nodes/{nodeId}` | 节点元数据和资源组 |
| Modules | `GET /api/v1/modules`、`POST /api/v1/modules/{moduleId}/install` | runtime module lifecycle intent |
| Inbounds | `GET /api/v1/inbounds`、`POST /api/v1/inbounds`、`PATCH /api/v1/inbounds/{id}`、`DELETE /api/v1/inbounds/{id}` | Xray/协议入站 |
| Forward rules | `GET /api/v1/forward-rules`、`POST /api/v1/forward-rules`、`PATCH /api/v1/forward-rules/{id}`、`POST /api/v1/forward-rules:batch` | 端口转发和批量操作 |
| Subscriptions | `GET /api/v1/subscription-sources`、`POST /api/v1/subscription-sources/import`、`POST /api/v1/subscriptions/{profileId}/generate` | 订阅导入、同步、导出 |
| Quota | `GET /api/v1/quota-policies`、`POST /api/v1/quota-policies`、`POST /api/v1/quota-policies/{id}/reset` | 配额策略和重置 |
| Permissions | `GET /api/v1/permission-grants`、`POST /api/v1/permission-grants`、`DELETE /api/v1/permission-grants/{id}` | `permission.grant` / `permission.revoke` |
| Tasks | `GET /api/v1/tasks`、`GET /api/v1/tasks/{taskId}`、`POST /api/v1/tasks/{taskId}/cancel`、`POST /api/v1/tasks/{taskId}/rollback` | 任务状态和控制 |
| Audit | `GET /api/v1/audit-logs`、`GET /api/v1/audit-logs/{id}` | 审计查询，只读 |
| Config drafts | `POST /api/v1/config-drafts/compile`、`GET /api/v1/config-drafts/{id}/diff` | 编译和 diff preview |
| Snapshots | `GET /api/v1/runtime-snapshots`、`GET /api/v1/runtime-snapshots/{id}` | 回滚快照 |

所有 mutation endpoint 的成功返回应该包含 `taskId`。如果动作无需 Agent 执行，也必须经过 task/audit pipeline，以保持 UI 与审计一致。

### 2.5 Realtime 边界

UI 推荐：

- `GET /events/v1/tasks?since=<timestamp>&cursor=<eventId>`：SSE，推送 task 状态、audit 摘要、operator 可见告警；断线重连也可使用标准 `Last-Event-ID` header。
- `GET /events/v1/telemetry?scope=<resourceGroupId>`：SSE，推送低频聚合指标。
- WebSocket 只用于需要双向交互的运维控制台，不作为 V1 必需 UI 通道。

Agent 推荐：

- 默认：WebSocket over mTLS，`GET /agent/v1/connect?agentId=<id>`。
- fallback：HTTP pull，`POST /agent/v1/poll` 和 `POST /agent/v1/events`。
- 可选：gRPC bidirectional stream `AgentCommandService.Stream()`，适合 Go 后端和 Go Agent。

### 2.6 幂等 requestId

所有 mutation 必须提供 `requestId`。Master 对以下维度建立幂等记录：

- `actorId`
- `method`
- `path`
- `requestId`
- `normalizedBodyHash`

规则：

- 首次请求创建 task 和 audit。
- 同一 actor、method、path、requestId、body hash 重放时返回同一个 `taskId` 和当前 task 状态。
- 同一 requestId 但 body hash 不同，返回 `409 idempotency.conflict`，写入 `audit.denied`。
- 幂等记录保留时间不短于任务最大可重试窗口；建议不少于 7 天。

### 2.7 任务状态机

V1.0 与前端 `DeployTaskStatus` 对齐：

```text
queued -> running -> succeeded
queued -> canceled
queued -> running -> failed
running -> retrying -> running
failed -> retrying -> running
succeeded -> rolled_back
failed -> rolled_back
```

状态规则：

- `queued`：Master 已接受请求，审计 `task.created` 已写入，尚未 dispatch 或等待锁。
- `running`：Agent ACK 已收到，或后端本地步骤开始执行。
- `retrying`：可恢复失败进入重试窗口，必须记录 attempt 和原因。
- `succeeded`：Agent result 成功且 Master 已验证目标状态。
- `failed`：不可恢复失败或重试耗尽，必须有 `failureReason`。
- `canceled`：只允许在未造成运行时变更前取消；已 apply 的任务必须走 rollback。
- `rolled_back`：从成功或部分成功状态回滚到指定 snapshot。

非法转换必须返回 `409 task.invalid_transition` 并写入审计。

### 2.8 审计保证

生产审计必须满足：

- 所有 mutation 先写 `task.created` 或 `audit.denied`，再执行副作用。
- 审计写入与任务创建在同一事务内完成。
- Agent command dispatch 使用 outbox pattern，防止任务已创建但命令丢失。
- 每条审计包含 actor、operator group、resource group、operation、target、requestId、sourceIp、before/after 摘要、result、taskId。
- 审计 append-only，不允许更新原记录；修正使用新记录。
- 高风险动作保留 hash chain 或签名摘要，支持导出校验。
- 读取审计也受 RBAC 和 resource group 过滤。

## 3. Universal Agent 命令通道

### 3.1 通道目标

命令通道负责 Master 与 Agent 之间的可靠异步执行。Master 负责决策和排队，Agent 负责确认、执行、上报。

可靠性要求：

- command 至少一次送达，Agent 通过 `commandId` 和 `configRevision` 保证幂等执行。
- ACK 超时后 Master 可重试或切换 fallback transport。
- Agent 离线时任务保持 `queued` 或进入 `failed`，不得伪造成功。
- Agent 重连后必须携带 `lastSeenCommandSeq`；Master 会立即补发同一 `sessionId` 下仍未 ACK、且 `seq` 大于 Agent 已见序号的 dispatched 命令，不等待 lease 过期。
- 所有命令和事件都有 monotonic `seq`、`sentAt`、`agentId`、`sessionId`。
- command outbox 到达 `completed`、`failed`、`expired` 或 `dead_letter` 后不得被后续 ACK/result 覆盖；乱序或重试事件可以进入 Agent event 留痕，但不能回滚 outbox 终态、task 状态或 runtime deployment proof。
- ACK/result/log 事件的 `commandId`、`taskId` 和 `agentId` 必须同时匹配 command outbox 记录；错绑事件返回 `agent_event.command_task_mismatch`，不得写入 Agent event、更新 outbox 或推进 task。
- Agent 本地 pending event 队列只对网络、服务暂时不可用和其它可重试错误保留重试；Master 明确返回的 command deadline 过期、event seq 回放或 command/task 错绑冲突必须从 pending 队列移除，避免旧事件阻塞后续上报。ACK 如果被 Master 判定为过期命令，Agent 必须跳过该 command，不得继续执行 stale runtime apply。批量事件上报中，单条 stale event 或错绑事件进入 `rejected` 计数，不得阻断同一批次后续有效事件。

Service-backed V1 slice implemented in code:

- `POST /agent/v1/register` exchanges a one-time install token for a persisted `purpose: runtime` Agent credential.
- Successful registration projects the host into `GET /api/v1/agents` as `provisioning` with non-sensitive version, platform, and capability metadata until heartbeat or telemetry proves liveness. The GitHub installer submits its install profile as registration `capabilities` so the read model reflects what the Agent actually enrolled to run.
- Runtime credential issuance during registration appends `agent.credential.issued` to the audit ledger with sanitized credential summaries only.
- Failed registration caused by a missing, invalid, expired, or identity-mismatched install token appends `audit.denied` with sanitized registration evidence only.
- Install credentials are revoked after redemption; poll/events use runtime credentials only in the service-backed control plane.
- Runtime credentials are bound to the registered `sessionId`; poll/events/self-rotation requests with a missing or different session are rejected with `identity.mismatch`.
- `POST /agent/v1/credentials/rotate` lets an authenticated Agent rotate its own active runtime credential before expiry, writes `agent.credential.rotated`, atomically replaces the token in the installed Agent env, and never reuses the redeemed install token.
- Poll/events/self-rotation authentication failures and Agent/session identity mismatches append `audit.denied` with sanitized endpoint, Agent/session, and credential summaries only.
- Operator bearer authentication failures on protected REST, SSE, and Prometheus routes append `audit.denied` with sanitized method/path evidence only; repeated failures from the same source are throttled and return `429 operator_auth.rate_limited` after the configured window limit. Denied-audit write failures must not replace the original auth response; they are surfaced through structured logs and observability metrics.
- `GET /api/v1/agent-credentials` exposes sanitized credential inventory for operators without raw token material or token hashes.
- `POST /api/v1/agent-credentials/{credentialId}/revoke` revokes install/runtime credentials and appends `agent.credential.revoked` to the audit ledger.
- `POST /agent/v1/credentials/rotate` accepts `agentId`, `requestId`, optional `sessionId`, and optional reason from the authenticated Agent.
- `POST /agent/v1/poll` accepts `sessionId` and `lastSeenCommandSeq`.
- Leased commands are returned with the polling `sessionId` bound into `AgentCommandEnvelope.sessionId`.
- Reconnecting polls replay same-session dispatched commands whose `seq` is newer than `lastSeenCommandSeq` while the command is still unacknowledged; acknowledged or terminal commands are not replayed through this path.
- Leased command outbox entries expose `leaseOwnerId` and `leaseSessionId`; authenticated poll uses the Agent credential ID as owner and never exposes runtime token material.
- The control-plane repository records Agent session liveness/progress for poll and heartbeat traffic; protected `GET /api/v1/agent-sessions` exposes sanitized `agentId`, `sessionId`, liveness status, `lastSeq`, `lastSeenCommandSeq`, heartbeat time, version, and capabilities for operator diagnostics without raw token material.
- `POST /agent/v1/events` persists events, deduplicates by `eventId`, rejects stale `seq` values inside the same `agentId + sessionId` window, and rejects command-scoped events whose `taskId` / `commandId` / `agentId` do not match the command outbox record.

### 3.2 Master -> Agent 命令

统一 command envelope：

```json
{
  "type": "apply",
  "commandId": "cmd_01HY...",
  "taskId": "task_01HY...",
  "agentId": "agent-hkg-01",
  "seq": 42,
  "requestId": "req_01HY...",
  "issuedAt": "2026-06-02T00:00:00Z",
  "deadlineAt": "2026-06-02T00:05:00Z",
  "payload": {}
}
```

#### `apply`

用于应用 runtime 配置或模块变更。

payload 必须包含：

- `configRevision`：Master 编译出的不可变配置版本。
- `moduleKind`：`xray`、`gost`、`flvx`、`bbr` 或未来 module kind。
- `artifactUri` 或内联加密 payload。
- `checksum` 与 `signature`。
- `preflightPlanId`。
- `snapshotBeforeId`。
- `applyMode`：`hot_reload`、`graceful_restart`、`staged_only`。

Agent 必须先校验 checksum/signature，再执行 preflight。

#### `rollback`

用于回滚到 Master 指定 snapshot。

payload 必须包含：

- `snapshotId`
- `targetConfigRevision`
- `rollbackReason`
- `rollbackMode`：`hot_reload` 或 `graceful_restart`

Agent 必须确认 snapshot 存在且 checksum 匹配。

#### `reload`

用于对指定 runtime module 执行 reload，不改变 intent。

payload 必须包含：

- `moduleKind`
- `moduleId`
- `configRevision`
- `reloadMode`

Agent 必须回报 reload 后 health check 结果。

#### `health`

用于即时健康探测。

payload 可以包含：

- `checks`：`process`、`port_bind`、`config_version`、`module_api`、`traffic_counter`。
- `timeoutMs`

#### `telemetry`

用于调整 telemetry 上报策略。

payload 可以包含：

- `intervalSeconds`
- `includeRuntimeCounters`
- `includeFlowSamples`
- `scope`

### 3.3 Agent -> Master 事件

统一 event envelope：

```json
{
  "type": "ack",
  "eventId": "evt_01HY...",
  "commandId": "cmd_01HY...",
  "taskId": "task_01HY...",
  "agentId": "agent-hkg-01",
  "seq": 43,
  "sessionId": "sess_01HY...",
  "observedAt": "2026-06-02T00:00:02Z",
  "payload": {}
}
```

#### `ACK`

Agent 收到命令后必须快速 ACK：

- 正常情况 5 秒内 ACK。
- ACK 表示已接收并通过基础校验，不表示任务成功。
- 如果命令重复，返回同一 `commandId` 的 `duplicate: true`。

#### `heartbeat`

默认 10 到 30 秒上报一次，包含：

- agent version、uptime、platform、capabilities。
- current modules、config revisions。
- CPU、memory、load、disk、network。
- last command seq、last result status。

#### `result`

命令完成后上报：

- `status`：`succeeded`、`failed`、`rolled_back`。
- `appliedConfigRevision`。
- `healthSummary`。
- `changedFiles` 和 runtime reload outcome。
- `failureReason`、`exitCode`、`retryable`。

Master 只有在 result 通过服务端验证后，才能将 task 置为 `succeeded`。
如果同一 command 已经进入终态，后续 result 只能作为 Agent event 留痕，不得重新驱动任务状态转换。

#### `log_chunk`

用于长任务日志：

- `chunkSeq` 从 1 递增。
- 每片建议小于 64 KiB。
- 必须带 `stream`：`stdout`、`stderr`、`agent`、`runtime`。
- Master 按 taskId + commandId + chunkSeq 去重。

#### `telemetry_sample`

用于实时流量、速率和 runtime counters：

- Agent 负责采样。
- Master 负责聚合、配额判定和审计。
- 采样丢失不得影响审计完整性，但会影响指标精度，需标记 gap；Agent 在 Master 短暂不可达时应先写入本地 pending 队列并在后续 poll 前重试。

## 4. Runtime Module Lifecycle

### 4.1 通用生命周期

每次运行时变更必须走以下阶段：

1. Intent：UI 或 API 提交业务意图，例如新增 inbound、修改 forward rule、重置 quota、注入 kernel tuning。
2. Authorize：Master 检查 actor、operator group、resource group、permission 和资源版本。
3. Compile：compiler 生成 module-specific 配置、diff、checksum、preflight plan 和 snapshot plan。
4. Preflight：Master 静态校验，Agent 节点侧动态校验。
5. Snapshot：保存变更前 runtime config、module version、关键系统状态和 checksum。
6. Apply staged：Agent 写入临时配置，不覆盖最后成功配置。
7. Reload：按 module 能力选择 hot reload 或 graceful restart。
8. Verify：端口、进程、module API、配置版本、业务探测和基础流量计数检查。
9. Commit：标记 snapshot 和 config revision 为 active，task `succeeded`，写审计。
10. Rollback：任一关键步骤失败时按策略回滚，生成 result 和审计。

### 4.2 Xray lifecycle

Compile：

- 将 `XrayInbound`、client、stream settings、TLS、Reality、fallback、sniffing、IP limit、traffic limit、expiry 编译为 Xray JSON。
- 按 inbound/client 生成稳定 ID，避免 reload 后统计归属丢失。
- 校验协议组合，例如 Reality/TLS/fallback 与 network 的兼容性。

Preflight：

- 运行 Xray config check。
- 检查 listen address、port、certificate、Reality key、fallback target。
- 检查 client limit、过期时间、流量限制和 IP 限制是否可由 runtime 或旁路计数器执行。

Reload：

- 若当前 Xray adapter 支持 hot reload，则调用 module API 或受控 reload。
- 不支持时执行 graceful restart，并在 task 中标记短暂连接影响。

Rollback：

- 恢复上一份 Xray config revision。
- 验证版本、端口和核心 inbound 可用。

### 4.3 GOST lifecycle

Compile：

- 将 relay、listener、chain、transport、TCP/UDP、认证和限速策略编译为 GOST YAML/JSON。
- 对端口绑定和转发链路生成 diff。

Preflight：

- 检查本地端口冲突、UDP 支持、防火墙策略、目标地址解析。
- 校验链路中间节点是否属于允许 resource group。

Reload：

- 优先 hot reload。
- 不可热重载时按 listener 粒度 graceful restart，避免全局中断。

Rollback：

- 恢复上一份 GOST 配置。
- 回收失败 apply 产生的临时 listener 和转发表项。

### 4.4 Port-forwarding lifecycle

Compile：

- 将 tunnel account、forward rule、TCP/UDP port binding、rate limit、quota policy、billing direction、operator/resource group 权限编译为 port-forwarding runtime 配置。
- 支持批量操作，编译结果必须包含每条 rule 的 diff 和冲突检测结果。

Preflight：

- 检查端口占用、target reachability、账号状态、quota policy、rate limit policy。
- 检查双向计费所需 ingress/egress counter 是否可采样。
- 检查分组权限，防止 operator 对未授权 tunnel group 下发转发规则。

Reload：

- 支持按 tunnel 或 forward rule 粒度热更新。
- 批量更新必须支持部分失败报告，但同一个 resource group 内的原子批次应全部成功或回滚。

Rollback：

- 恢复 tunnel account、forward rule、rate limit 和 quota enforcement 状态。
- 对已建立但不应保留的临时端口绑定执行 cleanup。

### 4.5 Kernel tuning lifecycle

Kernel tuning 包含 BBR、sysctl、ulimit、nftables/iptables、防火墙和网络队列等主机级变更，风险高于普通 runtime reload。

Compile：

- 生成主机级 change plan，不允许从 UI 直接提交任意 shell。
- 每个 tuning item 必须有 allowlist、当前值读取方式、目标值和 rollback 值。

Preflight：

- 检查 OS、kernel version、权限、容器/虚拟化限制、命令可用性。
- dry-run 可用时必须 dry-run。

Apply：

- 仅 privileged Agent adapter 可执行。
- 变更必须逐项执行，并在每项后记录 before/after。
- 不声明 hot reload；只声明是否立即生效、是否需要重启。

Rollback：

- 恢复原 sysctl/firewall/limit 值。
- 如果 rollback 不完整，必须将 task 标记 `failed`，写 `critical` 审计。

## 5. 权限 / 配额 / 审计闭环

### 5.1 角色与分组模型

生产模型必须区分：

- `operator`：实际操作者账号。
- `operator group`：操作者所属权限组，例如 owner、admin、ops-hkg、tenant-a-operator。
- `resource group`：资源集合，例如 agent group、node group、tunnel group、subscription group。
- `permission grant`：operator group 或 user 到 resource group 的权限授予。
- `tenant`：可选隔离单元，用于多租户和面板联邦。

基础权限与当前 domain 对齐：

- `read`：查看资源、任务和可见审计。
- `operate`：启动/暂停/reload/同步/生成等非结构性操作。
- `configure`：创建、修改、删除配置或策略。
- `grant`：授予或撤销权限。

### 5.2 `permission.grant` / `permission.revoke`

权限变更必须也是任务：

```text
request -> authn -> can_grant check -> create task -> audit task.created
        -> persist grant/revoke -> audit task.succeeded
```

要求：

- 只有拥有目标 resource group `grant` 权限的 operator group 可以授权。
- 不允许 operator 授予自己不具备的权限。
- 授权判定必须同时匹配 `resourceType` 与 `resourceId`，并且忽略已撤销、已过期或时间格式异常的 permission grant。
- `permission.revoke` 必须检查是否会移除最后一个 owner/grant 管理路径。
- 权限变更必须包含 before/after、expiresAt、reason、requestId。
- 对 Agent 或 Runtime 的实际配置影响必须通过后续 task 下发，不允许修改权限时直接静默改运行时。

### 5.3 Quota enforcement

Quota 决策属于 Master，执行可以落在 Agent/runtime。

数据闭环：

```text
Agent traffic counters -> Master quota aggregator -> quota decision
-> enforcement task -> Agent apply/reload -> audit result
```

要求：

- 支持 scope：user、managed-host、customer-node、forwarding-account、tunnel、forward-rule。
- 支持 billing direction：ingress、egress、both。
- 支持 one-way 与 bi-directional rate limit。
- 支持 reset window：daily、monthly、manual。
- 支持 enforcement state：active、exceeded、disabled_by_quota、reset_pending。
- 超额后可执行限速、暂停 forward rule、禁用 Xray client、暂停 tunnel account。
- 所有自动 enforcement 必须创建系统 actor task，例如 `system:quota-enforcer`。
- quota reset 必须产生 `quota.reset` task 和审计。
- 指标采样延迟必须可见，不能把未采样视为未使用。

### 5.4 Operator group 与 resource group 判定

每次 mutation 的授权顺序：

1. 验证 operator 身份。
2. 解析 operator group。
3. 解析目标 resource group。
4. 检查目标 operation 需要的 permission。
5. 检查资源版本和幂等 requestId。
6. 检查 quota/rate/policy guardrail。
7. 创建 task 与 audit。
8. 进入 compiler 和 command channel。

典型 operation 映射：

| Operation | 最低权限 | 备注 |
| --- | --- | --- |
| `agent.deploy` | `configure` on agent group | 需要高危确认和 rollback snapshot |
| `agent.rollback` | `operate` on agent group | 只能回滚到可见 snapshot |
| `config.compile` | `configure` on target resource group | compile 可产生 diff，但不应修改 runtime |
| `config.apply` | `configure` on target resource group | 必须进入 Agent apply |
| `runtime.reload` | `operate` on module/node group | 不改变 intent |
| `forward.apply` | `configure` on tunnel group | 同时检查端口和 quota |
| `subscription.generate` | `operate` on subscription group | token 独立限速 |
| `quota.reset` | `configure` on quota scope | 需要审计 before/after |
| `permission.grant` | `grant` on resource group | 不允许越权授权 |
| `permission.revoke` | `grant` on resource group | 防止锁死管理路径，且需要高风险确认 |

### 5.5 审计闭环

每个动作至少产生以下审计之一：

- `audit.denied`：认证、Agent 注册拒绝、权限、幂等冲突、资源版本冲突、高风险确认缺失/不匹配、quota guardrail 拒绝。
- `task.created`：请求被接受。
- `task.running`：后端或 Agent 已开始执行。
- `task.succeeded`：目标状态已验证。
- `task.failed`：执行失败。
- `task.rolled_back`：已回滚。

审计字段要求：

- `actor` 和 `operatorGroupId`
- `scope` 和 `resourceGroupId`
- `resourceType`、`resourceId`、`targetId`
- `operation`
- `requestId`
- `taskId`
- `sourceIp`、`userAgent`
- `before`、`after`
- `result`
- `severity`
- `createdAt`
- `prevHash`、`hash` 或等价完整性字段

## 6. 生产验收清单

### 6.1 API 与兼容性

- [ ] 所有生产 endpoint 使用 `/api/v1`、`/events/v1`、`/agent/v1` 或 `ouui.controlplane.v1`。
- [ ] mutation endpoint 必须要求 `X-Request-Id`，并通过幂等记录验证重放行为。
- [ ] 所有 mutation 返回 `taskId`，UI 不需要猜测状态。
- [ ] REST、SSE/WebSocket、Agent event 的 schema 有自动化契约测试。
- [ ] V1 字段变更有兼容性测试和废弃策略。

### 6.2 安全与权限

- [ ] Operator session 使用 HttpOnly secure cookie 或受控 Bearer token；当前已具备签名 cookie、Nginx session gate、CSRF、服务端撤销和会话生命周期审计，后续仍需 MFA/OIDC、持久用户和外部身份集成。
- [ ] Agent 使用 registration token + mTLS 或短周期签名 identity。
- [ ] RBAC 同时校验 operator group 和 resource group。
- [ ] `permission.grant` / `permission.revoke` 经过 task/audit，不允许静默变更。
- [ ] 拒绝请求写入 `audit.denied`，包括 Operator 受保护接口认证失败、Agent 注册缺失/无效/过期 install token、poll/events 认证失败和身份不匹配；Operator 受保护接口重复认证失败必须进入 429 节流并避免无界审计追加。
- [ ] 高危操作支持二次确认、超时、回滚和审计 reason。

### 6.3 任务与审计

- [ ] `queued`、`running`、`retrying`、`succeeded`、`failed`、`rolled_back`、`canceled` 状态转换有测试。
- [ ] task 创建与 `task.created` 审计在同一事务中完成。
- [ ] command dispatch 使用 outbox pattern。
- [ ] audit append-only，有完整 before/after、requestId、sourceIp、operator group、resource group。
- [ ] 审计导出可验证完整性，配置外部归档目录时每条新审计会写入脱敏 hash anchor。

### 6.4 Agent 通道

- [ ] WebSocket 或 gRPC bidirectional stream 支持 ACK、heartbeat、result、log chunk。
- [ ] HTTP pull fallback 可用。
- [ ] commandId 幂等，Agent 重连可补发未完成命令。
- [ ] command outbox 终态不会被 late ACK/result 重试覆盖。
- [ ] Agent pending event 队列会丢弃不可重试 stale event 冲突并继续 flush 后续事件。
- [ ] 批量 Agent event ingest 会把 stale event 冲突计为 rejected，并继续处理同批后续有效事件。
- [ ] ACK 超时、heartbeat 丢失、result 失败均能进入明确 task 状态。
- [x] Agent 日志分片有顺序号、大小限制和去重；`chunkSeq` 递增、payload 小于后端 64 KiB 合同上限，Master 按 Agent / task / command / `chunkSeq` 对 retained log read model 去重。

### 6.5 Runtime lifecycle

- [ ] Xray config compile、config check、port/cert/Reality preflight、reload、rollback 已自动化测试。
- [ ] GOST listener/chain/TCP/UDP preflight、reload、cleanup 已自动化测试。
- [ ] Port-forwarding tunnel/forward/rate/quota/billing direction/batch apply/partial failure 已自动化测试。
- [ ] Kernel tuning 使用 allowlist plan，不接受任意 shell。
- [ ] 所有 runtime apply 前保存 snapshot，失败时能恢复最后成功配置。
- [ ] Master 验证 Agent result 后才把 task 标记成功。

### 6.6 配额与流量

- [ ] Agent 上报 ingress/egress counters，Master 聚合并标记采样 gap，保留可筛选/导出且受留存策略约束的 traffic rollup 历史，被留存策略剪枝的 raw 样本会压缩为可查询/导出的日级 compaction，系统总览页会展示当前维度的压缩归档摘要并支持导出，并通过 observability/Prometheus 暴露 retained 与压缩归档存储压力。
- [x] user、forwarding-account、tunnel、forward-rule 与 customer-node scope 都可 enforcement；managed-host scope 由 Agent host guardrail 处置。
- [ ] one-way 与 bi-directional billing/rate limit 均有测试。
- [ ] 超额自动处理会创建系统 task，并可回滚或恢复。
- [ ] quota reset 写 before/after 审计。

### 6.7 可观测与运维

- [ ] 有 metrics、structured logs、traceId/requestId/taskId 贯穿链路。
- [ ] 有 Agent version、module version、config revision、snapshot inventory 页面/API。
- [ ] 有 command latency、ACK latency、按 operation/module 拆分的 runtime apply latency、reload duration、rollback count 指标。
- [ ] 有数据库迁移、备份、恢复演练。
- [ ] 有灰度发布和 Agent 版本兼容矩阵。
- [ ] 有生产告警：Agent offline、reload failed、quota exceeded、audit write failed、system alert notification delivery overdue/dead-letter 与 command outbox overdue/dead-letter 已进入系统告警 lifecycle；更完整外部告警路由仍需补齐。

### 6.8 Mock 替换验收

- [ ] 前端 `ControlPlaneApi` 可以从 Mock adapter 切换到真实 API client。
- [ ] Mock 中的 `DeployTask`、`AuditLog`、`Agent`、`ManagedNode`、`RuntimeModule` 字段在真实 API 中有兼容响应。
- [ ] 真实 API 明确补齐 Mock 未覆盖的 auth、idempotency、task persistence、agent channel、runtime lifecycle、quota enforcement。
- [ ] UI 中所有高风险按钮仍然只创建任务，不直接假设操作成功。

## 7. V1.0 最小上线口径

V1.0 可以分阶段上线，但生产口径必须至少满足：

- 真实认证和 RBAC 已启用。
- task/audit 持久化和幂等 requestId 已启用。
- Agent 命令通道可执行 `health`、`telemetry`、`apply`、`rollback`、`reload`；未知命令必须失败回传，不允许默认成功。
- 至少一个 runtime module 完成端到端 compile -> preflight -> apply -> reload -> verify -> rollback。
- Xray/GOST/port-forwarding 中未真实接入的模块必须在 UI 和 API 中标记为 preview，不得显示为已执行成功。
- Quota 和 permission 的后端 enforcement 已启用，UI 只作为展示和 intent 提交入口。
