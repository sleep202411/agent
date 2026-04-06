# Fizzdragon Platform 生产环境部署指南

## 服务器信息

- 系统：Alibaba Cloud Linux 3.2104 U10 (Pro Edition)
- 架构：x86_64
- 包管理器：dnf / yum

---

## 一、安装基础软件

### 1. 安装 Docker

```bash
# 添加 Docker CE 官方源
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# 安装 libcgroup 依赖（阿里云系统默认没有）
rpm -ivh https://vault.centos.org/centos/8-stream/BaseOS/x86_64/os/Packages/libcgroup-0.41-19.el8.x86_64.rpm

# 安装 Docker
dnf install -y docker-ce docker-ce-cli containerd.io

# 启动并设为开机自启
systemctl enable --now docker

# 验证
docker --version
```

### 2. 安装 Nginx

```bash
# 添加 nginx 官方源
cat > /etc/yum.repos.d/nginx.repo << 'EOF'
[nginx-stable]
name=nginx stable repo
baseurl=http://nginx.org/packages/centos/8/x86_64/
gpgcheck=0
enabled=1
EOF

# 安装
dnf install -y nginx

# 启动并设为开机自启
systemctl enable --now nginx

# 验证
nginx -v
```

---

## 二、配置 HTTPS 证书

### 1. 创建证书目录

```bash
mkdir -p /etc/nginx/ssl
```

### 2. 上传证书文件

从本地上传 `.key` 和 `.pem` 文件到服务器：

```bash
# .com 域名
scp fizzstudio.fizzspace.com.key fizzstudio.fizzspace.com.pem root@<服务器IP>:/etc/nginx/ssl/

# .cn 域名
scp fizzstudio.fizzspace.cn.key fizzstudio.fizzspace.cn.pem root@<服务器IP>:/etc/nginx/ssl/
```

### 3. 上传 nginx 配置

```bash
scp deploy/nginx/fizzstudio.conf root@<服务器IP>:/etc/nginx/conf.d/fizzstudio.conf
```

### 4. 验证并重载 nginx

```bash
nginx -t && systemctl reload nginx
```

---

## 三、Nginx 配置说明

配置文件路径：`/etc/nginx/conf.d/fizzstudio.conf`

功能：

- HTTP (80) → 自动 301 跳转到 HTTPS
- HTTPS (443) → 反向代理到 `127.0.0.1:3000`（Next.js 应用）

如需部署 .cn 域名，复制配置并替换：

- `server_name` → 对应域名
- `ssl_certificate` → 对应 .pem 文件路径
- `ssl_certificate_key` → 对应 .key 文件路径

---

## 四、部署应用（Docker）

### 1. 构建镜像

```bash
# 在项目根目录
docker build -t fizzdragon-platform -f apps/web/Dockerfile .
```

### 2. 运行容器

```bash
docker run -d \
  --name fizzdragon-web \
  --restart always \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e NEXT_PUBLIC_OSS_BASE_URL=<你的OSS地址> \
  -e SERVER_URL=<NestJS后端地址> \
  fizzdragon-platform
```

### 3. 查看日志

```bash
docker logs -f fizzdragon-web
```

### 4. 更新部署

```bash
# 构建新镜像
docker build -t fizzdragon-platform -f apps/web/Dockerfile .

# 替换容器
docker stop fizzdragon-web && docker rm fizzdragon-web

docker run -d \
  --name fizzdragon-web \
  --restart always \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e NEXT_PUBLIC_OSS_BASE_URL=<你的OSS地址> \
  -e SERVER_URL=<NestJS后端地址> \
  fizzdragon-platform
```

---

## 五、防火墙 / 安全组

确保阿里云安全组开放以下端口：

| 端口 | 用途               |
| ---- | ------------------ |
| 22   | SSH                |
| 80   | HTTP（跳转 HTTPS） |
| 443  | HTTPS              |
| 8443 | OpenVPN（如已有）  |

---

## 六、常用运维命令

```bash
# 查看容器状态
docker ps

# 查看 nginx 状态
systemctl status nginx

# 重载 nginx 配置（改配置后）
nginx -t && systemctl reload nginx

# 查看端口占用
ss -tlnp

# 查看容器日志
docker logs -f fizzdragon-web
```
