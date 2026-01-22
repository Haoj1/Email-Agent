import React from 'react';

export default function EmailThreadsCard({
  loadingThreads,
  onRefreshEmails,
  syncing,
  onSyncInbox,
  emailThreads,
  onOpenThread,
}) {
  return (
    <div className="card">
      <h2>Email Threads</h2>
      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={onRefreshEmails} disabled={loadingThreads}>
          {loadingThreads ? 'Loading...' : 'Refresh Emails'}
        </button>
        <button
          className="btn-primary"
          onClick={onSyncInbox}
          disabled={syncing}
          style={{ backgroundColor: '#2e7d32' }}
        >
          {syncing ? 'Syncing...' : 'Sync Inbox (Normalize)'}
        </button>
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

