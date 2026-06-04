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
  - 应用外壳、导航、仪表盘、节点、转发、订阅、路由、安全、调优、执行记录与审计等界面
- **类型化 Control Plane 契约**
  - OpenAPI 规范：[docs/openapi/ou-ui-next-v1.yaml](docs/openapi/ou-ui-next-v1.yaml)
  - Zod 请求校验与统一 API 响应封装
- **服务化 HTTP Control Plane**
  - 本地后端入口：`src/server/control-plane/http-control-plane-main.ts`
  - 围绕执行记录、审计、幂等、outbox、运行时发布模型和权限持久化建立服务/仓储边界
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

状态检查分两层：`ou s` 只查看 systemd 服务状态，`ou d` 会执行完整安装诊断，包含 Nginx、Basic Auth、面板地址、服务状态和控制面状态文件。
卸载前请先确认是否需要备份数据；`ou x` / `ou-ui uninstall` 会删除安装目录、配置目录、状态目录、Web 静态目录、Nginx 站点和 systemd 服务。
使用 `OU_UI_LOCAL_SOURCE_DIR` 的本地源码部署只建议开发调试；生产更新应使用 GitHub 安装路径，这样 `ou u` / `ou f` 才能直接从远端拉取最新版本。
主机代理安装完成后也会提供 `ou-agent` 快捷入口：`ou-agent` 打开菜单，`ou-agent status` 查看状态，`ou-agent update` 从 GitHub 更新 Agent 运行时且不会重新注册、不消耗新的安装 Token，`ou-agent uninstall` 卸载该主机代理。

更短的快捷入口也会自动安装：`ou p` 打印面板信息，`ou c` 打印登录信息，`ou rs` 重启服务，`ou u` 从 GitHub 更新，`ou f` 一键修复安装异常，`ou r` 重置控制面状态，`ou m` 修改端口/证书，`ou d` 运行安装诊断，`ou x` 卸载面板。

其中 `ou-ui credentials` / `ou c` 会打印完整面板地址、登录账号和登录密码；`ou-ui doctor` / `ou d` 会检查 Nginx、Basic Auth、服务状态和控制面状态文件；`ou-ui fix` / `ou f` 会从 GitHub 更新源码、重建前端、刷新快捷命令、重启服务、重写 OU-UI 面板 Nginx 站点并运行 Basic Auth 自检，刚安装后如果看到旧假数据可运行 `ou fix --force` 自动清理控制面旧状态；`ou-ui repair-nginx` 会在不重建前端的情况下重新写入面板 Nginx 配置；`ou-ui reconfigure` / `ou m` 会重新打开安装向导，用于修改端口、证书和 Nginx 配置；`ou-ui reset-state` / `ou r` 用于刚安装后清除旧状态/旧假数据。`ou-ui` 与 `ouui` 也会作为等价快捷命令安装。

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
  - 生成用于后端代理链路的 operator token
  - 从 GitHub 同步最新 Master 源码
  - 部署 nginx、systemd 服务与持久化 Control Plane 状态目录
  - 在安装结束时打印最终访问地址和凭据

### 🛡️ 零配置取向

安装脚本的设计取向是“少问问题，多自动化”：

- 面板入口由随机安全路径与前端登录页共同保护，不应弹出浏览器 Basic Auth 认证框
- 安装脚本会在部署结束后自检面板 URL，确认返回的是 OU-UI Next 前端登录页，并且没有浏览器系统认证框
- 默认推荐使用 `8443` / `9443` 等独立面板端口；如果手动选择 `443`，脚本会要求二次确认
- 如果打开面板时弹出浏览器系统账号密码框，通常说明当前端口/域名命中了其它 Nginx 站点；优先运行 `ou d` 查看冲突配置，重新安装时建议选择 `8443` / `9443` 等独立端口，避免与已有 443 服务冲突
- 如果刚安装后发现前端不是最新版本、旧演示节点仍然出现、快捷命令缺失、或面板地址仍返回 Basic Auth，直接运行 `ou fix --force`；它会更新到 GitHub 最新代码、重写 Nginx 面板站点、清理旧控制面状态，并确认受控主机库存回到空状态
- API 请求通过 nginx 代理到后端，并在反代层注入后端 operator token；operator token 不写入前端构建产物，避免浏览器侧泄露
- Agent 一键安装命令默认从 GitHub raw 拉取 `public/install/ou-agent.sh`，避免依赖 Master 本地静态文件或被面板登录保护拦截
- 新安装的生产面板默认不注入演示节点；受控主机只有在 Agent 完成注册后才会出现
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
