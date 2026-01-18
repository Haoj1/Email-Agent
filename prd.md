# Multi-User AI Email Agent  
## 功能设计文档（PRD + 技术设计 + Agent 实现规格）

---

## 0. 项目概述

### 项目名称
**Multi-User AI Email Agent**

### 一句话描述
一个基于 **Gmail + Google Calendar** 的多用户 AI Agent Web 应用，  
通过 **LangGraph** 实现邮件分析、回复草稿生成、日历事项抽取，并提供 **Cursor-style 可执行 Thread Chat Agent** 和 **全局 Assist Chat Agent**。

---

## 1. 产品目标与范围

### 1.1 产品目标
- 在“邮件很多”的场景下，帮助用户：
  - 快速理解邮件内容
  - 明确哪些邮件需要处理
  - 自动生成高质量回复草稿
  - 从邮件中抽取会议并同步到日历
- 所有自动化行为必须：
  - 可解释
  - 可确认（human-in-the-loop）
  - 可回溯

### 1.2 MVP 不做的事
- ❌ 自动发送邮件  
- ❌ 无确认直接创建日历  
- ❌ 长期记忆 / 跨会话记忆  
- ❌ 非 Gmail 邮箱（Outlook / 163 作为后续）

---

## 2. 用户与账号模型（Multi-User）

### 2.1 用户体系
- 每个用户 = 一个 Google 账号
- 用户通过 **Google OAuth2 登录**
- 不接受、不存储邮箱密码

### 2.2 身份与 Token 模型
- `user_id = Google account email`
- 前端：
  - 只持有 **应用自己的 session（cookie / JWT）**
- 后端：
  - 存储每个用户的 **OAuth access_token + refresh_token**
  - 使用 token 调用 Gmail / Calendar API

> 本质：  
> 用户是在“登录你的应用”，而 Gmail / Calendar 访问是通过 OAuth 授权完成的。

---

## 3. 功能模块总览

1. 登录与授权（OAuth）
2. Inbox Sync（邮件同步）
3. 批量邮件 Agent（Triage & Summary）
4. 回复草稿生成（Draft）
5. 日历事项抽取与创建（Calendar）
6. Cursor-style Thread Chat Agent（核心功能）
7. Assist Chat Agent（核心功能）

---

## 4. 功能需求（Functional Requirements）

---

### 4.1 登录与授权（OAuth）

**功能**
- 用户点击「Sign in with Google」
- 跳转 Google 官方授权页
- 授权完成后进入应用

**OAuth Scope（最小化）**
- `gmail.readonly`
- `gmail.compose`（仅保存草稿）
- `calendar.events`
- ❌ 不申请 `gmail.send`

---

### 4.2 Inbox Sync（邮件同步）

**功能**
- 用户手动触发同步
- 默认拉取：
  - 最近 7 天
  - 最多 30 个 threads

**约束**
- 只读
- 不修改 Gmail 原状态
- 后端统一 normalize 为内部 Thread schema

---

### 4.3 批量邮件 Agent（Triage & Summary）

**对每个 Thread，Agent 输出：**
- `label`
  - NEEDS_REPLY
  - FYI
  - ARCHIVE
  - SPAM_LIKE
- `priority`（0–1）
- `summary`（2–4 句）
- `key_points`（bullet list）

**用途**
- Today View
- Inbox 排序
- 决定是否需要处理

---

### 4.4 回复草稿生成（Draft）

**功能**
- 对 NEEDS_REPLY 邮件生成：
  - 回复 subject
  - 回复 body
- 用户可编辑

**执行**
- ✅ 保存为 Gmail Draft  
- ❌ 不自动发送

**安全规则**
- 不编造事实
- 不承诺未确认事项
- 不编造时间或截止日期

---

### 4.5 日历事项抽取与创建（Calendar）

**功能**
- 从邮件中抽取：
  - 标题
  - 开始/结束时间（ISO）
  - 时区
  - 参与人
  - 地点 / 描述
- 输出 **Calendar Proposal**
  - 包含 `confidence`

**执行规则**
- 所有创建操作必须用户确认
- 低置信度（如 <0.6）禁止一键创建

---

## 5. Cursor-Style Thread Chat Agent（核心功能）

> Thread Chat 是一个 **会分析、会规划、会调用工具、会执行任务的 Agent**，而不是普通 Q&A。

---

### 5.1 Thread Chat 能做什么

用户在某个邮件 thread 中可以说：

- "总结这封邮件的关键问题"
- "帮我写一封礼貌但明确的回复"
- "如果有会议，给我一个日历创建建议"
- "我确认后，帮我保存草稿 / 创建日历"

---

### 5.2 Thread Chat 的核心原则

1. 上下文默认只包含当前 thread  
2. Agent 必须先分析，再规划  
3. 所有写入动作必须确认  
4. Agent 输出结构化 actions  

---

### 5.3 Thread Chat 输入 / 输出协议

#### 输入
```json
{
  "user_id": "string",
  "thread_id": "string",
  "message": "string",
  "ui_state": {}
}
```

#### 输出
```json
{
  "assistant_message": "自然语言解释",
  "actions": [
    {
      "id": "action_xxx",
      "type": "PROPOSE_DRAFT | PROPOSE_EVENT",
      "status": "NEEDS_CONFIRMATION | EXECUTED | FAILED",
      "payload": {}
    }
  ],
  "trace": ["planner", "tool", "validator"]
}
```

---

## 6. Assist Chat Agent（核心功能）

> Assist Chat Agent 是一个 **全局的、类似 Gemini 的 AI 助手**，可以在应用的任意位置打开，提供智能辅助功能。

---

### 6.1 Assist Chat Agent 的特点

- **全局可用**：不绑定特定 thread，可在任意页面/位置打开
- **智能助手**：类似 Google Gemini，提供通用 AI 辅助功能
- **Agent 能力**：具备完整的 Agent 功能，可以调用工具执行任务
- **上下文感知**：可以访问用户的邮件、日历等数据（通过 API）

---

### 6.2 Assist Chat Agent 能做什么

用户可以在任意位置询问：

- **邮件相关**：
  - "帮我找一下上周关于项目的邮件"
  - "我有哪些邮件需要回复？"
  - "总结一下今天收到的所有重要邮件"
  - "帮我写一封邮件给 [某人]，主题是 [xxx]"

- **日历相关**：
  - "我下周有哪些会议？"
  - "帮我查看明天下午是否有空"
  - "从这封邮件中提取会议信息并创建日历"

- **综合任务**：
  - "帮我准备明天的会议，包括相关邮件和日历"
  - "分析我最近的工作邮件，给我一个总结"
  - "帮我安排一个会议，并发送邀请邮件"

---

### 6.3 Assist Chat Agent 的核心原则

1. **全局上下文**：可以访问用户的所有邮件和日历数据（通过 API）
2. **智能规划**：Agent 会分析用户意图，规划执行步骤
3. **工具调用**：可以调用 Gmail 和 Calendar API 执行任务
4. **安全确认**：所有写入操作（创建草稿、创建日历）必须用户确认
5. **会话记忆**：在单次会话中保持上下文，跨会话不保留（MVP）

---

### 6.4 Assist Chat Agent 输入 / 输出协议

#### 输入
```json
{
  "user_id": "string",
  "message": "string",
  "context": {
    "current_page": "string",  // 可选：当前页面信息
    "selected_thread_id": "string",  // 可选：如果用户选中了某个 thread
    "conversation_history": []  // 当前会话历史
  }
}
```

#### 输出
```json
{
  "assistant_message": "自然语言回复",
  "actions": [
    {
      "id": "action_xxx",
      "type": "SEARCH_EMAILS | GET_CALENDAR | PROPOSE_DRAFT | PROPOSE_EVENT | ANSWER_ONLY",
      "status": "NEEDS_CONFIRMATION | EXECUTED | FAILED",
      "payload": {},
      "tool_calls": [
        {
          "tool": "search_emails",
          "args": {},
          "result": {}
        }
      ]
    }
  ],
  "trace": ["planner", "tool_executor", "validator"]
}
```

---

### 6.5 Assist Chat Agent 内部架构（LangGraph）

```
User Message
    ↓
Context Loader (可选：加载当前页面上下文)
    ↓
Planner (LLM, JSON Plan)
    ↓
Tool Executor (Gmail API, Calendar API)
    ↓
Response Generator
    ↓
Approval Gate (写入操作需要确认)
    ↓
Final Response
```

---

### 6.6 Assist Chat Agent Tools（可调用能力）

#### 只读工具
- `search_emails(query, date_range, max_results)` - 搜索邮件
- `get_email_thread(thread_id)` - 获取邮件 thread
- `get_calendar_events(time_min, time_max)` - 获取日历事件
- `get_calendar_freebusy(time_min, time_max)` - 检查空闲时间
- `analyze_email_content(thread_id)` - 分析邮件内容

#### 写入工具（必须确认）
- `save_gmail_draft(to, subject, body)` - 保存邮件草稿
- `create_calendar_event(event)` - 创建日历事件
- `search_and_summarize_emails(query)` - 搜索并总结邮件

---

## 7. Thread Chat Agent 内部架构（LangGraph）
Context Loader
      ↓
Planner (LLM, JSON Plan)
      ↓
Tool Executor (只读工具)
      ↓
Approval Gate（人类确认）
      ↓
Final Response

## 8. Agent Tools（可调用能力）

### 8.1 Thread Chat Agent Tools

#### 只读工具
- `get_thread(thread_id)` - 获取邮件 thread
- `parse_datetime(text, timezone)` - 解析日期时间

#### 写入工具（必须确认）
- `save_gmail_draft(to, subject, body)` - 保存邮件草稿
- `create_calendar_event(event)` - 创建日历事件

### 8.2 Assist Chat Agent Tools

#### 只读工具
- `search_emails(query, date_range, max_results)` - 搜索邮件
- `get_email_thread(thread_id)` - 获取邮件 thread
- `get_calendar_events(time_min, time_max)` - 获取日历事件
- `get_calendar_freebusy(time_min, time_max)` - 检查空闲时间
- `analyze_email_content(thread_id)` - 分析邮件内容

#### 写入工具（必须确认）
- `save_gmail_draft(to, subject, body)` - 保存邮件草稿
- `create_calendar_event(event)` - 创建日历事件
- `search_and_summarize_emails(query)` - 搜索并总结邮件

---

## 9. 数据库设计（PostgreSQL）

### 9.1 users
```sql
users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  timezone TEXT,
  created_at TIMESTAMP
)
```

### 9.2 oauth_tokens
```sql
oauth_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  provider TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  scope TEXT
)
```

### 9.3 thread_cache
```sql
thread_cache (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  thread_id TEXT,
  agent_output JSONB,
  updated_at TIMESTAMP
)
```

### 9.4 assist_chat_sessions
```sql
assist_chat_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  session_id TEXT UNIQUE NOT NULL,
  conversation_history JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

### 10.1 Auth
- `GET /auth/google/login` - 发起 Google OAuth 登录
- `GET /auth/google/callback` - OAuth 回调处理

### 10.2 Gmail
- `POST /gmail/sync` - 同步收件箱
- `GET /threads/{thread_id}` - 获取邮件 thread

### 10.3 批量 Agent
- `POST /agent/run` - 批量处理邮件

### 10.4 Thread Chat Agent
- `POST /chat/thread` - Thread Chat Agent 对话
- `POST /chat/confirm` - 确认执行 action

### 10.5 Assist Chat Agent
- `POST /chat/assist` - Assist Chat Agent 对话
- `POST /chat/assist/confirm` - 确认执行 action
- `GET /chat/assist/history` - 获取会话历史（可选）

### 10.6 Calendar
- `POST /calendar/events` - 创建日历事件

### 10.7 Draft
- `POST /drafts/save` - 保存邮件草稿

---

## 11. 安全与约束

不接受邮箱密码

OAuth token 仅后端使用

所有写入操作 human-in-the-loop

HTTPS 强制

---

## 12. Code Agent 实现规格书（Spec）

### A. Planner Prompt（严格 JSON）
You are a planning agent for an email assistant.

Rules:
- Output JSON only.
- Decide plan.type:
  - ANSWER_ONLY
  - PROPOSE_DRAFT
  - PROPOSE_EVENT
- Never execute write actions directly.
- If required information is missing, ask a clarifying question.

### B. Tool Schema

#### Thread Chat Agent Tools
```json
{
  "name": "get_thread",
  "args": { "thread_id": "string" }
}

{
  "name": "save_gmail_draft",
  "args": { "to": "string", "subject": "string", "body": "string" }
}

{
  "name": "create_calendar_event",
  "args": {
    "title": "string",
    "start_iso": "string",
    "end_iso": "string",
    "timezone": "string",
    "attendees": ["string"],
    "location": "string",
    "description": "string"
  }
}
```

#### Assist Chat Agent Tools
```json
{
  "name": "search_emails",
  "args": {
    "query": "string",
    "date_range": {"start": "ISO8601", "end": "ISO8601"},
    "max_results": "number"
  }
}

{
  "name": "get_calendar_events",
  "args": {
    "time_min": "ISO8601",
    "time_max": "ISO8601"
  }
}

{
  "name": "get_calendar_freebusy",
  "args": {
    "time_min": "ISO8601",
    "time_max": "ISO8601"
  }
}
```

### C. Action 状态机

| 状态 | 含义 |
|------|------|
| NEEDS_CONFIRMATION | 等待用户确认 |
| EXECUTED | 执行成功 |
| FAILED | 执行失败 |

### D. API 约定

#### Thread Chat Agent
- `/chat/thread` - 不执行写入，只生成 proposal actions
- `/chat/confirm` - 校验 action 属于当前用户，执行对应工具，更新 action 状态

#### Assist Chat Agent
- `/chat/assist` - 可以执行只读操作，写入操作生成 proposal actions
- `/chat/assist/confirm` - 校验 action 属于当前用户，执行对应工具，更新 action 状态

结束语

本项目是一个 真正可部署的、多用户、具备执行能力的 AI Agent 系统，
而不是简单的“LLM + 邮箱展示”。