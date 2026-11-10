import WorkspaceIcon from '../workspace/WorkspaceIcon';
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import '../thread/ThreadChatPanel.css';

const quickActions = [
  { action: 'reply_queue', label: 'Needs a reply', prompt: 'Which emails need a reply this week? Show the next action for each.' },
  { action: 'unread', label: 'Find unread', prompt: 'Find unread emails from the past seven days. Use live Gmail search.' },
  { action: 'attachments', label: 'Find attachments', prompt: 'Find recent conversations with PDF attachments and link to them.' },
  { action: 'agenda', label: 'Upcoming meetings', prompt: 'What is on my calendar over the next seven days?' },
];

const toolLabels = {
  search_mailbox: 'Searching Gmail',
  search_mailbox_fuzzy: 'Matching spelling variations',
  search_emails_rag: 'Searching by meaning',
  search_related_threads: 'Finding related conversations',
  list_thread_attachments: 'Checking attachments',
  list_upcoming_events: 'Reading the calendar',
  get_important_emails: 'Checking emails that need attention',
  query_triage_results: 'Checking emails that need attention',
  get_thread: 'Reading the conversation',
};

function sourcePath(source) {
  const account = source.email ? `?${new URLSearchParams({ email: source.email })}` : '';
  return `/thread/${encodeURIComponent(source.thread_id)}${account}`;
}

function AssistChatPanel({ onClose, selectedEmail, isOpen }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [width, setWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState([]);
  const [requestNotice, setRequestNotice] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const requestRef = useRef(null);
  const messagesPane = useRef(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (isOpen && !loading && !isMinimized) inputRef.current?.focus();
  }, [isOpen, loading, isMinimized]);

  useEffect(() => {
    const pane = messagesPane.current;
    if (pane && messagesEndRef.current) pane.scrollTop = pane.scrollHeight;
  }, [messages, thinkingSteps]);

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
          
          const toolCalls = msg.tool_calls || [];
          const usedWebSearch = msg.used_web_search === true || toolCalls.some((t) => (t.tool || t.name) === 'web_search');
          return {
            role: msg.role,
            content: processedContent,
            timestamp: new Date(msg.timestamp || Date.now()),
            tool_calls: toolCalls,
            citations: msg.citations || [],
            sources: msg.sources || [],
            used_web_search: usedWebSearch,
          };
        });
        setMessages(processedMessages);
        setSessionId(sessionIdToLoad);
        setThinkingSteps([]);
        setRequestNotice('');
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
    setThinkingSteps([]);
    setRequestNotice('');
    setShowSessionList(false);
  };

  const handleSend = async (value = input, action) => {
    const userMessage = value.trim();
    if (!userMessage || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setInput('');
    setMessages(previous => [...previous, { role: 'user', content: userMessage, timestamp: new Date() }]);
    setLoading(true);
    setRequestNotice('');
    setThinkingSteps([]);

    try {
      const history = sessionId ? undefined : messages.slice(-12).map(({ role, content }) => ({ role, content }));
      const response = await fetch(`${api.defaults.baseURL}/assist-chat/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          question: userMessage, action, session_id: sessionId,
          conversation_history: history, email: selectedEmail || null,
        }),
      });
      if (!response.ok || !response.body) throw new Error(`Copilot request failed (${response.status}).`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult;
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));
            if (data.type === 'step') setThinkingSteps(previous => [...previous.slice(-7), data.step]);
            if (data.type === 'result') finalResult = data;
            if (data.type === 'error') throw new Error(data.error);
          }
        }
      } finally {
        if (!finalResult) await reader.cancel().catch(() => {});
        reader.releaseLock();
      }

      if (!finalResult?.success) throw new Error(finalResult?.error || 'Copilot did not return a response.');
      setSessionId(finalResult.session_id || null);
      setMessages(previous => [...previous, {
        role: 'assistant', content: finalResult.answer,
        citations: finalResult.citations || [], sources: finalResult.sources || [],
        tool_calls: finalResult.tool_calls || [], used_web_search: !!finalResult.used_web_search, timestamp: new Date(),
      }]);
      if (showSessionList) loadSessions();
    } catch (error) {
      if (!controller.signal.aborted) setMessages(previous => [...previous, {
        role: 'assistant', content: error.message, isError: true, timestamp: new Date(),
      }]);
    } finally {
      requestRef.current = null;
      setLoading(false);
    }
  };

  const stopResponse = () => {
    requestRef.current?.abort();
    setRequestNotice('Response stopped. You can ask another question.');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
    setRequestNotice('');
  };

  // Function to extract thread IDs from a single message
  const extractThreadIdsFromMessage = (msg) => {
    const threadIds = new Set((msg.sources || []).map(source => source.thread_id));
    
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
          className="workspace-link"
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
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (showSessionList) setShowSessionList(false);
          else onClose();
        }
      }}
      className={`thread-chat-panel ${isMinimized ? 'minimized' : ''}`}
      style={{ width: `${width}px` }}
    >
      <div className="thread-chat-resizer" onMouseDown={handleMouseDown} />
      <div className="thread-chat-header">
        <div className="thread-chat-title">
          <WorkspaceIcon name="spark" className="chat-icon" />
          <span>Inbox Copilot</span>
        </div>
        <div className="thread-chat-actions">
          <button
            className="chat-action-btn"
            onClick={() => { if (!showSessionList) loadSessions(); setShowSessionList(!showSessionList); }}
            disabled={loading}
            aria-expanded={showSessionList}
            title="Session history"
          >
            <WorkspaceIcon name="history" />
          </button>
          {messages.length > 0 && (
            <button
              className="chat-action-btn clear-btn"
              onClick={handleClearHistory}
              disabled={loading}
              title="Clear conversation"
            >
              <WorkspaceIcon name="trash" />
            </button>
          )}
          <button
            className="chat-action-btn"
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            <WorkspaceIcon name="chevron" className={isMinimized ? 'workspace-rotated' : ''} />
          </button>
          <button className="chat-action-btn" onClick={onClose} title="Close">
            <WorkspaceIcon name="close" />
          </button>
        </div>
      </div>

      {showSessionList && (
        <div className="workspace-session-list">
          <button type="button" className="btn-secondary" onClick={startNewSession} disabled={loading}>
            <WorkspaceIcon name="add" /> New conversation
          </button>
          {sessions.map(session => (
            <button type="button" key={session.session_id} className="workspace-session-row"
              onClick={() => loadSession(session.session_id)} disabled={loading}>
              <strong>{session.preview}</strong>
              <small>{new Date(session.updated_at).toLocaleString()}</small>
            </button>
          ))}
        </div>
      )}

      {!isMinimized && (
        <>
          <div className="thread-chat-messages" ref={messagesPane}>
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <p className="workspace-copilot-description">Search mail, find attachments, and check your schedule.</p>
                <div className="quick-actions">
                  {quickActions.map((action, idx) => (
                    <button
                      key={idx}
                      className="quick-action-btn"
                      onClick={() => handleSend(action.prompt, action.action)}
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
                        {msg.sources?.length > 0 && (
                          <div className="workspace-copilot-sources" aria-label="Source conversations">
                            {msg.sources.map(source => (
                              <Link to={sourcePath(source)} key={sourcePath(source)}>
                                <WorkspaceIcon name="link" /> {source.subject || source.thread_id}
                              </Link>
                            ))}
                          </div>
                        )}
                        {msg.used_web_search && (
                          <div
                            className="message-web-search-badge"
                            title="This reply used web search for current information."
                          >
                            Used web search for this reply
                          </div>
                        )}
                      </div>
                      <div className="message-timestamp">
                        {msg.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  );
                })}
                {(loading || requestNotice) && (
                  <div className="workspace-copilot-progress">
                    <p className="workspace-copilot-status" role="status">
                      {requestNotice || toolLabels[thinkingSteps.at(-1)?.tool] || thinkingSteps.at(-1)?.content || 'Preparing Copilot…'}
                    </p>
                    {loading && <button type="button" className="workspace-quiet" onClick={stopResponse}>Stop</button>}
                  </div>
                )}
                {thinkingSteps.some(step => step.type === 'tool_result') && (
                  <details className="workspace-copilot-activity">
                    <summary>What Copilot checked</summary>
                    <ul>
                      {thinkingSteps.filter(step => step.type === 'tool_result').map((step, index) => (
                        <li key={index}>
                          <span>{toolLabels[step.tool] || 'Tool'}</span>
                          <small>{step.summary}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          <div className="thread-chat-input-container">
            {messages.length > 0 && (
              <details className="workspace-copilot-activity workspace-shortcuts">
                <summary>Quick actions</summary>
                <div className="quick-actions">
                  {quickActions.map(action => (
                    <button key={action.action} type="button" className="quick-action-btn"
                      disabled={loading} onClick={() => handleSend(action.prompt, action.action)}>
                      {action.label}
                    </button>
                  ))}
                </div>
              </details>
            )}
            <div className="input-wrapper">
              <textarea
                ref={inputRef}
                className="thread-chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Ask about your emails..."
                rows={1}
                disabled={loading}
              />
              <button
                className="send-button"
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                aria-label="Send message"
              >
                {loading ? '…' : <WorkspaceIcon name="send" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default AssistChatPanel;
