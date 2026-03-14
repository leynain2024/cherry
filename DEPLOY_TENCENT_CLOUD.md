# 腾讯云部署说明

这个项目当前适合用下面这套结构部署：

- `Nginx` 负责公网 `80/443` 和 HTTPS 证书
- `Node.js` 只在服务器本机监听 `127.0.0.1:3135`
- 持久化数据统一放在 `/opt/cherry-deploy/shared/data`
- 应用代码放在 `/opt/cherry`

这样浏览器拿到的是正式 HTTPS 证书，数据库、上传图片、录音和生成音频也能跟代码分开维护。

## 1. 先决定服务器地域

- 想尽快上线，不想先做备案：优先选腾讯云中国香港或其他中国大陆以外地域。
- 想放在中国大陆地域：如果域名解析到中国大陆服务器，按腾讯云官方规则需要完成 ICP 备案或接入备案后再正式对外提供网站访问。

## 2. 本地准备

先把仓库推到 GitHub：

```bash
git remote add origin https://github.com/leynain2024/cherry.git
git push -u origin main
```

复制部署配置模板：

```bash
cp deploy/server.env.example deploy/server.env.local
```

把 `deploy/server.env.local` 改成你的服务器信息，至少填：

```dotenv
DEPLOY_HOST=124.156.120.109
DEPLOY_USER=root
DEPLOY_SSH_PORT=22
REMOTE_BASE_DIR=/opt/cherry-deploy
REMOTE_APP_DIR=/opt/cherry
REMOTE_DATA_DIR=/opt/cherry-deploy/shared/data
APP_SERVICE=cherry
SERVER_NAME=haibao.ballofleyna.cn
```

## 3. 服务器一次性初始化

下面命令默认服务器系统为 Ubuntu 22.04/24.04：

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx rsync git
```

安装 Node.js 22：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
node -v
npm -v
```

拉取代码到服务器：

```bash
sudo mkdir -p /opt/cherry /opt/cherry-deploy/shared/data
sudo chown -R "$USER":"$(id -gn)" /opt/cherry /opt/cherry-deploy
git clone https://github.com/leynain2024/cherry.git /opt/cherry
```

创建服务环境文件：

```bash
sudo mkdir -p /opt/cherry-deploy/shared/data
sudo tee /opt/cherry-deploy/shared/cherry.env >/dev/null <<'EOF'
HOST=127.0.0.1
PORT=3135
SERVER_TLS=off
DATA_DIR=/opt/cherry-deploy/shared/data
EOF
```

## 4. 首次同步代码和数据

在本地项目目录运行：

```bash
npm run deploy:sync
```

这条命令会做几件事：

- 为本地 `data/haibao.db` 生成一致性快照
- 同步 `uploads`、`recordings`、`audio-assets`
- 先在远端备份旧数据再覆盖
- 在远端执行 `npm ci`、`npm run build`
- 安装并重启 `systemd` 服务

以后你每次想把本地最新代码和数据整体推到云端，继续运行这一条即可。

如果想把云端最新数据拉回本地：

```bash
npm run deploy:pull-data
```

## 5. 配置域名 `haibao.ballofleyna.cn`

在域名 DNS 控制台添加记录：

- 主机记录：`haibao`
- 记录类型：`A`
- 记录值：你的腾讯云服务器公网 IPv4

如果你的 DNS 不在腾讯云，也按同样规则加 `A` 记录即可。

## 6. 配置 Nginx

在服务器上执行：

```bash
cd /opt/cherry
SERVER_NAME=haibao.ballofleyna.cn APP_UPSTREAM=127.0.0.1:3135 bash scripts/install-nginx-site.sh
```

如果是首次部署，建议同时删掉默认站点：

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 7. 申请正式 HTTPS 证书

先确认：

- `haibao.ballofleyna.cn` 已解析到这台服务器
- 服务器安全组和系统防火墙放行了 `80`、`443`
- `nginx` 已经能正常响应 80 端口

然后执行：

```bash
sudo certbot --nginx -d haibao.ballofleyna.cn
```

成功后，Certbot 会自动把 Nginx 配成 HTTPS，并安装续期任务。以后浏览器访问：

```text
https://haibao.ballofleyna.cn
```

就不会再看到自签名证书告警。

## 8. 腾讯云侧建议

安全组建议只开放这些端口：

- `22`：SSH
- `80`：证书签发和 HTTP 跳转
- `443`：正式 HTTPS

不需要对公网开放 `3135`，因为它只给本机的 Nginx 反向代理使用。

## 9. 常用运维命令

查看服务状态：

```bash
sudo systemctl status cherry
```

重启服务：

```bash
sudo systemctl restart cherry
```

查看服务日志：

```bash
sudo journalctl -u cherry -n 200 --no-pager
```

查看 Nginx 配置是否正确：

```bash
sudo nginx -t
```

手动测试证书续期：

```bash
sudo certbot renew --dry-run
```

服务器日常更新代码并重启服务：

```bash
cd /opt/cherry
bash scripts/update-server.sh
```

如果你更习惯 `npm` 命令，也可以：

```bash
cd /opt/cherry
npm run server:update
```

## 10. 当前同步范围说明

`npm run deploy:sync` 会同步这些持久化内容：

- `data/haibao.db`
- `data/uploads/`
- `data/recordings/`
- `data/audio-assets/`

你现在后台里保存的管理员、用户、OpenAI/Qwen/OCR 设置都在 `haibao.db` 里，所以会一起上云。

## 11. 推荐上线路径

最省事的一条路是：

1. 买一台 Ubuntu 腾讯云服务器
2. 如果还没有备案，优先选中国香港地域
3. 按上面步骤装 `nginx + certbot + nodejs`
4. 本地填好 `deploy/server.env.local`
5. 运行 `npm run deploy:sync`
6. 给 `haibao.ballofleyna.cn` 配 `A` 记录
7. 在服务器上跑 `sudo certbot --nginx -d haibao.ballofleyna.cn`

做到这里，这个项目就能通过正式 HTTPS 域名对外访问了。
