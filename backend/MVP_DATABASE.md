# MVP Database Design - 最小可运行版本

## 设计原则

**最小化但足够**：只包含 MVP 必需的表和索引，确保所有核心功能可以运行。

---

## 执行方式说明

### 异步任务（有任务表支持）
- **Triage（邮件分类总结）** - 使用 `triage_tasks` 表
  - 原因：批量处理多个邮件，耗时较长（5-10 分钟）
  - 流程：提交任务 → 轮询状态 → 获取结果

### 同步交互（无任务表）
- **Thread Chat Agent** - 使用 `thread_cache` 表（仅缓存）
  - 原因：实时对话，需要立即响应（3-10 秒）
  - 流程：发送消息 → 立即返回结果

- **Assist Chat Agent** - 使用 `assist_chat_sessions` 表（仅会话历史）
  - 原因：实时对话体验，类似 ChatGPT/Gemini（3-10 秒）
  - 流程：发送消息 → 立即返回结果

---

## MVP 必需的表（8个）

### 1. `users` - 用户表
**用途**：存储 Google OAuth 登录的用户信息
- ✅ 必需：OAuth 登录功能
- **索引**：`email` (unique) - 用于登录查找

### 2. `oauth_tokens` - OAuth Token 表
**用途**：存储 Google API 访问令牌
- ✅ 必需：调用 Gmail/Calendar API
- **索引**：`(user_id, provider)` - 查找用户的活跃 token

### 3. `triage_tasks` - Triage 异步任务表
**用途**：跟踪异步邮件分类任务的状态和进度
- ✅ 必需：异步任务提交和轮询功能
- **索引**：`task_id` (unique), `(user_id, status, created_at)` - 任务查找和列表
- **执行方式**：异步（提交任务 → 轮询状态 → 获取结果）

### 4. `triage_results` - 邮件分析结果表
**用途**：存储批量邮件 Agent 的分析结果（label, priority, summary）
- ✅ 必需：Today View 和收件箱排序功能
- **索引**：`(user_id, label, priority)` - Today View 过滤和排序
- **关联**：通过 `task_id` 关联到 `triage_tasks`

### 5. `drafts` - 草稿表
**用途**：记录生成的邮件草稿
- ✅ 必需：草稿生成功能
- **索引**：`(user_id, created_at)` - 列出用户的草稿

### 6. `calendar_proposals` - 日历提案表
**用途**：存储从邮件中抽取的日历事件提案
- ✅ 必需：日历功能
- **索引**：`(user_id, status, start_iso)` - 列出待确认的提案

### 7. `thread_cache` - Thread Chat 缓存表
**用途**：缓存 Thread Chat Agent 的输出
- ✅ 必需：Thread Chat Agent 功能
- **索引**：Unique `(user_id, thread_id)` - 确保每个 thread 只有一个缓存
- **执行方式**：同步（实时对话，立即返回结果）

### 8. `assist_chat_sessions` - Assist Chat 会话表
**用途**：存储 Assist Chat Agent 的对话历史
- ✅ 必需：Assist Chat Agent 功能
- **索引**：`(user_id, updated_at)` - 列出最近的会话
- **执行方式**：同步（实时对话，立即返回结果）

---

## 索引策略（最小化）

### 自动索引（PostgreSQL 自动创建）
- ✅ 所有主键（PRIMARY KEY）
- ✅ 所有外键（FOREIGN KEY）
- ✅ 所有唯一约束（UNIQUE）

### 手动添加的索引（仅必需查询）

1. **`oauth_tokens(user_id, provider)`**
   - 查询：`WHERE user_id = ? AND provider = 'google'`
   - 频率：每次 API 调用
   - ✅ 必需

2. **`triage_results(user_id, label, priority)`**
   - 查询：`WHERE user_id = ? AND label = 'NEEDS_REPLY' ORDER BY priority DESC`
   - 频率：每次打开 Today View
   - ✅ 必需

3. **`assist_chat_sessions(user_id, updated_at)`**
   - 查询：`WHERE user_id = ? ORDER BY updated_at DESC`
   - 频率：列出最近会话
   - ✅ 必需

4. **`drafts(user_id, created_at)`**
   - 查询：`WHERE user_id = ? ORDER BY created_at DESC`
   - 频率：列出草稿
   - ✅ 必需

5. **`calendar_proposals(user_id, status, start_iso)`**
   - 查询：`WHERE user_id = ? AND status = 'pending' ORDER BY start_iso`
   - 频率：列出待确认的提案
   - ✅ 必需

---

## MVP 不需要的表

- ❌ `email_threads` - 邮件数据直接从 Gmail API 获取，不需要缓存
- ❌ `email_messages` - 同上
- ❌ `sync_history` - Inbox Sync 是实时调用 API，不需要历史记录

---

## MVP 不需要的索引（可后续添加）

以下索引在 MVP 阶段**不是必需的**，但可以在后续优化时添加：

1. **JSONB GIN 索引**
   - `thread_cache.agent_output` - 如果不需要查询 JSONB 内容
   - `assist_chat_sessions.conversation_history` - 如果不需要搜索历史
   - `triage_results.key_points` - 如果不需要查询关键点
   - `calendar_proposals.attendees` - 如果不需要搜索参与者

2. **清理索引**
   - `oauth_tokens.expires_at` - 如果不需要定期清理过期 token
   - `thread_cache.updated_at` - 如果不需要清理旧缓存

3. **额外复合索引**
   - 其他组合查询的索引（如果查询频率不高）

---

## 查询性能评估

### 高频查询（都有索引支持）

| 查询场景 | 表 | 索引 | 性能 |
|---------|-----|------|------|
| OAuth 登录查找 | `users` | `email` (unique) | ✅ 极快 |
| 获取用户 token | `oauth_tokens` | `(user_id, provider)` | ✅ 极快 |
| Today View 列表 | `triage_results` | `(user_id, label, priority)` | ✅ 快 |
| 列出草稿 | `drafts` | `(user_id, created_at)` | ✅ 快 |
| 列出提案 | `calendar_proposals` | `(user_id, status, start_iso)` | ✅ 快 |
| 获取缓存 | `thread_cache` | `(user_id, thread_id)` unique | ✅ 极快 |
| 最近会话 | `assist_chat_sessions` | `(user_id, updated_at)` | ✅ 快 |

### 结论

✅ **当前设计完全满足 MVP 需求**

- 所有核心功能都有对应的表
- 所有高频查询都有索引支持
- 没有冗余的表或索引
- 可以支持 MVP 的所有功能模块

---

## 后续优化建议（Post-MVP）

当用户量增长或需要新功能时，可以考虑添加：

1. **JSONB GIN 索引** - 如果需要搜索 JSONB 内容
2. **清理索引** - 如果需要定期清理旧数据
3. **邮件缓存表** - 如果需要离线访问或减少 API 调用
4. **分析表** - 如果需要用户行为分析

---

## 运行初始化

```bash
cd backend
source venv/bin/activate
python init_database.py
```

这会创建所有 8 个表和必需的索引。

---

## 详细文档

- **异步 Triage 任务系统**：参见 [ASYNC_TRIAGE_TASKS.md](./ASYNC_TRIAGE_TASKS.md)
