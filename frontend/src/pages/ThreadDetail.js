import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import ThreadChatPanel from '../components/thread/ThreadChatPanel';
import './ThreadDetail.css';

function ThreadDetail() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email'); // 从 URL 参数获取邮箱

  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    loadThreadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, email]);

  const loadThreadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = email ? { email } : {};
      const response = await api.get(`/gmail/threads/${threadId}`, { params });
      setThread(response.data);
      // Update email from thread response if available (thread's actual email account)
      if (response.data.email_account && response.data.email_account !== email) {
        // Thread belongs to a different email account, but we'll use the one from response
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load thread');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const formatEmailAddress = (addressStr) => {
    if (!addressStr) return 'Unknown';
    // Extract email from "Name <email@example.com>" format
    const match = addressStr.match(/<(.+)>/);
    return match ? match[1] : addressStr;
  };

  const formatEmailName = (addressStr) => {
    if (!addressStr) return '';
    const match = addressStr.match(/^(.+?)\s*</);
    return match ? match[1].replace(/"/g, '') : '';
  };

  if (loading) {
    return (
      <div className="thread-detail-container">
        <div className="loading">Loading thread...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="thread-detail-container">
        <div className="error-message">
          <h2>Error loading thread</h2>
          <p>{error}</p>
          <button className="btn-primary" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!thread || !thread.messages || thread.messages.length === 0) {
    return (
      <div className="thread-detail-container">
        <div className="error-message">
          <h2>Thread not found</h2>
          <button className="btn-primary" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const firstMessage = thread.messages[0];
  const subject = firstMessage.subject || '(No Subject)';

  return (
    <div className="thread-detail-container">
      <div className="thread-header">
        <button className="btn-back" onClick={() => navigate('/dashboard')}>
          ← Back to Dashboard
        </button>
        <h1>{subject}</h1>
        <div className="thread-info">
          <span>
            {thread.message_count} message{thread.message_count !== 1 ? 's' : ''}
          </span>
          <a
            href={`https://mail.google.com/mail/u/0/#all/${threadId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-gmail"
            title="View in Gmail"
          >
            Go to Gmail
          </a>
          <button
            className="btn-chat"
            onClick={() => setShowChat(!showChat)}
            title={showChat ? 'Close Chat' : 'Open Chat'}
          >
            {showChat ? '✕' : '💬'} Chat
          </button>
        </div>
      </div>

      <div className="thread-content">
        {thread.messages.map((message, index) => {
          const emailAddress = formatEmailAddress(message.from);
          const emailName = formatEmailName(message.from);
          const isUnread = message.label_ids && message.label_ids.includes('UNREAD');

          return (
            <div
              key={message.message_id || index}
              className={`message-item ${isUnread ? 'unread' : ''}`}
            >
              <div className="message-header">
                <div className="message-from">
                  {emailName ? (
                    <>
                      <span className="sender-name">{emailName}</span>
                      <span className="sender-email">&lt;{emailAddress}&gt;</span>
                    </>
                  ) : (
                    <span className="sender-email">{emailAddress}</span>
                  )}
                </div>
                <div className="message-date">{formatDate(message.date)}</div>
              </div>

              <div className="message-recipients">
                {message.to && (
                  <div className="recipient-line">
                    <strong>To:</strong> {message.to}
                  </div>
                )}
                {message.cc && (
                  <div className="recipient-line">
                    <strong>CC:</strong> {message.cc}
                  </div>
                )}
              </div>

              {message.label_ids && message.label_ids.length > 0 && (
                <div className="message-labels">
                  {message.label_ids.map((label, labelIndex) => (
                    <span key={labelIndex} className="label-tag">
                      {label}
                    </span>
                  ))}
                </div>
              )}

              <div className="message-body">
                {message.body ? (
                  <div className="body-text">
                    {message.body.split('\n').map((line, lineIndex) => (
                      <div key={lineIndex}>{line || '\u00A0'}</div>
                    ))}
                  </div>
                ) : message.snippet ? (
                  <div className="body-snippet">{message.snippet}</div>
                ) : (
                  <div className="body-snippet">(No content)</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className={`thread-chat-wrapper ${showChat ? 'open' : ''}`}>
        <ThreadChatPanel
          threadId={threadId}
          email={thread?.email_account || email}
          onClose={() => setShowChat(false)}
        />
        <div className="thread-chat-overlay" onClick={() => setShowChat(false)} />
      </div>
    </div>
  );
}

export default ThreadDetail;
