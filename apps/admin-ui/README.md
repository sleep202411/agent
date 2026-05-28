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
```

兼容单站本地开发时也可以只设置 `ADMIN_API_BASE_URL=http://localhost:4399/admin`。

## 登录

登录前先选择目标站点。`fd_admin_site` 记录当前连接站点，`fd_admin_session`
是该站点 Admin API 返回的 HttpOnly 会话。国际站和中国站各自使用自己的
Postgres `admin_users / admin_sessions` 表。

本地创建管理员账号：

```bash
npm run admin:create-user -w server -- \
  --email 505421473@qq.com \
  --password 'Violet#7291Secure' \
  --name 临时管理员 \
  --site-scope all \
  --role super_admin \
  --require-mfa true
```

也可以使用环境变量：

```bash
ADMIN_CREATE_EMAIL=505421473@qq.com \
ADMIN_CREATE_PASSWORD='Violet#7291Secure' \
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
