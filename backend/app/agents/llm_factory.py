"""
LLM Factory - Initialize ChatModel for LangGraph agents
Supports DeepSeek and OpenAI providers
"""
from langchain_openai import ChatOpenAI
from langchain_core.language_models import BaseChatModel
from app.config import settings


def get_llm(
    model: str = None,
    temperature: float = 0.3,
    max_tokens: int = 1024,
    provider: str = None
) -> BaseChatModel:
    """
    Initialize ChatModel for LangGraph agents
    
    Args:
        model: Model name (optional, uses default from config)
        temperature: Sampling temperature (0.0-1.0)
        max_tokens: Maximum tokens in response
        provider: "deepseek" or "openai" (optional, uses config default)
    
    Returns:
        BaseChatModel instance ready for LangGraph
    
    Examples:
        # Use DeepSeek (default)
        llm = get_llm()
        
        # Use OpenAI
        llm = get_llm(provider="openai")
        
        # Custom model
        llm = get_llm(model="deepseek-reasoner", temperature=0.5)
    """
    provider = provider or settings.LLM_PROVIDER.lower()
    
    if provider == "deepseek":
        # DeepSeek API (compatible with OpenAI API)
        api_key = settings.DEEPSEEK_API_KEY
        base_url = settings.DEEPSEEK_BASE_URL
        model_name = model or settings.DEEPSEEK_MODEL
        
        if not api_key:
            raise ValueError(
                "DEEPSEEK_API_KEY is not set. "
                "Please set it in .env file: DEEPSEEK_API_KEY=sk-..."
            )
        
        return ChatOpenAI(
            model=model_name,
            openai_api_key=api_key,
            openai_api_base=base_url,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    
    elif provider == "openai":
        # OpenAI API
        api_key = settings.OPENAI_API_KEY
        model_name = model or settings.OPENAI_MODEL
        
        if not api_key:
            raise ValueError(
                "OPENAI_API_KEY is not set. "
                "Please set it in .env file: OPENAI_API_KEY=sk-..."
            )
        
        return ChatOpenAI(
            model=model_name,
            openai_api_key=api_key,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    
    else:
        raise ValueError(
            f"Unknown LLM provider: {provider}. "
            "Supported providers: 'deepseek', 'openai'"
        )


def get_triage_llm() -> BaseChatModel:
    """
    Get optimized LLM for Email Triage Agent
    
    Configuration:
    - Lower temperature (0.2) for consistent classification
    - Sufficient tokens (2048) for summary generation
    - Uses DeepSeek by default (cost-efficient)
    """
    return get_llm(
        temperature=0.2,  # Lower temperature for consistent classification
        max_tokens=2048,  # Enough for summary + structured output
        provider="deepseek"  # Use DeepSeek for cost efficiency
    )


def get_chat_llm() -> BaseChatModel:
    """
    Get optimized LLM for Chat Agents (Thread Chat, Assist Chat)
    
    Configuration:
    - Moderate temperature (0.7) for natural conversation
    - More tokens (4096) for longer responses
    """
    return get_llm(
        temperature=0.7,  # More creative for chat
        max_tokens=4096,  # Longer responses
        provider="deepseek"
    )
