import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function EmailTriageCard({
  runningTriage,
  loadingTriageResults,
  triageResults,
  triageProgress,
  triageStatus,
  pendingCount,
  checkingPending,
  daysFilter,
  onDaysFilterChange,
  onRunTriage,
  onRefreshStats,
  onLoadTriageResults,
  onLoadMore,
  onOpenThread,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isStandalonePage = location.pathname === '/triage';

  return (
    <div className="card" style={isStandalonePage ? { maxWidth: '100%', width: '100%' } : {}}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <h2>Email Triage Agent</h2>
        {!isStandalonePage && (
          <button 
            onClick={() => navigate('/triage')}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: '#7b1fa2', 
              cursor: 'pointer',
              fontSize: '0.9em',
              textDecoration: 'underline'
            }}
          >
            View Full Page →
          </button>
        )}
      </div>
      <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '16px' }}>
        Classify and prioritize your emails using AI. Run triage on recent threads to get
        categories, priority scores, and summaries.
      </p>

      {pendingCount > 0 && (
        <p style={{ fontSize: '0.85em', color: '#d32f2f', marginBottom: '12px', fontWeight: 'bold' }}>
          ● You have {pendingCount} new or updated thread(s) that haven't been triaged yet.
        </p>
      )}

      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
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
            position: 'relative',
          }}
        >
          {runningTriage ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Running Triage...
              <span className="spinner" style={{ lineHeight: 0, alignSelf: 'center' }}></span>
            </span>
          ) : (
            <>
              Run Triage
              {pendingCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-5px',
                  right: '-5px',
                  width: '12px',
                  height: '12px',
                  backgroundColor: '#ff1744',
                  borderRadius: '50%',
                  border: '2px solid white',
                  boxShadow: '0 0 4px rgba(0,0,0,0.3)'
                }} />
              )}
            </>
          )}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <label style={{ fontSize: '0.85em', color: '#666' }}>Filter:</label>
          <select
            value={daysFilter || ''}
            onChange={(e) => onDaysFilterChange(e.target.value ? parseInt(e.target.value) : null)}
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
            <option value="">All Time</option>
            <option value="1">Today</option>
            <option value="3">Last 3 Days</option>
            <option value="5">Last 5 Days</option>
            <option value="7">Last Week</option>
            <option value="30">Last Month</option>
          </select>
        </div>

        <button
          onClick={onRefreshStats}
          disabled={runningTriage || loadingTriageResults || checkingPending}
          title="Refresh pending status"
          style={{
            height: '32px',
            width: '32px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            padding: 0,
            borderRadius: '50%',
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
            color: '#5f6368',
            outline: 'none',
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(60, 64, 67, 0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <svg 
            viewBox="0 0 24 24" 
            style={{ 
              width: '20px', 
              height: '20px',
              fill: 'currentColor',
              animation: checkingPending ? 'spin 1s linear infinite' : 'none'
            }}
          >
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.07 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
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
          {runningTriage && triageProgress.total > 0 ? (
            <>
              <p style={{ marginBottom: '12px' }}>
                {triageStatus || 'Running triage on emails...'}
              </p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '8px',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    backgroundColor: '#e0e0e0',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    height: '24px',
                  }}
                >
                  <div
                    style={{
                      width: `${triageProgress.progress}%`,
                      height: '100%',
                      backgroundColor: '#7b1fa2',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <span
                  style={{
                    color: '#666',
                    fontSize: '0.9em',
                    fontWeight: 'bold',
                    minWidth: '45px',
                    textAlign: 'right',
                  }}
                >
                  {triageProgress.progress > 0 ? `${triageProgress.progress}%` : '0%'}
                </span>
              </div>
              <p style={{ fontSize: '0.9em', color: '#888' }}>
                Processing {triageProgress.current} of {triageProgress.total} threads
              </p>
            </>
          ) : (
            <p>
              {runningTriage
                ? triageStatus || 'Running triage on emails... (estimated ~1 minute)'
                : 'Loading triage results...'}
            </p>
          )}
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
                              marginBottom: '12px',
                              paddingBottom: '8px',
                              borderBottom: '1px solid #eee',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '6px',
                              }}
                            >
                              <span
                                style={{
                                  backgroundColor: labelColor,
                                  color: '#fff',
                                  padding: '4px 12px',
                                  borderRadius: '12px',
                                  fontSize: '0.8em',
                                  fontWeight: 'bold',
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
                            {result.email && (
                              <div
                                style={{
                                  fontSize: '0.8em',
                                  color: '#5c6bc0',
                                  textAlign: 'right',
                                  wordBreak: 'break-all',
                                }}
                              >
                                Account: {result.email}
                              </div>
                            )}
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

                  {triageResults.data.total_count > triageResults.data.results.length && (
                    <div style={{ marginTop: '20px', textAlign: 'center' }}>
                      <button
                        className="btn-primary"
                        onClick={onLoadMore}
                        disabled={loadingTriageResults}
                        style={{
                          backgroundColor: '#f5f5f5',
                          color: '#7b1fa2',
                          border: '1px solid #7b1fa2',
                          padding: '8px 24px',
                        }}
                      >
                        {loadingTriageResults ? 'Loading...' : `Load More (Showing ${triageResults.data.results.length} of ${triageResults.data.total_count})`}
                      </button>
                    </div>
                  )}
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

