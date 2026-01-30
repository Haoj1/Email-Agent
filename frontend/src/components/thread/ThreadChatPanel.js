import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../../services/api';
import './ThreadChatPanel.css';

function ThreadChatPanel({ threadId, email, onClose }) {
  // Load conversation history from localStorage on mount (persists across browser sessions)
  const getCachedMessages = () => {
    try {
      const cacheKey = `thread_chat_${threadId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Convert timestamp strings back to Date objects
        return parsed.map((msg) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }));
      }
    } catch (e) {
      console.error('Error loading cached messages:', e);
    }
    return [];
  };

  const saveCachedMessages = (msgs) => {
    try {
      const cacheKey = `thread_chat_${threadId}`;
      localStorage.setItem(cacheKey, JSON.stringify(msgs));
    } catch (e) {
      console.error('Error saving cached messages:', e);
    }
  };

  const [messages, setMessages] = useState(getCachedMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [width, setWidth] = useState(400); // Default width
  const [isResizing, setIsResizing] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState([]);
  const [copiedMessageId, setCopiedMessageId] = useState(null); // Track which message was copied
  const [loadingType, setLoadingType] = useState(null); // Track loading type: 'chat' or 'draft'
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Save messages to cache whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      saveCachedMessages(messages);
    }
  }, [messages, threadId]);

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
    setLoadingType('chat'); // Set loading type to chat
    setThinkingSteps([]); // Clear previous thinking steps

    try {
      // Build conversation history
      const conversationHistory = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Prepare request body
      const requestBody = {
        thread_id: threadId,
        question: userMessage,
        conversation_history: conversationHistory,
        email: email || null,
      };

      // Use fetch for SSE streaming
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
      const response = await fetch(`${API_BASE_URL}/thread-chat/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for session
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
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'step') {
                // Add new thinking step
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
          // Check if this is a draft generation response
          // Debug: log draft_data to see what we're getting
          console.log('Final result draft_data:', finalResult.draft_data);

          const hasDraft =
            finalResult.draft_data && finalResult.draft_data.subject && finalResult.draft_data.body;

          let content = finalResult.answer;
          let isDraft = false;
          let draftData = null;

          if (hasDraft) {
            // Format as draft message
            isDraft = true;
            draftData = finalResult.draft_data;
            // Clean the body to remove any LLM meta-commentary
            let cleanBody = finalResult.draft_data.body;
            // Remove common LLM artifacts
            cleanBody = cleanBody.replace(/^SUBJECT:.*$/gm, '');
            cleanBody = cleanBody.replace(/^BODY:.*$/gm, '');
            cleanBody = cleanBody.replace(/```[\s\S]*?```/g, '');
            cleanBody = cleanBody.trim();

            content = `**Draft Reply Generated**\n\n**Subject:**\n${
              finalResult.draft_data.subject || '(No subject)'
            }\n\n**Body:**\n${cleanBody}`;

            console.log('Draft detected! isDraft:', isDraft, 'draftData:', draftData);
          }

          const assistantMessage = {
            role: 'assistant',
            content: content,
            citations: finalResult.citations || [],
            tool_calls: finalResult.tool_calls || [],
            thinking_steps: finalResult.thinking_steps || [],
            isDraft: isDraft,
            draftData: draftData,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
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
      // Limit width between 300px and 800px
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

  const handleDraftReply = async (saveToGmail = false) => {
    if (loading) return;
    setLoading(true);
    setLoadingType('draft'); // Set loading type to draft
    setThinkingSteps([]); // Clear previous thinking steps

    // Add user message to show what action was taken
    const userActionMessage = {
      role: 'user',
      content: saveToGmail ? 'Generate and save draft to Gmail' : 'Generate draft reply',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userActionMessage]);

    try {
      // Prepare request body
      const requestBody = {
        thread_id: threadId,
        email: email || null,
        tone: 'professional',
        save_to_gmail: saveToGmail,
      };

      // Use fetch for SSE streaming
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
      const response = await fetch(`${API_BASE_URL}/thread-chat/draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for session
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
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim() === '') continue; // Skip empty lines
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'step') {
                // Add new thinking step
                console.log('Received thinking step:', data.step);
                setThinkingSteps((prev) => {
                  // Avoid duplicates
                  const exists = prev.some(
                    (s) =>
                      s.type === data.step.type &&
                      s.content === data.step.content &&
                      (s.tool || '') === (data.step.tool || ''),
                  );
                  if (exists) return prev;
                  return [...prev, data.step];
                });
              } else if (data.type === 'result') {
                finalResult = data;
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e, 'Line:', line);
            }
          }
        }
      }

      // Process final result
      if (finalResult) {
        if (finalResult.success) {
          // Clean up body for display - remove any JSON or tool call traces
          let cleanBody = finalResult.body || '';
          // Remove JSON-like structures (tool calls)
          cleanBody = cleanBody.replace(/\{[^{}]*"action"[^{}]*\}/g, '');
          cleanBody = cleanBody.replace(/\{[^{}]*"tool"[^{}]*\}/g, '');
          // Remove common thinking patterns
          cleanBody = cleanBody.replace(/I'll\s+[^\.]+\./gi, '');
          cleanBody = cleanBody.replace(/Let me\s+[^\.]+\./gi, '');
          cleanBody = cleanBody.replace(/First,?\s+[^\.]+\./gi, '');
          // Remove markdown code blocks that might contain JSON
          cleanBody = cleanBody.replace(/```[\s\S]*?```/g, '');
          cleanBody = cleanBody.trim();

          const draftMessage = {
            role: 'assistant',
            content: `**Draft Reply Generated**${
              finalResult.gmail_draft_id ? '\n\n✅ **Draft saved to Gmail!**' : ''
            }\n\n**Subject:**\n${finalResult.subject || '(No subject)'}\n\n**Body:**\n${cleanBody}`,
            isDraft: true,
            draftData: {
              subject: finalResult.subject,
              body: cleanBody, // Use cleaned body
              full_draft: finalResult.full_draft,
              gmail_draft_id: finalResult.gmail_draft_id,
            },
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, draftMessage]);
        } else {
          const errorMessage = {
            role: 'assistant',
            content: `Error generating draft: ${finalResult.error || 'Unknown error'}`,
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
        content: `Error: ${error.message || 'Failed to generate draft'}`,
        isError: true,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const quickActions = [
    { label: 'Summarize', prompt: 'Summarize the key points of this email thread.' },
    { label: 'Action Items', prompt: 'What action items or tasks are mentioned in this thread?' },
    {
      label: 'Deadlines',
      prompt: 'Are there any deadlines or time-sensitive information mentioned?',
    },
    { label: 'Participants', prompt: 'Who are the main participants in this conversation?' },
  ];

  const handleQuickAction = (prompt) => {
    setInput(prompt);
    setTimeout(() => {
      handleSend();
    }, 100);
  };

  const handleClearHistory = () => {
    // Clear messages state
    setMessages([]);
    // Clear localStorage
    try {
      const cacheKey = `thread_chat_${threadId}`;
      localStorage.removeItem(cacheKey);
    } catch (e) {
      console.error('Error clearing cached messages:', e);
    }
    // Clear thinking steps if any
    setThinkingSteps([]);
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
          <span className="chat-icon">💬</span>
          <span>Thread Chat</span>
        </div>
        <div className="thread-chat-actions">
          {messages.length > 0 && (
            <button
              className="chat-action-btn clear-btn"
              onClick={handleClearHistory}
              title="Clear conversation history"
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

      {!isMinimized && (
        <>
          <div className="thread-chat-messages">
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <p>Ask me anything about this email thread!</p>
                <div className="quick-actions">
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
                  <button
                    className="quick-action-btn"
                    onClick={() => handleDraftReply(false)}
                    disabled={loading}
                  >
                    Generate Draft
                  </button>
                  <button
                    className="quick-action-btn primary"
                    onClick={() => handleDraftReply(true)}
                    disabled={loading}
                  >
                    Save to Gmail
                  </button>
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => {
                  // Create a stable key for this message
                  const messageKey = `msg_${idx}_${msg.timestamp?.getTime() || idx}`;
                  const isCopied = copiedMessageId === messageKey;

                  return (
                    <div
                      key={idx}
                      className={`chat-message ${msg.role} ${msg.isError ? 'error' : ''} ${
                        msg.isDraft ? 'draft' : ''
                      }`}
                    >
                      <div className="message-content">
                        {msg.role === 'user' ? (
                          <div className="message-text">{msg.content}</div>
                        ) : (
                          <div className="message-text">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        )}
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="message-citations">
                            <strong>References:</strong> {msg.citations.join(', ')}
                          </div>
                        )}
                        {msg.isDraft && msg.draftData && (
                          <div className="draft-actions">
                            <button
                              className={`draft-copy-btn ${isCopied ? 'copied' : ''}`}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(msg.draftData.body);
                                  // Show "Copied" feedback
                                  setCopiedMessageId(messageKey);
                                  // Reset after 2 seconds
                                  setTimeout(() => {
                                    setCopiedMessageId(null);
                                  }, 2000);
                                } catch (err) {
                                  console.error('Failed to copy:', err);
                                }
                              }}
                            >
                              {isCopied ? 'Copied!' : 'Copy Body'}
                            </button>
                            {!msg.draftData.gmail_draft_id && (
                              <button
                                className="draft-save-btn"
                                onClick={async () => {
                                  try {
                                    // Use existing draft data to save
                                    const response = await api.post('/thread-chat/save-draft', {
                                      thread_id: threadId,
                                      subject: msg.draftData.subject,
                                      body: msg.draftData.body,
                                      to: msg.draftData.to,
                                      email: email || null,
                                    });
                                    if (response.data.success && response.data.gmail_draft_id) {
                                      // Update the message to show it's saved
                                      setMessages((prev) =>
                                        prev.map((m, idx) =>
                                          idx === messages.indexOf(msg)
                                            ? {
                                                ...m,
                                                content: m.content.replace(
                                                  '**Draft Reply Generated**',
                                                  '**Draft Reply Generated**\n\n✅ **Draft saved to Gmail!**',
                                                ),
                                                draftData: {
                                                  ...m.draftData,
                                                  gmail_draft_id: response.data.gmail_draft_id,
                                                },
                                              }
                                            : m,
                                        ),
                                      );
                                    }
                                  } catch (error) {
                                    alert(
                                      `Failed to save to Gmail: ${
                                        error.response?.data?.detail || error.message
                                      }`,
                                    );
                                  }
                                }}
                              >
                                Save to Gmail
                              </button>
                            )}
                            {msg.draftData.gmail_draft_id && (
                              <a
                                href="https://mail.google.com/mail/u/0/#drafts"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="draft-view-btn"
                              >
                                View in Gmail
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="message-timestamp">{msg.timestamp.toLocaleTimeString()}</div>
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
                          <span className="thinking-text">
                            {loadingType === 'draft'
                              ? 'Generating draft...'
                              : 'Analyzing question...'}
                          </span>
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
                placeholder="Ask about this thread..."
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

export default ThreadChatPanel;
