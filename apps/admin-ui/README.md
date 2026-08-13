# FizzDragon Admin UI

内部后台管理台。只服务运营、财务、审核和技术排查，不复用普通用户登录态。

## 本地启动

```bash
npm run dev -w admin-ui
```

默认地址：`http://localhost:9530`

本地默认把站点选择都指向 `http://localhost:4399/admin`，方便开发。
生产环境必须显式配置两套 Admin API，避免国际站和中国站数据混在一起：

```bash
ADMIN_GLOBAL_API_BASE_URL=https://api.fizzdragon.com/admin
ADMIN_CN_API_BASE_URL=https://fizzdragon.fizzspace.cn/admin
TEXT_GAME_API_BASE_URL=https://java.fizzdragon.com/studio
JAVA_ADMIN_API_TOKEN=<Java api.admin.api-token>
```

兼容单站本地开发时也可以只设置 `ADMIN_API_BASE_URL=http://localhost:4399/admin`。

`TEXT_GAME_API_BASE_URL` 指向当前站点的 Java Studio 服务；新闻和文游共用的
`JAVA_ADMIN_API_TOKEN` 必须与 Java 的 `api.admin.api-token` 一致。文游读取只在
Admin UI 服务端发起；审核动作先经过同源 `/api/admin/text-games/{gameId}` 的
后台会话和 `ip.moderate` 权限校验，再携带 `X-Admin-Api-Token` 访问 Java
`/api/admin/text-game/**`。如果 Java 修改了 token header 名，可额外设置
`JAVA_ADMIN_API_TOKEN_HEADER`。

## 登录

登录前先选择目标站点。`fd_admin_site` 记录当前连接站点，`fd_admin_session`
是该站点 Admin API 返回的 HttpOnly 会话。国际站和中国站各自使用自己的
Postgres `admin_users / admin_sessions` 表。

本地开发默认启用免登录，前提是：

- `NODE_ENV !== "production"`；
- Admin API base 指向 `localhost` / `127.0.0.1` / `::1`；
- 后端 `DATABASE_URL` 也指向本地数据库。

这只用于本机开发和 UI 调试；生产环境不会生效。如果需要在本地完整验证登录、
MFA、锁定和审计链路，设置：

```bash
ADMIN_DEV_AUTH_BYPASS=false
```

本地创建管理员账号：

```bash
npm run admin:create-user -w server -- \
  --email admin@example.com \
  --password '<temporary-password>' \
  --name 临时管理员 \
  --site-scope all \
  --role super_admin \
  --require-mfa true
```

也可以使用环境变量：

```bash
ADMIN_CREATE_EMAIL=admin@example.com \
ADMIN_CREATE_PASSWORD='<temporary-password>' \
ADMIN_CREATE_NAME=临时管理员 \
ADMIN_CREATE_ROLE=super_admin \
ADMIN_CREATE_REQUIRE_MFA=true \
npm run admin:create-user -w server
```

## 当前范围

- 登录、退出、会话校验
- 受保护后台布局
- 账号权限：当前站点管理员列表、三角色分配、MFA 要求、账号状态、重置密码、会话治理
- 安全治理：密码策略、登录风控、MFA 首次绑定、登录锁定、审计记录
- 系统审计：登录、MFA、账号、密码和会话操作查询
- IP 内容、审核、订单积分、媒体资产模块入口

具体业务页面会逐步接入 Nest + Postgres 的后台接口。
