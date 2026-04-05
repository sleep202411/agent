#!/bin/bash
# ECS 首次部署初始化脚本
# 用法: scp 到 ECS 后执行 bash setup-ecs.sh
#
# 每台服务器执行一次即可，之后由 GitHub Actions 自动部署。
# 需要准备：
#   - staging 服务器:       WEB_TAG=staging,  SERVER_TAG=staging
#   - production .cn 服务器: WEB_TAG=prod-cn,  SERVER_TAG=prod
#   - production .com 服务器: WEB_TAG=prod-com, SERVER_TAG=prod

set -e

DEPLOY_DIR=~/apps/fizzdragon-platform
REGISTRY=${REGISTRY:-registry.cn-hangzhou.aliyuncs.com}

echo "=== 1. 安装 Docker ==="
if ! command -v docker &> /dev/null; then
  sudo dnf install -y docker-ce || sudo dnf install -y docker
  sudo systemctl start docker 2>/dev/null || true
  sudo systemctl enable docker 2>/dev/null || true
fi
docker --version || podman --version

echo "=== 2. 安装 Docker Compose ==="
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
  sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
fi

echo "=== 3. 创建部署目录 ==="
mkdir -p "$DEPLOY_DIR"

echo "=== 4. 登录 ACR ==="
echo "请输入 ACR 密码："
docker login "$REGISTRY"

echo "=== 5. 完成 ==="
echo ""
echo "接下来请手动操作："
echo "1. 将 docker-compose.yml 放到 $DEPLOY_DIR/"
echo "2. 将 .env.server 放到 $DEPLOY_DIR/ 并填入实际配置"
echo "3. 将 deploy/nginx.conf 复制到 /etc/nginx/conf.d/ 并修改域名和证书路径"
echo "4. GitHub Actions 部署时会自动生成 .env（包含 REGISTRY, WEB_TAG, SERVER_TAG）"
echo ""
echo "环境标签对照："
echo "  staging:         WEB_TAG=staging   SERVER_TAG=staging"
echo "  production .cn:  WEB_TAG=prod-cn   SERVER_TAG=prod"
echo "  production .com: WEB_TAG=prod-com  SERVER_TAG=prod"
