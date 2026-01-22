import React from 'react';

export default function EmailTriageCard({
  runningTriage,
  loadingTriageResults,
  triageResults,
  onRunTriage,
  onLoadTriageResults,
  onOpenThread,
}) {
  return (
    <div className="card">
      <h2>Email Triage Agent</h2>
      <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '16px' }}>
        Classify and prioritize your emails using AI. Run triage on recent threads to get
        categories, priority scores, and summaries.
      </p>

      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button
          className="btn-primary"
          onClick={onRunTriage}
          disabled={runningTriage || loadingTriageResults}
          style={{
            backgroundColor: '#7b1fa2',
            height: '38px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
          }}
        >
          {runningTriage ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Running Triage...
              <span className="spinner" style={{ lineHeight: 0, alignSelf: 'center' }}></span>
            </span>
          ) : (
            'Run Triage (Last 10 Threads)'
          )}
        </button>
        <button
          className="btn-primary"
          onClick={onLoadTriageResults}
          disabled={runningTriage || loadingTriageResults}
          style={{
            backgroundColor: '#5c6bc0',
            height: '38px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
          }}
        >
          {loadingTriageResults ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Loading...
              <span className="spinner" style={{ lineHeight: 0, alignSelf: 'center' }}></span>
            </span>
          ) : (
            'Load Triage Results'
          )}
        </button>
      </div>

      {(runningTriage || loadingTriageResults) && !triageResults && (
        <div
          style={{
            padding: '20px',
            textAlign: 'center',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            color: '#666',
          }}
        >
          <div
            className="spinner"
            style={{
              width: '24px',
              height: '24px',
              borderWidth: '3px',
              borderColor: '#7b1fa2',
              borderTopColor: '#fff',
              margin: '0 auto 12px',
            }}
          ></div>
          <p>
            {runningTriage
              ? 'Running triage on emails... (estimated ~1 minute)'
              : 'Loading triage results...'}
          </p>
        </div>
      )}

      {triageResults && (
        <div className={`test-result ${triageResults.success ? 'success' : 'error'}`}>
          {triageResults.success ? (
            <div>
              {triageResults.data.processed_count !== undefined ? (
                <p>✓ Successfully triaged {triageResults.data.processed_count} threads</p>
              ) : (
                <p>✓ Found {triageResults.data.count || 0} triage results</p>
              )}

              {triageResults.data.results && triageResults.data.results.length > 0 && (
                <div className="email-list" style={{ marginTop: '20px' }}>
                  <h4>Triage Results:</h4>
                  <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                    {triageResults.data.results.map((result, index) => {
                      const priorityColor =
                        result.priority >= 0.8
                          ? '#d32f2f'
                          : result.priority >= 0.5
                          ? '#f57c00'
                          : result.priority >= 0.2
                          ? '#1976d2'
                          : '#757575';
                      const labelColor =
                        {
                          NEEDS_REPLY: '#d32f2f',
                          FYI: '#1976d2',
                          ARCHIVE: '#757575',
                          SPAM_LIKE: '#9e9e9e',
                        }[result.label] || '#666';

                      return (
                        <div
                          key={result.thread_id || result.id || index}
                          className="email-item"
                          style={{
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            padding: '16px',
                            marginBottom: '12px',
                            backgroundColor: '#f9f9f9',
                            borderLeft: `4px solid ${labelColor}`,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              marginBottom: '12px',
                            }}
                          >
                            <div>
                              <span
                                style={{
                                  backgroundColor: labelColor,
                                  color: '#fff',
                                  padding: '4px 12px',
                                  borderRadius: '12px',
                                  fontSize: '0.85em',
                                  fontWeight: 'bold',
                                  marginRight: '12px',
                                }}
                              >
                                {result.label}
                              </span>
                              <span
                                style={{
                                  color: priorityColor,
                                  fontWeight: 'bold',
                                  fontSize: '0.9em',
                                }}
                              >
                                Priority: {(result.priority * 100).toFixed(0)}%
                              </span>
                            </div>
                            <span style={{ fontSize: '0.8em', color: '#666' }}>
                              Thread: {result.thread_id?.substring(0, 8)}...
                            </span>
                          </div>

                          {result.summary && (
                            <div
                              style={{
                                marginBottom: '12px',
                                padding: '12px',
                                backgroundColor: '#fff',
                                borderRadius: '4px',
                                fontSize: '0.9em',
                                color: '#333',
                              }}
                            >
                              <strong>Summary:</strong> {result.summary}
                            </div>
                          )}

                          {result.key_points && result.key_points.length > 0 && (
                            <div style={{ marginTop: '8px' }}>
                              <strong style={{ fontSize: '0.9em' }}>Key Points:</strong>
                              <ul
                                style={{
                                  marginTop: '4px',
                                  paddingLeft: '20px',
                                  fontSize: '0.85em',
                                  color: '#555',
                                }}
                              >
                                {result.key_points.map((point, idx) => (
                                  <li key={idx}>{point}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                            <button
                              className="btn-primary"
                              onClick={() => onOpenThread(result.thread_id)}
                              style={{ padding: '4px 12px', fontSize: '0.85em' }}
                            >
                              View Thread
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p>✗ Error: {triageResults.error}</p>
          )}
        </div>
      )}

      {!triageResults && (
        <div
          style={{
            padding: '16px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            color: '#666',
          }}
        >
          Click "Run Triage" to classify and prioritize your emails using AI.
        </div>
      )}
    </div>
  );
}

