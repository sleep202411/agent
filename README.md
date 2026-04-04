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
deploy/
  nginx.conf      Nginx 配置模板
  setup-ecs.sh    ECS 初始化脚本
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
# Java Backend
JAVA_CONTENT_URL=http://120.26.152.164:8090
JAVA_STUDIO_URL=http://120.26.152.164:8090

# NestJS Server
SERVER_URL=http://localhost:3001

# OSS
NEXT_PUBLIC_OSS_BASE_URL=https://fizzspace-test.oss-cn-hangzhou.aliyuncs.com
```

### Server (`apps/server/.env`)

```bash
WORKSPACE_API_URL=http://120.26.152.164:8090
AI_GATEWAY_API_KEY=your-key
# AI_GATEWAY_MODEL=anthropic/claude-sonnet-4
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
# 启动（需要先配置 .env.server）
cp .env.server.example .env.server
# 编辑 .env.server 填入实际值

docker compose up -d
```

## Deployment

### Architecture

```
User → Nginx (443/HTTPS)
         ↓
       Web container (3000)
         ↓ (internal)
       Server container (3001)
         ↓
       Java Backend (8090)
```

### CI/CD

| Trigger           | Action                               |
| ----------------- | ------------------------------------ |
| PR → develop/main | CI 检查（lint + type check + build） |
| Merge → develop   | 自动部署 → 测试环境                  |
| Merge → main      | 自动部署 → 生产环境                  |

Pipeline: Build web + server (parallel) → Push to ACR → SSH deploy to ECS

### GitHub Secrets

| Secret                     | Description                |
| -------------------------- | -------------------------- |
| `ACR_USERNAME`             | 阿里云 ACR 用户名          |
| `ACR_PASSWORD`             | 阿里云 ACR 密码            |
| `DEPLOY_SSH_KEY`           | ECS SSH 私钥               |
| `STAGING_HOST`             | 测试环境 ECS IP            |
| `STAGING_USER`             | 测试环境 ECS 用户          |
| `STAGING_OSS_BASE_URL`     | 测试环境 OSS 地址          |
| `STAGING_JAVA_STUDIO_URL`  | 测试环境 Java Studio 地址  |
| `STAGING_JAVA_CONTENT_URL` | 测试环境 Java Content 地址 |
| `PROD_HOST`                | 生产环境 ECS IP            |
| `PROD_USER`                | 生产环境 ECS 用户          |
| `PROD_OSS_BASE_URL`        | 生产环境 OSS 地址          |
| `PROD_JAVA_STUDIO_URL`     | 生产环境 Java Studio 地址  |
| `PROD_JAVA_CONTENT_URL`    | 生产环境 Java Content 地址 |

### ECS First-Time Setup

```bash
# 上传并执行初始化脚本
scp deploy/setup-ecs.sh user@your-ecs:~/
ssh user@your-ecs bash ~/setup-ecs.sh

# 放置部署文件
scp docker-compose.yml user@your-ecs:~/apps/fizzdragon-platform/
scp .env.server user@your-ecs:~/apps/fizzdragon-platform/

# 配置 Nginx
scp deploy/nginx.conf user@your-ecs:/etc/nginx/conf.d/fizzdragon.conf
# 编辑域名和 SSL 证书路径
sudo nginx -t && sudo systemctl reload nginx
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
