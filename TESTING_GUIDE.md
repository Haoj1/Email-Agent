# 测试指南 - 注册、登录和邮件查询

## 功能概述

已实现的功能：
1. ✅ **注册/登录** - Google OAuth 登录，自动创建账户
2. ✅ **多邮箱支持** - 一个账户可以添加多个邮箱
3. ✅ **邮件查询** - 查询和显示 Gmail 邮件 threads
4. ✅ **Inbox Sync (方案 A)** - 同步并标准化邮件 threads（不存储到数据库）

## 启动服务

### 1. 启动后端

```bash
cd backend
source venv/bin/activate
python main.py
```

后端将在 `http://localhost:5001` 运行

### 2. 启动前端

```bash
cd frontend
npm start
```

前端将在 `http://localhost:3000` 运行

## 测试流程

### 测试 1: 首次登录（注册）

1. 打开浏览器访问 `http://localhost:3000`
2. 点击 "Sign in with Google"
3. 选择 Google 账号并授权
4. 授权完成后会自动：
   - 创建 User 账户
   - 创建 UserEmail（主邮箱）
   - 创建 OAuthToken
   - 重定向到 Dashboard

**预期结果：**
- Dashboard 显示登录邮箱
- 自动加载邮件 threads
- 显示最近 7 天的邮件（最多 30 个 threads）

### 测试 2: 邮件查询

1. 登录后，Dashboard 会自动加载邮件
2. 点击 "Refresh Emails" 按钮可以手动刷新
3. 查看邮件列表：
   - From（发件人）
   - Subject（主题）
   - Date（日期）
   - Snippet（摘要）
   - Message count（邮件数量）

**预期结果：**
- 显示邮件 threads 列表
- 每个 thread 显示基本信息
- 可以滚动查看所有邮件

### 测试 3: 添加邮箱（多邮箱功能）

1. 在 Dashboard 中，如果有多个邮箱，会显示邮箱切换器
2. 要添加新邮箱：
   - 调用 API: `POST /api/emails/add?user_id={user_id}`
   - 或直接访问: `/api/auth/google/login?action=add_email&user_id={user_id}`
   - 完成 OAuth 授权
   - 新邮箱会自动添加到账户

**预期结果：**
- 新邮箱出现在邮箱列表中
- 可以切换邮箱查看不同邮箱的邮件

### 测试 4: 切换邮箱查看邮件

1. 如果账户有多个邮箱，Dashboard 会显示邮箱下拉菜单
2. 选择不同邮箱
3. 邮件列表会自动刷新，显示选中邮箱的邮件

**预期结果：**
- 切换邮箱后，邮件列表更新
- 每个邮箱的邮件独立显示

### 测试 5: Inbox Sync (标准化同步)

1. 在 Dashboard 中，找到 "Inbox Sync (Normalized)" 卡片
2. 点击 "Sync Inbox (Normalize)" 按钮
3. 等待同步完成（会显示加载状态）

**预期结果：**
- 显示同步成功的消息
- 显示同步的 threads 数量
- 显示标准化后的 threads 列表，包括：
  - Thread ID
  - Subject（已标准化，去除 Re:/Fwd: 前缀）
  - Participants（From, To, CC）
  - Latest message date（ISO 8601 格式）
  - Message count
  - Unread status
  - Labels
  - Messages（可展开查看详细信息）

**标准化数据格式：**
- 所有日期转换为 ISO 8601 格式
- Subject 去除 Re:/Fwd: 前缀
- Participants 解析为结构化对象（from, to, cc）
- Messages 包含完整的 body_text 和 body_html
- 数据不存储到数据库（方案 A: 不存储）

## API 端点

### 认证相关

- `GET /api/auth/google/login` - 发起 Google OAuth 登录
- `GET /api/auth/google/callback` - OAuth 回调处理
- `GET /api/auth/me` - 获取当前用户信息
- `POST /api/auth/logout` - 登出

### 邮件相关

- `GET /api/gmail/threads` - 获取邮件 threads
  - 参数：
    - `max_results` (可选, 默认 30) - 最大返回数量
    - `days` (可选, 默认 7) - 查询最近 N 天的邮件
    - `email` (可选) - 指定邮箱（默认使用主邮箱）
  
- `GET /api/gmail/threads/{thread_id}` - 获取 thread 详情

- `POST /api/gmail/sync` - 同步并标准化邮件 threads（方案 A: 不存储）
  - 请求体：
    ```json
    {
      "max_results": 100,
      "days": 30,
      "email": "optional@example.com"
    }
    ```
  - 返回：标准化后的 threads 列表（不存储到数据库）

### 邮箱管理

- `GET /api/emails` - 列出用户的所有邮箱
- `POST /api/emails/add` - 发起添加邮箱的 OAuth 流程
- `PUT /api/emails/{email_id}/set-primary` - 设置主邮箱
- `DELETE /api/emails/{email_id}` - 删除邮箱

## 测试检查清单

- [ ] 首次登录成功创建账户
- [ ] Dashboard 显示用户信息
- [ ] 邮件列表自动加载
- [ ] 邮件信息正确显示（From, Subject, Date, Snippet）
- [ ] 刷新邮件功能正常
- [ ] 添加邮箱功能正常
- [ ] 切换邮箱功能正常
- [ ] Inbox Sync 功能正常
- [ ] 标准化数据格式正确
- [ ] 登出功能正常

## 常见问题

### 1. 邮件列表为空

**可能原因：**
- Gmail API 未启用
- 邮箱中没有邮件
- Token 已过期

**解决方法：**
- 检查 Gmail API 是否在 Google Cloud Console 中启用
- 确认邮箱中有邮件
- 重新登录刷新 token

### 2. 401 未授权错误

**可能原因：**
- Session 过期
- Token 失效

**解决方法：**
- 重新登录
- 检查 cookie 是否被清除

### 3. 无法添加邮箱

**可能原因：**
- user_id 参数错误
- OAuth 授权失败

**解决方法：**
- 确认 user_id 正确
- 检查 OAuth 回调 URL 配置

## 下一步

完成测试后，可以继续实现：
- [ ] 邮件详情查看
- [ ] 邮件搜索功能
- [ ] 邮件分类（Triage Agent）- 使用标准化后的 threads
- [ ] Thread Chat Agent
- [ ] Assist Chat Agent
