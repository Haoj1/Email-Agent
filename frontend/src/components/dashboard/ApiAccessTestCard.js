import React from 'react';

export default function ApiAccessTestCard({
  testing,
  onTestGmail,
  onTestCalendar,
  gmailTest,
  calendarTest,
}) {
  return (
    <div className="card">
      <h2>API Access Test</h2>
      <p>Test if you can access Gmail and Calendar APIs with your permissions.</p>

      <div className="test-buttons">
        <button className="btn-primary" onClick={onTestGmail} disabled={testing}>
          Test Gmail API
        </button>
        <button className="btn-primary" onClick={onTestCalendar} disabled={testing}>
          Test Calendar API
        </button>
      </div>

      {gmailTest && (
        <div className={`test-result ${gmailTest.success ? 'success' : 'error'}`}>
          <h3>Gmail API Test</h3>
          {gmailTest.success ? (
            <div>
              <p>✓ Successfully accessed Gmail API</p>
              <p>
                Found {gmailTest.data.messageCount} messages (Total:{' '}
                {gmailTest.data.totalMessages || 'N/A'})
              </p>

              {gmailTest.data.messages && gmailTest.data.messages.length > 0 && (
                <div className="email-list" style={{ marginTop: '20px' }}>
                  <h4>Recent Emails:</h4>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {gmailTest.data.messages.map((msg, index) => (
                      <div
                        key={msg.id || index}
                        className="email-item"
                        style={{
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          padding: '12px',
                          marginBottom: '10px',
                          backgroundColor: '#f9f9f9',
                        }}
                      >
                        {msg.error ? (
                          <p style={{ color: '#d32f2f' }}>Error loading message: {msg.error}</p>
                        ) : (
                          <>
                            <div style={{ marginBottom: '8px' }}>
                              <strong>From:</strong> {msg.from}
                            </div>
                            <div style={{ marginBottom: '8px' }}>
                              <strong>Subject:</strong> {msg.subject}
                            </div>
                            <div style={{ marginBottom: '8px', fontSize: '0.9em', color: '#666' }}>
                              <strong>Date:</strong> {msg.date}
                            </div>
                            {msg.snippet && (
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
                                {msg.snippet}
                              </div>
                            )}
                            {msg.labelIds && msg.labelIds.length > 0 && (
                              <div style={{ marginTop: '8px', fontSize: '0.8em' }}>
                                <strong>Labels:</strong> {msg.labelIds.join(', ')}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p>✗ Error: {gmailTest.error}</p>
          )}
        </div>
      )}

      {calendarTest && (
        <div className={`test-result ${calendarTest.success ? 'success' : 'error'}`}>
          <h3>Calendar API Test</h3>
          {calendarTest.success ? (
            <div>
              <p>✓ Successfully accessed Calendar API</p>
              <p>Found {calendarTest.data.eventCount} upcoming events</p>
            </div>
          ) : (
            <p>✗ Error: {calendarTest.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

