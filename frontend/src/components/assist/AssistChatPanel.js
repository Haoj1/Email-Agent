import WorkspaceIcon from '../workspace/WorkspaceIcon';
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import FollowUpAction from '../followups/FollowUpAction';
import '../thread/ThreadChatPanel.css';

const quickActions = [
  { action: 'follow_ups', label: 'Follow-ups', prompt: 'Show my open follow-ups.' },
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
  list_follow_ups: 'Checking follow-ups',
  prepare_follow_up: 'Preparing a follow-up action',
};

function sourcePath(source) {
  const account = source.email ? `?${new URLSearchParams({ email: source.email })}` : '';
  return `/thread/${encodeURIComponent(source.thread_id)}${account}`;
}

function AssistChatPanel({ onClose, selectedEmail, isOpen, mailboxCount, embedded = false }) {
  const [allMailboxes, setAllMailboxes] = useState(false);
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
  const [sessionsOffset, setSessionsOffset] = useState(null);
  const [messageOffset, setMessageOffset] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const historyRequest = useRef(null);
  const savedScroll = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const requestRef = useRef(null);
  const messagesPane = useRef(null);
  useEffect(() => () => {
    requestRef.current?.abort();
    historyRequest.current?.abort();
  }, []);
  useEffect(() => {
    if (isOpen && !loading && !isMinimized) inputRef.current?.focus();
  }, [isOpen, loading, isMinimized]);

  useEffect(() => {
    const pane = messagesPane.current;
    if (!pane || !messagesEndRef.current) return;
    const saved = savedScroll.current;
    pane.scrollTop = saved ? saved.top + pane.scrollHeight - saved.height : pane.scrollHeight;
    savedScroll.current = null;
  }, [messages, thinkingSteps]);

  const loadSessions = async (offset = 0) => {
    if (loadingSessions) return;
    setLoadingSessions(true);
    setHistoryError('');
    try {
      const { data } = await api.get('/assist-chat/sessions', { params: { limit: 20, offset } });
      setSessions(previous => offset ? [...previous, ...(data.sessions || [])] : data.sessions || []);
      setSessionsOffset(data.next_offset ?? null);
    } catch {
      setHistoryError('Could not open conversation history.');
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadSession = async (id, offset = 0) => {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setLoadingHistory(true);
    setHistoryError('');
    try {
      const { data } = await api.get(`/assist-chat/sessions/${encodeURIComponent(id)}`, {
        params: { limit: 30, offset }, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const loaded = (data.conversation_history || []).map(entry => ({
        ...entry, timestamp: entry.timestamp ? new Date(entry.timestamp) : null,
      }));
      if (offset && messagesPane.current) {
        savedScroll.current = { top: messagesPane.current.scrollTop, height: messagesPane.current.scrollHeight };
      }
      setMessages(previous => offset ? [...loaded, ...previous] : loaded);
      setMessageOffset(data.next_offset ?? null);
      setSessionId(id);
      setShowSessionList(false);
      setThinkingSteps([]);
      setRequestNotice('');
    } catch {
      if (!controller.signal.aborted) setHistoryError('Could not load this conversation.');
    } finally {
      if (!controller.signal.aborted) setLoadingHistory(false);
    }
  };

  const startNewSession = () => {
    historyRequest.current?.abort();
    setLoadingHistory(false);
    setHistoryError('');
    setMessageOffset(null);
    setMessages([]);
    setSessionId(null);
    setThinkingSteps([]);
    setRequestNotice('');
    setShowSessionList(false);
  };

  const handleSend = async (value = input, action) => {
    const userMessage = value.trim();
    if (!userMessage || requestRef.current || loadingHistory) return;
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
          semantic_scope: allMailboxes ? "all" : "selected",
          local_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      if (finalResult.history_saved === false) setRequestNotice('This reply is here, but could not be saved to history.');
      if (sessionId && finalResult.session_id === sessionId) {
        setMessageOffset(previous => previous === null ? null : previous + 2);
      } else {
        setMessageOffset(null);
      }
      setMessages(previous => [...previous, {
        role: 'assistant', content: finalResult.answer,
        citations: finalResult.citations || [], sources: finalResult.sources || [],
        follow_up_actions: finalResult.follow_up_actions || [],
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
            navigate(href, { state: { backTo: embedded ? '/assistant' : '/dashboard' } });
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
          else onClose?.();
        }
      }}
      className={`thread-chat-panel ${isMinimized ? 'minimized' : ''}${embedded ? ' assistant-embedded' : ''}`}
      style={embedded ? undefined : { width: `${width}px` }}
    >
      {!embedded && <div className="thread-chat-resizer" onMouseDown={handleMouseDown} />}
      <div className="thread-chat-header">
        <div className="thread-chat-title">
          <WorkspaceIcon name="spark" className="chat-icon" />
          {embedded ? <h1>Inbox Copilot</h1> : <span>Inbox Copilot</span>}
        </div>
        <div className="thread-chat-actions">
          <button
            className="chat-action-btn"
            onClick={() => { if (!showSessionList) loadSessions(); setShowSessionList(!showSessionList); }}
            disabled={loading}
            aria-expanded={showSessionList}
            title="Chat history"
          >
            <WorkspaceIcon name="history" />
          </button>
          <button type="button" className="chat-action-btn" onClick={startNewSession}
            title="New chat" disabled={loading || loadingHistory}>
            <WorkspaceIcon name="add" />
          </button>
          {!embedded && <button
            className="chat-action-btn"
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            <WorkspaceIcon name="chevron" className={isMinimized ? 'workspace-rotated' : ''} />
          </button>}
          {!embedded && <button className="chat-action-btn" onClick={onClose} title="Close">
            <WorkspaceIcon name="close" />
          </button>}
        </div>
      </div>

      {showSessionList && (
        <div className="workspace-session-list">
          <button type="button" className="btn-secondary" onClick={startNewSession} disabled={loading}>
            <WorkspaceIcon name="add" /> New conversation
          </button>
          {loadingSessions && <p className="workspace-copilot-status" role="status">Loading history…</p>}
          {!loadingSessions && !sessions.length && !historyError && <p className="workspace-copilot-status">No saved conversations yet.</p>}
          {sessions.map(session => (
            <button type="button" key={session.session_id} className="workspace-session-row"
              aria-current={session.session_id === sessionId ? 'true' : undefined}
              onClick={() => loadSession(session.session_id)} disabled={loading}>
              <strong>{session.preview}</strong>
              <small>{new Date(session.updated_at).toLocaleString()}</small>
            </button>
          ))}
          {sessionsOffset !== null && <button type="button" className="workspace-quiet"
            onClick={() => loadSessions(sessionsOffset)} disabled={loadingSessions}>Older chats</button>}
          {historyError && <p className="workspace-copilot-status" role="alert">{historyError}</p>}

        </div>
      )}

      {!isMinimized && (
        <>
          <div className="thread-chat-messages" ref={messagesPane}>
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <p className="workspace-copilot-description">Search mail, find attachments, and check your schedule.</p>
                <div className="quick-actions">
                  {quickActions.map(action => (
                    <button
                      key={action.action}
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
                {messageOffset !== null && <button type="button" className="workspace-quiet workspace-earlier"
                  disabled={loading || loadingHistory} onClick={() => loadSession(sessionId, messageOffset)}>
                  {loadingHistory ? 'Loading earlier messages…' : 'Earlier messages'}
                </button>}
                {historyError && !showSessionList && <p className="workspace-copilot-status" role="alert">{historyError}</p>}
                {messages.map((msg, idx) => {
                  return (
                    <div
                      key={msg.id ? `saved-${msg.id}` : `local-${idx}`}
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
                              <Link to={sourcePath(source)} key={sourcePath(source)}
                                state={{ backTo: embedded ? '/assistant' : '/dashboard' }}>
                                <WorkspaceIcon name="link" /> {source.subject || source.thread_id}
                              </Link>
                            ))}
                          </div>
                        )}
                        {msg.follow_up_actions?.map(action => (
                          <FollowUpAction key={sourcePath(action)} action={action} />
                        ))}
                        {msg.used_web_search && (
                          <div
                            className="message-web-search-badge"
                            title="This reply used web search for current information."
                          >
                            Used web search for this reply
                          </div>
                        )}
                      </div>
                      {msg.timestamp && <div className="message-timestamp">
                        {msg.timestamp.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                      </div>}
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
            {mailboxCount > 1 && <label className="workspace-ai-review">
              <input type="checkbox" checked={allMailboxes} disabled={loading}
                onChange={event => setAllMailboxes(event.target.checked)} />
              <span>Search for similar emails in all mailboxes</span>
            </label>}
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
                placeholder="Ask about your emails or type /web for public search…"
                rows={1}
                disabled={loading || loadingHistory}
              />
              <button
                className="send-button"
                onClick={() => handleSend()}
                disabled={!input.trim() || loading || loadingHistory}
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
