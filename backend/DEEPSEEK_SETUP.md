# DeepSeek 配置指南

## 概述

本项目已配置支持 **DeepSeek** 作为 LLM 提供商，用于 LangGraph Agents。

**为什么选择 DeepSeek？**
- ✅ **成本极低**：约为 GPT-4o 的 1/10-1/20
- ✅ **性能优秀**：完全满足 Email Triage 任务需求
- ✅ **API 兼容**：与 OpenAI API 完全兼容，无需修改代码
- ✅ **中文支持**：对中文邮件理解更准确

## 配置步骤

### 1. 获取 DeepSeek API Key

1. 访问 https://platform.deepseek.com/
2. 注册/登录账号
3. 进入 API Keys 页面
4. 创建新的 API Key
5. 复制 Key（格式：`sk-...`）

### 2. 配置环境变量

在 `backend/.env` 文件中添加：

```env
# DeepSeek API Configuration
DEEPSEEK_API_KEY=sk-your-actual-api-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# LLM Provider Selection
LLM_PROVIDER=deepseek

# Optional: OpenAI as fallback
OPENAI_API_KEY=sk-your-openai-key-if-needed
OPENAI_MODEL=gpt-4o-mini
```

### 3. 验证配置

运行测试脚本：

```bash
cd backend
source venv/bin/activate
python test_deepseek_config.py
```

预期输出：
```
==================================================
Testing DeepSeek Configuration
==================================================

1. LLM Provider: deepseek
2. DeepSeek API Key: ✓ Set
3. DeepSeek Base URL: https://api.deepseek.com/v1
4. DeepSeek Model: deepseek-chat

5. Testing LLM initialization...
   ✓ LLM initialized successfully
   Model: deepseek-chat
   Base URL: https://api.deepseek.com/v1
   Temperature: 0.2
   Max Tokens: 2048

✅ Configuration test passed!
```

## 使用方法

### 在代码中使用

```python
from app.agents import get_triage_llm, get_chat_llm, get_llm

# 方式 1: 使用预设的 Triage LLM（推荐）
llm = get_triage_llm()
# 配置：temperature=0.2, max_tokens=2048, provider=deepseek

# 方式 2: 使用预设的 Chat LLM
llm = get_chat_llm()
# 配置：temperature=0.7, max_tokens=4096, provider=deepseek

# 方式 3: 自定义配置
llm = get_llm(
    model="deepseek-chat",  # 或 "deepseek-reasoner"
    temperature=0.3,
    max_tokens=1024,
    provider="deepseek"  # 或 "openai"
)
```

### 在 LangGraph 中使用

```python
from langgraph.graph import StateGraph
from app.agents import get_triage_llm

# 初始化 LLM
llm = get_triage_llm()

# 在 LangGraph node 中使用
def triage_node(state):
    # LLM 是 ChatModel，可以直接调用
    response = llm.invoke(state["messages"])
    return {"result": response.content}
```

## LangGraph Chat 模式

**是的，LangGraph 使用 Chat 模式！**

- LangGraph 使用 `BaseChatModel`（ChatModel）
- 支持消息历史（Message History）
- 支持 System/User/Assistant 消息
- 完全兼容 LangChain 的 Chat 接口

示例：
```python
from langchain_core.messages import SystemMessage, HumanMessage

messages = [
    SystemMessage(content="You are an email triage assistant."),
    HumanMessage(content="Classify this email: ...")
]

response = llm.invoke(messages)
```

## 模型选择

### DeepSeek-V3 (`deepseek-chat`)
- **推荐用于**：Email Triage（分类、摘要、优先级判断）
- **特点**：快速、准确、成本低
- **配置**：`DEEPSEEK_MODEL=deepseek-chat`

### DeepSeek-R1 (`deepseek-reasoner`)
- **推荐用于**：复杂推理、需要深度分析的场景
- **特点**：推理能力强，但速度较慢
- **配置**：`DEEPSEEK_MODEL=deepseek-reasoner`

## 切换提供商

如果需要切换到 OpenAI：

1. 在 `.env` 中设置：
```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-openai-key
```

2. 代码无需修改，`get_llm()` 会自动使用 OpenAI

## 故障排查

### 错误：DEEPSEEK_API_KEY is not set
- 检查 `.env` 文件是否存在
- 确认 `DEEPSEEK_API_KEY` 已设置
- 确认 `.env` 文件在 `backend/` 目录下

### 错误：API call failed
- 检查 API Key 是否正确
- 检查网络连接
- 确认 DeepSeek 账户有足够余额

### 错误：Model not found
- 确认模型名称正确：`deepseek-chat` 或 `deepseek-reasoner`
- 检查 DeepSeek API 文档确认模型名称

## 成本参考

（2024 年参考价格）

| 模型 | 输入 | 输出 |
|------|------|------|
| DeepSeek-V3 | $0.14/1M tokens | $0.56/1M tokens |
| GPT-4o | $2.50/1M tokens | $10/1M tokens |

**DeepSeek 约为 GPT-4o 的 1/10-1/20 成本！**

## 下一步

配置完成后，可以开始实现：
- ✅ Email Triage Agent
- ✅ Thread Chat Agent
- ✅ Assist Chat Agent

所有 Agent 都会自动使用 DeepSeek（如果已配置）。
