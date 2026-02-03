import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function EmailThreadsCard({
  loadingThreads,
  onRefreshEmails,
  onLoadMore,
  hasMore,
  syncing,
  onSyncInbox,
  emailThreads,
  onOpenThread,
  daysFilter,
  onDaysFilterChange,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isStandalonePage = location.pathname === '/threads';

  return (
    <div className="card" style={isStandalonePage ? { maxWidth: '100%', width: '100%' } : {}}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <h2>Email Threads</h2>
        {!isStandalonePage && (
          <button 
            onClick={() => navigate('/threads')}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: '#1976d2', 
              cursor: 'pointer',
              fontSize: '0.9em',
              textDecoration: 'underline'
            }}
          >
            View Full Page →
          </button>
        )}
      </div>
      <div
        style={{
          marginTop: '16px',
          marginBottom: '16px',
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          className="btn-primary"
          onClick={onRefreshEmails} 
          disabled={loadingThreads}
          style={{
            height: '38px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '130px'
          }}
        >
          {loadingThreads ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Loading...
              <span className="spinner" style={{ lineHeight: 0, alignSelf: 'center' }}></span>
            </span>
          ) : (
            'Refresh Emails'
          )}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <label style={{ fontSize: '0.85em', color: '#666' }}>Time Range:</label>
          <select
            value={daysFilter || '14'}
            onChange={(e) => onDaysFilterChange(parseInt(e.target.value))}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '0.85em',
              backgroundColor: '#fff',
              color: '#333',
              outline: 'none'
            }}
          >
            <option value="1">Today</option>
            <option value="3">Last 3 Days</option>
            <option value="7">Last Week</option>
            <option value="14">Last 2 Weeks</option>
            <option value="30">Last Month</option>
          </select>
        </div>
      </div>

      {emailThreads && (
        <div className={`test-result ${emailThreads.success ? 'success' : 'error'}`}>
          {emailThreads.success ? (
            <div>
              <p>
                ✓ Found {emailThreads.data.thread_count} threads (Total estimated:{' '}
                {emailThreads.data.total_estimated})
              </p>

              {emailThreads.data.threads && emailThreads.data.threads.length > 0 && (
                <div className="email-list" style={{ marginTop: '20px' }}>
                  <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                    {emailThreads.data.threads.map((thread, index) => (
                      <div
                        key={thread.thread_id || index}
                        className="email-item"
                        style={{
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          padding: '16px',
                          marginBottom: '12px',
                          backgroundColor: '#f9f9f9',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s',
                        }}
                        onClick={() => onOpenThread(thread.thread_id)}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f0f0f0')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#f9f9f9')}
                      >
                        <div style={{ marginBottom: '8px' }}>
                          <strong>From:</strong> {thread.from}
                        </div>
                        <div style={{ marginBottom: '8px' }}>
                          <strong>Subject:</strong> {thread.subject}
                        </div>
                        <div style={{ marginBottom: '8px', fontSize: '0.9em', color: '#666' }}>
                          <strong>Date:</strong> {thread.date}
                        </div>
                        {thread.snippet && (
                          <div
                            style={{
                              marginTop: '8px',
                              padding: '8px',
                              backgroundColor: '#fff',
                              borderRadius: '4px',
                              fontSize: '0.9em',
                              color: '#555',
                            }}
                          >
                            {thread.snippet}
                          </div>
                        )}
                        <div style={{ marginTop: '8px', fontSize: '0.8em', color: '#888' }}>
                          {thread.message_count} message(s) in thread
                        </div>
                      </div>
                    ))}
                  </div>

                  {hasMore && (
                    <div style={{ marginTop: '20px', textAlign: 'center' }}>
                      <button
                        className="btn-primary"
                        onClick={onLoadMore}
                        disabled={loadingThreads}
                        style={{
                          backgroundColor: '#f5f5f5',
                          color: '#2e7d32',
                          border: '1px solid #2e7d32',
                          padding: '8px 24px',
                        }}
                      >
                        {loadingThreads ? 'Loading...' : 'Load More History'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p>✗ Error: {emailThreads.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
