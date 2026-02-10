# 前端部署指南：S3 + CloudFront + Route53

## 前置条件

1. ✅ 后端已部署到 EC2（域名：`mail-agents.net`，已配置 HTTPS）
2. ✅ 前端域名：`app.mail-agents.net` 和 `www.mail-agents.net`
3. ✅ AWS 账户已配置好
4. ✅ 后端 CORS 已配置（见下方说明）

---

## 第一步：配置前端环境变量

### 1.1 创建生产环境变量文件

在 `frontend/` 目录下创建 `.env.production`：

```bash
cd frontend
```

文件内容（已创建）：
```env
REACT_APP_API_URL=https://mail-agents.net/api
```

**注意**：后端域名是 `mail-agents.net`（已配置）。

### 1.2 更新后端 CORS 配置（重要！）

在部署前端之前，需要确保后端允许前端域名访问：

1. **SSH 登录到 EC2**：
```bash
ssh -i /path/to/key.pem ubuntu@api.yourdomain.com
```

2. **编辑环境变量文件**：
```bash
sudo nano /etc/email-agent.env
```

3. **添加或更新 `CORS_ORIGINS`**（用逗号分隔多个域名）：
```env
CORS_ORIGINS=https://app.mail-agents.net,https://www.mail-agents.net,http://localhost:3000
```

4. **重启后端服务**：
```bash
sudo systemctl restart email-agent
sudo systemctl status email-agent  # 确认服务正常运行
```

### 1.3 构建前端

```bash
cd frontend
npm install
npm run build
```

构建完成后，会在 `frontend/build/` 目录生成静态文件。

**注意**：构建时会自动使用 `.env.production` 文件中的 `REACT_APP_API_URL`。

---

## 第二步：创建 S3 Bucket

### 2.1 创建 Bucket

1. 登录 AWS Console → S3
2. 点击 **Create bucket**
3. 配置：
   - **Bucket name**: 
     - **推荐**：使用你的主域名，如 `app.mail-agents.net`（必须全局唯一）
     - **备选**：如果域名不可用，可以用 `mail-agents-frontend` 等名称，然后通过 CloudFront CNAME 配置域名
   - **Region**: 选择与 CloudFront 接近的区域（推荐 `us-east-1`）
   - **Block Public Access**: **取消勾选**（需要公开访问）
   - **Bucket Versioning**: 可选（建议开启）
   - **Default encryption**: 可选（建议开启）

4. 点击 **Create bucket**

**注意**：S3 bucket 名称必须全局唯一。如果 `app.mail-agents.net` 已被占用，可以使用：
- `mail-agents-app`
- `mail-agents-frontend`
- `mail-agents-web`

然后在 CloudFront 中通过 **Alternate domain names (CNAMEs)** 配置 `app.mail-agents.net` 和 `www.mail-agents.net`。

### 2.2 配置 Bucket 策略（公开访问）

1. 进入 Bucket → **Permissions** → **Bucket policy**
2. 添加以下策略（替换 `yourdomain.com`）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::app.mail-agents.net/*"
    }
  ]
}
```

**注意**：将 `app.mail-agents.net` 替换为你的实际 S3 bucket 名称。

### 2.3 配置静态网站托管

1. 进入 Bucket → **Properties** → **Static website hosting**
2. 选择 **Enable**
3. 配置：
   - **Index document**: `index.html`
   - **Error document**: `index.html`（React Router 需要）
4. 保存，记录 **Bucket website endpoint**（例如：`http://yourdomain.com.s3-website-us-east-1.amazonaws.com`）

---

## 第三步：上传文件到 S3

### 3.1 使用 AWS CLI（推荐）

```bash
# 安装 AWS CLI（如果还没有）
# macOS: brew install awscli
# 配置凭证: aws configure

# 上传构建文件（替换为你的实际 bucket 名称，如 app.mail-agents.net）
cd frontend
aws s3 sync build/ s3://app.mail-agents.net/ --delete

# 设置正确的 Content-Type（重要！）
aws s3 cp build/index.html s3://app.mail-agents.net/index.html --content-type "text/html"
aws s3 cp build/static/css/ s3://app.mail-agents.net/static/css/ --recursive --content-type "text/css"
aws s3 cp build/static/js/ s3://app.mail-agents.net/static/js/ --recursive --content-type "application/javascript"
```

### 3.2 或使用 AWS Console

1. 进入 Bucket → **Upload**
2. 上传 `frontend/build/` 目录下的所有文件
3. 确保文件权限设置为 **Public read**

---

## 第四步：创建 CloudFront Distribution

### 4.1 创建 Distribution

1. 登录 AWS Console → CloudFront
2. 点击 **Create distribution**
3. 配置：

   **Origin settings:**
   - **Origin domain**: 选择你的 S3 bucket（例如：`app.mail-agents.net.s3.amazonaws.com`）
   - **Origin path**: 留空
   - **Origin access**: 选择 **Public**（如果 bucket 已公开）

   **Default cache behavior:**
   - **Viewer protocol policy**: **Redirect HTTP to HTTPS**
   - **Allowed HTTP methods**: **GET, HEAD, OPTIONS**
   - **Cache policy**: **CachingOptimized**（或自定义）
   - **Compress objects automatically**: **Yes**

   **Settings:**
   - **Price class**: 选择合适的价格等级
   - **Alternate domain names (CNAMEs)**: 
     - `app.mail-agents.net`
     - `www.mail-agents.net`
   - **SSL certificate**: 
     - 如果已有 ACM 证书：选择证书
     - 如果没有：选择 **Request or import a certificate with ACM**（见下一步）

**重要**：即使 S3 bucket 名称不是域名，也可以通过 CNAMEs 配置多个域名指向同一个 CloudFront Distribution。

4. 点击 **Create distribution**

### 4.2 配置错误页面（React Router 需要）

1. 进入 Distribution → **Error pages** → **Create custom error response**
2. 添加两个错误响应：

   **错误 1:**
   - **HTTP error code**: `403`
   - **Customize error response**: **Yes**
   - **Response page path**: `/index.html`
   - **HTTP response code**: `200`

   **错误 2:**
   - **HTTP error code**: `404`
   - **Customize error response**: **Yes**
   - **Response page path**: `/index.html`
   - **HTTP response code**: `200`

---

## 第五步：配置 SSL 证书（ACM）

### 5.1 申请证书

1. 登录 AWS Console → **Certificate Manager (ACM)**
2. 选择 **us-east-1** 区域（CloudFront 要求）
3. 点击 **Request a certificate**
4. 选择 **Request a public certificate**
5. 添加域名：
   - `app.mail-agents.net`
   - `www.mail-agents.net`
   - `*.mail-agents.net`（通配符，可选，可覆盖所有子域名）
6. 选择 **DNS validation**（推荐）
7. 点击 **Request**

### 5.2 DNS 验证

1. 在证书详情页，点击每个域名的 **Create record in Route53**
2. 或手动在 Route53 添加 CNAME 记录（按提示）
3. 等待验证完成（通常几分钟）

### 5.3 关联证书到 CloudFront

1. 回到 CloudFront Distribution
2. 编辑 **Settings**
3. 在 **SSL certificate** 中选择刚创建的证书
4. 保存更改

---

## 第六步：配置 Route53 DNS

### 6.1 创建 Hosted Zone（如果还没有）

1. 登录 AWS Console → Route53
2. 点击 **Create hosted zone**
3. 输入域名：`yourdomain.com`
4. 记录 **Name servers**（NS 记录）

### 6.2 更新域名注册商的 Name Servers

1. 登录你的域名注册商（GoDaddy, Namecheap 等）
2. 将 Name Servers 更新为 Route53 提供的 NS 记录

### 6.3 创建 DNS 记录

在 Route53 Hosted Zone (`mail-agents.net`) 中创建以下记录：

**A 记录（app 子域名 → CloudFront）：**
- **Name**: `app.mail-agents.net`
- **Type**: **A**
- **Alias**: **Yes**
- **Alias target**: 选择你的 CloudFront Distribution
- **Routing policy**: **Simple routing**

**A 记录（www → CloudFront）：**
- **Name**: `www.mail-agents.net`
- **Type**: **A**
- **Alias**: **Yes**
- **Alias target**: 选择你的 CloudFront Distribution（与上面同一个）
- **Routing policy**: **Simple routing**

**A 记录（根域名 → 后端或 CloudFront）：**
- **Name**: `mail-agents.net`（留空，表示根域名）
- **Type**: **A**
- **Alias**: **Yes**
- **Alias target**: 
  - 如果根域名也要指向前端：选择 CloudFront Distribution
  - 如果根域名指向后端：选择 EC2 IP（见下方）
- **Routing policy**: **Simple routing**

**注意**：如果后端使用根域名 `mail-agents.net`，则不需要单独的 API 子域名记录。

---

## 第七步：等待 DNS 传播

DNS 传播通常需要 **15 分钟到 48 小时**。你可以使用以下工具检查：

```bash
# 检查 DNS 解析
dig app.mail-agents.net
nslookup app.mail-agents.net

# 检查 CloudFront 是否生效
curl -I https://app.mail-agents.net
curl -I https://www.mail-agents.net
```

---

## 第八步：验证部署

### 8.1 检查前端

1. 访问 `https://app.mail-agents.net` 和 `https://www.mail-agents.net`
2. 检查浏览器控制台是否有 API 请求错误
3. 确认 logo 和样式正常加载

### 8.2 检查 API 连接

1. 打开浏览器开发者工具 → Network
2. 尝试登录
3. 确认 API 请求指向 `https://mail-agents.net/api`

---

## 后续更新流程

每次更新前端代码后：

```bash
# 1. 更新环境变量（如果需要）
# 编辑 frontend/.env.production

# 2. 重新构建
cd frontend
npm run build

# 3. 上传到 S3（替换为你的实际 bucket 名称）
aws s3 sync build/ s3://app.mail-agents.net/ --delete
# 或使用部署脚本：
# ./deploy.sh app.mail-agents.net [cloudfront-distribution-id]

# 4. CloudFront 会自动失效旧缓存（或手动失效）
# AWS Console → CloudFront → Distribution → Invalidations → Create invalidation
# 输入: /*
```

---

## 常见问题

### Q: CloudFront 显示 "Access Denied"
**A**: 检查 S3 Bucket 策略是否允许公开访问，以及 CloudFront Origin 配置是否正确。

### Q: 页面刷新后 404
**A**: 确保配置了 CloudFront 错误页面（403/404 → index.html）。

### Q: API 请求失败（CORS）
**A**: 检查后端 CORS 配置，确保允许你的前端域名。

**重要**：需要在后端 EC2 的 `/etc/email-agent.env` 中添加前端域名：

```bash
# SSH 登录到 EC2
sudo nano /etc/email-agent.env

# 添加或更新 CORS_ORIGINS（包含前端域名）
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com,http://localhost:3000

# 保存后重启服务
sudo systemctl restart email-agent
```

### Q: 样式或 JS 文件 404
**A**: 检查 S3 上传时是否正确设置了 Content-Type，以及 CloudFront 缓存策略。

---

## 成本估算

- **S3**: ~$0.023/GB 存储 + $0.0004/1000 请求（几乎免费）
- **CloudFront**: ~$0.085/GB 数据传输（前 10TB）
- **Route53**: $0.50/月 per hosted zone + $0.40/百万查询

**预计月成本**: $1-5（低流量情况下）

---

## 完成！

前端现在应该可以通过 `https://yourdomain.com` 访问了！🎉
