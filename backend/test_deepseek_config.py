"""
Test script to verify DeepSeek configuration
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.config import settings
from app.agents.llm_factory import get_llm, get_triage_llm


def test_config():
    """Test DeepSeek configuration"""
    print("=" * 50)
    print("Testing DeepSeek Configuration")
    print("=" * 50)
    
    # Check config
    print(f"\n1. LLM Provider: {settings.LLM_PROVIDER}")
    print(f"2. DeepSeek API Key: {'✓ Set' if settings.DEEPSEEK_API_KEY else '✗ Not set'}")
    print(f"3. DeepSeek Base URL: {settings.DEEPSEEK_BASE_URL}")
    print(f"4. DeepSeek Model: {settings.DEEPSEEK_MODEL}")
    
    if not settings.DEEPSEEK_API_KEY:
        print("\n❌ Error: DEEPSEEK_API_KEY is not set!")
        print("Please add it to backend/.env file:")
        print("DEEPSEEK_API_KEY=sk-your-key-here")
        return False
    
    # Test LLM initialization
    try:
        print("\n5. Testing LLM initialization...")
        llm = get_triage_llm()
        print(f"   ✓ LLM initialized successfully")
        print(f"   Model: {llm.model_name}")
        print(f"   Base URL: {llm.openai_api_base}")
        print(f"   Temperature: {llm.temperature}")
        print(f"   Max Tokens: {llm.max_tokens}")
        
        # Test a simple call (optional, comment out to skip API call)
        print("\n6. Testing API call (optional)...")
        print("   Uncomment the code below to test actual API call")
        # response = llm.invoke("Say 'Hello' in one word")
        # print(f"   ✓ API Response: {response.content}")
        
        print("\n✅ Configuration test passed!")
        return True
        
    except Exception as e:
        print(f"\n❌ Error initializing LLM: {e}")
        return False


if __name__ == "__main__":
    success = test_config()
    sys.exit(0 if success else 1)
