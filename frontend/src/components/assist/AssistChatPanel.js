import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import '../thread/ThreadChatPanel.css';

function AssistChatPanel({ onClose, selectedEmail }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [width, setWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const response = await api.get('/assist-chat/sessions', { params: { limit: 20 } });
      if (response.data.success) {
        setSessions(response.data.sessions || []);
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  };

  const loadSession = async (sessionIdToLoad) => {
    try {
      const response = await api.get(`/assist-chat/sessions/${sessionIdToLoad}`);
      if (response.data.success) {
        const history = response.data.conversation_history || [];
        // Process messages to extract thread IDs and convert to links
        const processedMessages = history.map((msg) => {
          // Extract thread IDs from the message (if it has tool_calls or citations)
          const threadIds = extractThreadIdsFromMessage({
            ...msg,
            tool_calls: msg.tool_calls || [],
            citations: msg.citations || []
          });
          
          // Process content to add thread ID links
          const processedContent = processThreadIds(msg.content, threadIds);
          
          return {
            role: msg.role,
            content: processedContent,
            timestamp: new Date(msg.timestamp || Date.now()),
            tool_calls: msg.tool_calls || [],
            citations: msg.citations || [],
          };
        });
        setMessages(processedMessages);
        setSessionId(sessionIdToLoad);
        setShowSessionList(false);
      }
    } catch (error) {
      console.error('Error loading session:', error);
      alert('Failed to load session');
    }
  };

  const startNewSession = () => {
    setMessages([]);
    setSessionId(null);
    setShowSessionList(false);
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');

    // Add user message
    const newUserMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newUserMessage]);
    setLoading(true);
    setThinkingSteps([]);

    try {
      // Build conversation history
      const conversationHistory = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Prepare request body
      const requestBody = {
        question: userMessage,
        session_id: sessionId,
        conversation_history: conversationHistory,
        email: selectedEmail || null,
      };

      // Use fetch for SSE streaming
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
      const response = await fetch(`${API_BASE_URL}/assist-chat/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'step') {
                setThinkingSteps((prev) => [...prev, data.step]);
              } else if (data.type === 'result') {
                finalResult = data;
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      // Process final result
      if (finalResult) {
        if (finalResult.success) {
          if (finalResult.session_id) {
            setSessionId(finalResult.session_id);
          }

          const assistantMessage = {
            role: 'assistant',
            content: finalResult.answer,
            citations: finalResult.citations || [],
            tool_calls: finalResult.tool_calls || [],
            thinking_steps: finalResult.thinking_steps || [],
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
          
          // Reload sessions to update list
          loadSessions();
        } else {
          const errorMessage = {
            role: 'assistant',
            content: `Error: ${finalResult.error || 'Failed to get response'}`,
            isError: true,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, errorMessage]);
        }
      }

      // Keep thinking steps visible for a moment, then clear
      setTimeout(() => setThinkingSteps([]), 2000);
    } catch (error) {
      const errorMessage = {
        role: 'assistant',
        content: `Error: ${error.message || 'Failed to send message'}`,
        isError: true,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;

      const newWidth = window.innerWidth - e.clientX;
      const clampedWidth = Math.max(300, Math.min(800, newWidth));
      setWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleClearHistory = () => {
    setMessages([]);
    setSessionId(null);
    setThinkingSteps([]);
  };

  const quickActions = [
    { label: 'Important Emails', prompt: 'What important emails do I need to reply to?' },
    { label: 'Find Emails', prompt: 'Find emails about project deadlines' },
    { label: 'High Priority', prompt: 'Show me high-priority emails from the last week' },
    { label: 'Need Attention', prompt: 'What emails need my attention?' },
  ];

  const appHelpPrompt = 'What can this email agent app do? How do I use it?';

  const handleQuickAction = (prompt) => {
    setInput(prompt);
    setTimeout(() => {
      handleSend();
    }, 100);
  };

  // Function to extract thread IDs from a single message
  const extractThreadIdsFromMessage = (msg) => {
    const threadIds = new Set();
    
    // Extract from tool_calls
    if (msg.tool_calls) {
      msg.tool_calls.forEach((toolCall) => {
        const result = toolCall.result;
        if (result) {
          // Check for thread_id in various places
          if (result.thread_id) {
            threadIds.add(result.thread_id);
          }
          if (result.results && Array.isArray(result.results)) {
            result.results.forEach((item) => {
              if (item.thread_id) {
                threadIds.add(item.thread_id);
              }
            });
          }
          if (result.threads) {
            if (Array.isArray(result.threads)) {
              result.threads.forEach((thread) => {
                if (thread.thread_id) {
                  threadIds.add(thread.thread_id);
                }
              });
            } else if (typeof result.threads === 'object') {
              Object.values(result.threads).forEach((thread) => {
                if (thread && thread.thread_id) {
                  threadIds.add(thread.thread_id);
                }
              });
            }
          }
        }
      });
    }
    
    // Extract from citations
    if (msg.citations) {
      msg.citations.forEach((citation) => {
        // Citations might be in format "Thread {thread_id}"
        const match = citation.match(/Thread\s+([a-zA-Z0-9_-]{10,30})/i);
        if (match) {
          threadIds.add(match[1]);
        }
      });
    }
    
    return Array.from(threadIds);
  };

  // Function to convert thread IDs in text to clickable links
  const processThreadIds = (text, knownThreadIds = []) => {
    if (!text) return text;
    
    let processedText = text;
    
    // First, replace known thread IDs (from tool calls)
    knownThreadIds.forEach((threadId) => {
      // Create a regex that matches the thread ID but not if it's already in a link
      const escapedId = threadId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(
        `(?<!\\[)${escapedId}(?!\\]\\(/thread/)`,
        'g'
      );
      processedText = processedText.replace(pattern, (match, offset) => {
        // Check if already in a markdown link
        const before = processedText.substring(Math.max(0, offset - 100), offset);
        const after = processedText.substring(offset + match.length, Math.min(processedText.length, offset + match.length + 100));
        
        // Skip if already in a markdown link
        if (before.includes('[') && after.includes('](')) {
          return match;
        }
        
        // Skip if already in a URL
        if (before.match(/https?:\/\/|mailto:/)) {
          return match;
        }
        
        // Skip if it's part of a path
        if (before.includes('/thread/')) {
          return match;
        }
        
        return `[${threadId}](/thread/${threadId})`;
      });
    });
    
    // Also try to find thread IDs in the text
    // Pattern 1: "thread {thread_id}" or "Thread {thread_id}" format (for backward compatibility)
    // Convert to just the ID as a link, removing "thread" prefix for better readability
    const threadWithIdPattern = /(?:^|\s)(?:thread|Thread)\s+([a-zA-Z0-9_-]{10,30})(?=\s|$|[.,;:!?])/gi;
    processedText = processedText.replace(threadWithIdPattern, (match, threadId, offset) => {
      // Check if already in a link
      const before = processedText.substring(Math.max(0, offset - 50), offset);
      if (before.includes('[') && processedText.substring(offset + match.length).includes('](')) {
        return match;
      }
      
      // Convert "thread {id}" to just "[{id}](/thread/{id})" - remove "thread" prefix for readability
      const leadingSpace = match.startsWith(' ') ? ' ' : '';
      return `${leadingSpace}[${threadId}](/thread/${threadId})`;
    });
    
    // Pattern 2: standalone thread IDs (Gmail thread IDs are typically 16-26 alphanumeric chars)
    const threadIdPattern = /\b([a-zA-Z0-9_-]{16,26})\b/g;
    
    processedText = processedText.replace(threadIdPattern, (match, threadId, offset) => {
      // Skip if already processed or in a link
      if (knownThreadIds.includes(threadId)) {
        return match; // Already processed above
      }
      
      // Check if this is already part of a link
      const before = processedText.substring(Math.max(0, offset - 100), offset);
      const after = processedText.substring(offset + match.length, Math.min(processedText.length, offset + match.length + 100));
      
      // Skip if already in a markdown link
      if (before.includes('[') && after.includes('](')) {
        return match;
      }
      
      // Skip if already in a URL
      if (before.match(/https?:\/\/|mailto:/)) {
        return match;
      }
      
      // Skip if it's part of a path
      if (before.includes('/thread/')) {
        return match;
      }
      
      // Skip if it's already part of "thread {id}" format (already processed above)
      if (before.match(/thread\s+$/i)) {
        return match;
      }
      
      // Convert standalone thread ID to link
      return `[${threadId}](/thread/${threadId})`;
    });
    
    return processedText;
  };

  // Custom link component for ReactMarkdown that handles thread links
  const LinkRenderer = ({ href, children, ...props }) => {
    // Check if this is a thread detail link
    if (href && href.startsWith('/thread/')) {
      const threadId = href.replace('/thread/', '');
      // Extract just the thread ID from children (remove "thread " prefix if present)
      const displayText = typeof children === 'string' 
        ? children.replace(/^thread\s+/i, '').trim()
        : threadId;
      
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            navigate(href);
          }}
          style={{ color: '#1976d2', textDecoration: 'none', cursor: 'pointer' }}
          onMouseEnter={(e) => (e.target.style.textDecoration = 'underline')}
          onMouseLeave={(e) => (e.target.style.textDecoration = 'none')}
          {...props}
        >
          {displayText}
        </a>
      );
    }
    
    // Regular links
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  };

  return (
    <div
      ref={panelRef}
      className={`thread-chat-panel ${isMinimized ? 'minimized' : ''}`}
      style={{ width: `${width}px` }}
    >
      <div className="thread-chat-resizer" onMouseDown={handleMouseDown} />
      <div className="thread-chat-header">
        <div className="thread-chat-title">
          <span className="chat-icon">🤖</span>
          <span>Assist Chat</span>
        </div>
        <div className="thread-chat-actions">
          <button
            className="chat-action-btn"
            onClick={() => setShowSessionList(!showSessionList)}
            title="Session history"
          >
            📚
          </button>
          {messages.length > 0 && (
            <button
              className="chat-action-btn clear-btn"
              onClick={handleClearHistory}
              title="Clear conversation"
            >
              🗑️
            </button>
          )}
          <button
            className="chat-action-btn"
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? '▲' : '▼'}
          </button>
          <button className="chat-action-btn" onClick={onClose} title="Close">
            ×
          </button>
        </div>
      </div>

      {showSessionList && (
        <div
          style={{
            position: 'absolute',
            top: '48px',
            left: '0',
            right: '0',
            background: 'white',
            borderBottom: '1px solid #e0e0e0',
            maxHeight: '300px',
            overflowY: 'auto',
            zIndex: 1002,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ padding: '12px', borderBottom: '1px solid #e0e0e0' }}>
            <button
              onClick={startNewSession}
              style={{
                width: '100%',
                padding: '8px',
                background: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              + New Conversation
            </button>
          </div>
          {sessions.map((session) => (
            <div
              key={session.session_id}
              onClick={() => loadSession(session.session_id)}
              style={{
                padding: '12px',
                borderBottom: '1px solid #f0f0f0',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.target.style.background = '#f5f5f5')}
              onMouseLeave={(e) => (e.target.style.background = 'white')}
            >
              <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
                {new Date(session.updated_at).toLocaleString()}
              </div>
              <div style={{ fontSize: '14px', color: '#333' }}>
                {session.preview}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isMinimized && (
        <>
          <div className="thread-chat-messages">
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <p>Ask Inbox Copilot anything about your emails!</p>
                <div className="quick-actions">
                  <button
                    className="quick-action-btn primary"
                    onClick={() => handleQuickAction(appHelpPrompt)}
                    disabled={loading}
                    style={{ marginBottom: '12px' }}
                  >
                    📖 How to Use This App
                  </button>
                  {quickActions.map((action, idx) => (
                    <button
                      key={idx}
                      className="quick-action-btn"
                      onClick={() => handleQuickAction(action.prompt)}
                      disabled={loading}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => {
                  const messageKey = `msg_${idx}_${msg.timestamp?.getTime() || idx}`;

                  return (
                    <div
                      key={idx}
                      className={`chat-message ${msg.role} ${msg.isError ? 'error' : ''}`}
                    >
                      <div className="message-content">
                        {msg.role === 'user' ? (
                          <div className="message-text">{msg.content}</div>
                        ) : (
                          <div className="message-text">
                            <ReactMarkdown
                              components={{
                                a: LinkRenderer,
                              }}
                            >
                              {processThreadIds(msg.content, extractThreadIdsFromMessage(msg))}
                            </ReactMarkdown>
                          </div>
                        )}
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="message-citations">
                            <strong>References:</strong> {msg.citations.join(', ')}
                          </div>
                        )}
                      </div>
                      <div className="message-timestamp">
                        {msg.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  );
                })}
                {loading && (
                  <>
                    <div className="thinking-steps-container">
                      {thinkingSteps.length > 0 ? (
                        thinkingSteps.map((step, idx) => (
                          <div key={idx} className={`thinking-step thinking-step-${step.type}`}>
                            {step.type === 'planning' && (
                              <>
                                <span className="thinking-icon">🧠</span>
                                <span className="thinking-text">{step.content}</span>
                              </>
                            )}
                            {step.type === 'tool_call' && (
                              <>
                                <span className="thinking-icon">🔧</span>
                                <span className="thinking-text">
                                  Calling <strong>{step.tool}</strong>
                                  {step.args && Object.keys(step.args).length > 0 && (
                                    <span className="thinking-args">
                                      {' '}
                                      ({Object.keys(step.args).join(', ')})
                                    </span>
                                  )}
                                </span>
                              </>
                            )}
                            {step.type === 'tool_result' && (
                              <>
                                <span
                                  className={`thinking-icon ${
                                    step.status === 'success' ? 'success' : 'error'
                                  }`}
                                >
                                  {step.status === 'success' ? '✅' : '❌'}
                                </span>
                                <span className="thinking-text">
                                  {step.status === 'success' ? (
                                    step.summary || `${step.tool} completed`
                                  ) : (
                                    <span className="error-text">
                                      {step.tool} failed: {step.error || 'Unknown error'}
                                    </span>
                                  )}
                                </span>
                              </>
                            )}
                            {step.type === 'thinking' && (
                              <>
                                <span className="thinking-icon">💭</span>
                                <span className="thinking-text">{step.content}</span>
                              </>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="thinking-step">
                          <span className="thinking-icon">🧠</span>
                          <span className="thinking-text">Analyzing question...</span>
                        </div>
                      )}
                    </div>
                    <div className="chat-message assistant loading">
                      <div className="message-content">
                        <div className="typing-indicator">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          <div className="thread-chat-input-container">
            <div className="quick-actions-inline">
              {quickActions.slice(0, 2).map((action, idx) => (
                <button
                  key={idx}
                  className="quick-action-btn-small"
                  onClick={() => handleQuickAction(action.prompt)}
                  disabled={loading}
                  title={action.label}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div className="input-wrapper">
              <textarea
                ref={inputRef}
                className="thread-chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask about your emails..."
                rows={1}
                disabled={loading}
              />
              <button
                className="send-button"
                onClick={handleSend}
                disabled={!input.trim() || loading}
              >
                {loading ? '...' : '→'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default AssistChatPanel;
