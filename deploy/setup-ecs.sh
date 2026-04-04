#!/bin/bash
# ECS 首次部署初始化脚本
# 用法: scp 到 ECS 后执行 bash setup-ecs.sh

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
echo "4. 之后 GitHub Actions 会自动完成部署"
