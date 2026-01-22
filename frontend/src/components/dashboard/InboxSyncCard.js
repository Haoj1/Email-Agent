import React from 'react';

export default function InboxSyncCard({ syncResult, onOpenThread }) {
  return (
    <div className="card">
      <h2>Inbox Sync (Normalized)</h2>

      {syncResult && (
        <div className={`test-result ${syncResult.success ? 'success' : 'error'}`}>
          {syncResult.success ? (
            <div>
              <p>✓ Successfully synced {syncResult.data.thread_count} threads</p>
              <p style={{ fontSize: '0.9em', color: '#666' }}>
                Synced at: {new Date(syncResult.data.synced_at).toLocaleString()}
              </p>

              {syncResult.data.threads && syncResult.data.threads.length > 0 && (
                <div className="email-list" style={{ marginTop: '20px' }}>
                  <h4>Normalized Threads:</h4>
                  <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                    {syncResult.data.threads.map((thread, index) => (
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
                          <strong>Thread ID:</strong> {thread.thread_id}
                        </div>
                        <div style={{ marginBottom: '8px' }}>
                          <strong>Subject:</strong> {thread.subject}
                        </div>
                        <div style={{ marginBottom: '8px', fontSize: '0.9em', color: '#666' }}>
                          <strong>From:</strong> {thread.participants?.from || 'N/A'}
                        </div>
                        <div style={{ marginBottom: '8px', fontSize: '0.9em', color: '#666' }}>
                          <strong>To:</strong> {thread.participants?.to?.join(', ') || 'N/A'}
                        </div>
                        {thread.participants?.cc && thread.participants.cc.length > 0 && (
                          <div style={{ marginBottom: '8px', fontSize: '0.9em', color: '#666' }}>
                            <strong>CC:</strong> {thread.participants.cc.join(', ')}
                          </div>
                        )}
                        <div style={{ marginBottom: '8px', fontSize: '0.9em', color: '#666' }}>
                          <strong>Latest Date:</strong>{' '}
                          {new Date(thread.latest_message_date).toLocaleString()}
                        </div>
                        <div style={{ marginBottom: '8px', fontSize: '0.9em', color: '#666' }}>
                          <strong>Messages:</strong> {thread.message_count}
                        </div>
                        <div style={{ marginBottom: '8px', fontSize: '0.9em' }}>
                          <strong>Unread:</strong> {thread.is_unread ? 'Yes' : 'No'}
                        </div>
                        {thread.labels && thread.labels.length > 0 && (
                          <div style={{ marginTop: '8px', fontSize: '0.8em' }}>
                            <strong>Labels:</strong> {thread.labels.join(', ')}
                          </div>
                        )}
                        {thread.messages && thread.messages.length > 0 && (
                          <details style={{ marginTop: '12px' }}>
                            <summary
                              style={{
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                color: '#1976d2',
                              }}
                            >
                              View Messages ({thread.messages.length})
                            </summary>
                            <div style={{ marginTop: '8px', paddingLeft: '16px' }}>
                              {thread.messages.map((msg, msgIndex) => (
                                <div
                                  key={msg.message_id || msgIndex}
                                  style={{
                                    border: '1px solid #e0e0e0',
                                    borderRadius: '4px',
                                    padding: '12px',
                                    marginBottom: '8px',
                                    backgroundColor: '#fff',
                                  }}
                                >
                                  <div style={{ marginBottom: '4px' }}>
                                    <strong>From:</strong> {msg.from}
                                  </div>
                                  <div style={{ marginBottom: '4px', fontSize: '0.9em', color: '#666' }}>
                                    <strong>Date:</strong> {new Date(msg.date).toLocaleString()}
                                  </div>
                                  {msg.snippet && (
                                    <div
                                      style={{
                                        marginTop: '8px',
                                        padding: '8px',
                                        backgroundColor: '#f5f5f5',
                                        borderRadius: '4px',
                                        fontSize: '0.85em',
                                        color: '#555',
                                      }}
                                    >
                                      {msg.snippet}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p>✗ Error: {syncResult.error}</p>
          )}
        </div>
      )}

      {!syncResult && (
        <div
          style={{
            padding: '16px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            color: '#666',
          }}
        >
          Click "Sync Inbox (Normalize)" to fetch and normalize email threads from Gmail API.
        </div>
      )}
    </div>
  );
}

