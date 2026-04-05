# FizzDragon Platform

Turborepo monorepo for FizzDragon Studio — AI-powered video content creation platform.

## Project Structure

```
apps/
  web/            Next.js 前端（Studio + 主站）
  server/         NestJS 后端（AI Agent + Assistant）
packages/
  ui/             共享 UI 组件
  eslint-config/  ESLint 配置
  typescript-config/  TypeScript 配置
```

## Getting Started

```bash
# 安装依赖
npm install

# 启动所有服务
npm run dev

# 只启动前端
npx turbo dev --filter=web

# 只启动后端
npx turbo dev --filter=server
```

| Service         | URL                   |
| --------------- | --------------------- |
| Web (Next.js)   | http://localhost:3000 |
| Server (NestJS) | http://localhost:3001 |

## Environment Variables

### Web (`apps/web/.env.local`)

```bash
JAVA_CONTENT_URL=http://120.26.152.164:8090
JAVA_STUDIO_URL=http://120.26.152.164:8090
SERVER_URL=http://localhost:3001
NEXT_PUBLIC_OSS_BASE_URL=https://fizzspace-test.oss-cn-hangzhou.aliyuncs.com
```

### Server (`apps/server/.env`)

```bash
ALIBABA_API_KEY=your-key
ALIBABA_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
AI_MODEL=qwen-plus
PORT=3001
```

## Build

```bash
# 构建所有
npm run build

# 单独构建
npx turbo build --filter=web
npx turbo build --filter=server
```

## Docker

### Local Build

```bash
# Web
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=https://fizzspace-test.oss-cn-hangzhou.aliyuncs.com \
  --build-arg SERVER_URL=http://server:3001 \
  --build-arg JAVA_STUDIO_URL=https://test.fizzdragon.com/test2 \
  --build-arg JAVA_CONTENT_URL=https://test.fizzdragon.com/test1 \
  -t fizzdragon/web .

# Server
docker build -f apps/server/Dockerfile -t fizzdragon/server .
```

### Docker Compose

```bash
cp .env.server.example .env.server
# 编辑 .env.server 填入实际值
docker compose up -d
```

## CI/CD

### 流程概览

```
push 到 develop/main
        │
        ▼
┌─── prepare (GitHub 托管) ───────────┐
│ 判断环境:                            │
│   main    → production (prod-cn, prod-com) │
│   develop → staging                  │
└────────────┬────────────────────────┘
             │
       ┌─────┴─────┐
       ▼           ▼
  build-server   build-web (按 target 并行)
  (GitHub 托管)  (GitHub 托管)
  构建镜像 →     构建镜像 →
  push ghcr.io   push ghcr.io
       │           │
       └─────┬─────┘
             ▼
┌─── deploy (self-hosted runner) ─────┐
│ checkout 代码                        │
│ login ghcr.io                        │
│ 写 .env + .env.server               │
│ docker compose pull                  │
│ docker compose up -d                 │
└──────────────────────────────────────┘
```

### 触发规则

| 触发条件          | 动作                                 |
| ----------------- | ------------------------------------ |
| PR → develop/main | CI 检查（lint + type check + build） |
| push → develop    | 自动部署 → staging                   |
| push → main       | 自动部署 → production                |
| workflow_dispatch | 手动选择 staging/production          |

### 镜像策略

- 镜像仓库: `ghcr.io/fizzdragon-pte-ltd-2`
- 使用固定 tag（`staging` / `prod`），每次构建覆盖，不累积旧版本
- Server 镜像: `studio-server:{staging|prod}`
- Web 镜像: `studio-web:{staging|prod-cn|prod-com}`

### Self-hosted Runner

部署阶段通过 self-hosted runner 在目标服务器本地执行，不需要 GitHub SSH 到服务器。

**安装 Runner（首次）：**

```bash
mkdir actions-runner && cd actions-runner
# 下载 runner（去 GitHub → Settings → Actions → Runners → New 获取命令）
tar xzf actions-runner-linux-x64-*.tar.gz
./config.sh --url https://github.com/Fizzdragon-Pte-Ltd-2 --token <TOKEN>

# 安装为系统服务
sudo ./svc.sh install
sudo ./svc.sh start
```

### GitHub Environment Secrets

每个 environment（staging / prod-cn / prod-com）需要配置以下 secrets：

| Secret             | 说明          |
| ------------------ | ------------- |
| `ALIBABA_API_KEY`  | 千问 API Key  |
| `ALIBABA_BASE_URL` | 千问 API 地址 |

**千问 API 地址按区域区分：**

| Environment        | ALIBABA_BASE_URL                                                   |
| ------------------ | ------------------------------------------------------------------ |
| staging / prod-com | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`（新加坡） |
| prod-cn            | `https://dashscope.aliyuncs.com/compatible-mode/v1`（中国大陆）    |

### GitHub Environment Variables

每个 environment 需要配置以下 variables（非敏感信息）：

| Variable           | 说明                  |
| ------------------ | --------------------- |
| `JAVA_STUDIO_URL`  | Java Studio 后端地址  |
| `JAVA_CONTENT_URL` | Java Content 后端地址 |
| `OSS_BASE_URL`     | OSS 存储地址          |

## Architecture

```
User → Nginx (443/HTTPS)
         ↓
       Web container (3000)
         ↓ (internal)
       Server container (3001)
         ↓
       Java Backend (8090)
```

## Branch Strategy

```
main              ← Production, merge via PR only
  ↑
develop           ← Staging, daily development
  ↑
feature/*         ← Feature branches, PR to develop
hotfix/*          ← Hotfixes, PR to main + develop
```
