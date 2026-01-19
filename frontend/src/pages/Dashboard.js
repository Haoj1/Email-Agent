import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import './Dashboard.css';

function Dashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gmailTest, setGmailTest] = useState(null);
  const [calendarTest, setCalendarTest] = useState(null);
  const [emailThreads, setEmailThreads] = useState(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [addingEmail, setAddingEmail] = useState(false);
  const [addEmailError, setAddEmailError] = useState(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    checkAuth();
    
    // Check if we just added an email (from callback)
    const action = searchParams.get('action');
    const success = searchParams.get('success');
    if (action === 'add_email' && success === 'true') {
      // Refresh user info to show new email
      setTimeout(() => {
        refreshUserInfo();
        // Clear URL params
        setSearchParams({});
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAuth = async () => {
    try {
      const response = await api.get('/auth/me');
      if (response.data.authenticated) {
        setUser(response.data);
      } else {
        navigate('/');
      }
    } catch (error) {
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
      navigate('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const testGmail = async () => {
    setTesting(true);
    setGmailTest(null);
    try {
      const response = await api.get('/auth/test/gmail');
      setGmailTest({ success: true, data: response.data });
    } catch (error) {
      setGmailTest({ 
        success: false, 
        error: error.response?.data?.error || error.message 
      });
    } finally {
      setTesting(false);
    }
  };

  const testCalendar = async () => {
    setTesting(true);
    setCalendarTest(null);
    try {
      const response = await api.get('/auth/test/calendar');
      setCalendarTest({ success: true, data: response.data });
    } catch (error) {
      setCalendarTest({ 
        success: false, 
        error: error.response?.data?.error || error.message 
      });
    } finally {
      setTesting(false);
    }
  };

  const loadEmailThreads = async (email = null) => {
    setLoadingThreads(true);
    setEmailThreads(null);
    try {
      const params = email ? { email } : {};
      const response = await api.get('/gmail/threads', { params });
      setEmailThreads({ success: true, data: response.data });
    } catch (error) {
      setEmailThreads({ 
        success: false, 
        error: error.response?.data?.detail || error.message 
      });
    } finally {
      setLoadingThreads(false);
    }
  };

  const syncInbox = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const response = await api.post('/gmail/sync', {
        max_results: 100,
        days: 30,
        email: selectedEmail || null
      });
      setSyncResult({ success: true, data: response.data });
    } catch (error) {
      setSyncResult({ 
        success: false, 
        error: error.response?.data?.detail || error.message 
      });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (user && user.authenticated) {
      // Auto-load threads when user is loaded
      loadEmailThreads(selectedEmail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAddEmail = async () => {
    if (!user || !user.user_id) {
      setAddEmailError('User ID not found. Please refresh the page.');
      return;
    }

    try {
      setAddingEmail(true);
      setAddEmailError(null);
      
      // Get OAuth URL for adding email
      const response = await api.get('/auth/google/login', {
        params: {
          action: 'add_email',
          user_id: user.user_id
        }
      });
      
      if (response.data.authUrl) {
        // Redirect to Google OAuth
        window.location.href = response.data.authUrl;
      } else {
        setAddEmailError('Failed to get OAuth URL');
      }
    } catch (error) {
      setAddEmailError(error.response?.data?.detail || error.message || 'Failed to initiate add email');
      setAddingEmail(false);
    }
  };

  const refreshUserInfo = async () => {
    try {
      const response = await api.get('/auth/me');
      if (response.data.authenticated) {
        setUser(response.data);
      }
    } catch (error) {
      console.error('Failed to refresh user info:', error);
    }
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Email Agent Dashboard</h1>
        <div className="user-info">
          <div>
            <span>Logged in as: <strong>{user?.email || user?.primary_email}</strong></span>
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {user?.emails && user.emails.length > 1 && (
                <div>
                  <label>Switch Email: </label>
                  <select 
                    value={selectedEmail || user.primary_email || (user.emails[0]?.email)} 
                    onChange={(e) => {
                      setSelectedEmail(e.target.value);
                      loadEmailThreads(e.target.value);
                    }}
                    style={{ marginLeft: '8px', padding: '4px 8px' }}
                  >
                    {user.emails.map(e => (
                      <option key={e.id} value={e.email}>
                        {e.email} {e.is_primary && '(Primary)'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button 
                className="btn-primary" 
                onClick={handleAddEmail}
                disabled={addingEmail}
                style={{ padding: '4px 12px', fontSize: '0.9em' }}
              >
                {addingEmail ? 'Connecting...' : '+ Add Email'}
              </button>
              {addEmailError && (
                <span style={{ color: '#d32f2f', fontSize: '0.9em' }}>{addEmailError}</span>
              )}
            </div>
          </div>
          <button className="btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="card">
          <h2>Email Accounts</h2>
          {user?.emails && user.emails.length > 0 ? (
            <div style={{ marginBottom: '16px' }}>
              <p>You have {user.emails.length} email account(s) connected. Click to switch:</p>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {user.emails.map(email => {
                  const isSelected = (selectedEmail || user.primary_email || user.emails[0]?.email) === email.email;
                  return (
                    <li 
                      key={email.id}
                      onClick={() => {
                        setSelectedEmail(email.email);
                        loadEmailThreads(email.email);
                      }}
                      style={{ 
                        padding: '12px', 
                        marginBottom: '8px', 
                        backgroundColor: isSelected 
                          ? '#1976d2' 
                          : (email.is_primary ? '#e3f2fd' : '#f5f5f5'),
                        color: isSelected ? '#fff' : '#000',
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        border: isSelected ? '2px solid #1565c0' : '1px solid transparent'
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor = email.is_primary ? '#bbdefb' : '#e0e0e0';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor = email.is_primary ? '#e3f2fd' : '#f5f5f5';
                        }
                      }}
                    >
                      <span>
                        {email.email} 
                        {email.is_primary && (
                          <span style={{ 
                            color: isSelected ? '#fff' : '#1976d2', 
                            fontWeight: 'bold',
                            marginLeft: '8px'
                          }}> 
                            (Primary)
                          </span>
                        )}
                        {isSelected && (
                          <span style={{ 
                            marginLeft: '8px',
                            fontSize: '0.9em',
                            fontWeight: 'bold'
                          }}>
                            ← Active
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: '0.85em', color: isSelected ? '#fff' : '#666' }}>
                        {email.verified ? '✓ Verified' : 'Unverified'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#fff3cd', borderRadius: '4px', color: '#856404' }}>
              <p>No email accounts connected yet. Add your first email account below.</p>
            </div>
          )}
          <button 
            className="btn-primary" 
            onClick={handleAddEmail}
            disabled={addingEmail}
          >
            {addingEmail ? 'Connecting...' : '+ Add Email Account'}
          </button>
          {addEmailError && (
            <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#ffebee', color: '#c62828', borderRadius: '4px' }}>
              {addEmailError}
            </div>
          )}
        </div>

        <div className="card">
          <h2>API Access Test</h2>
          <p>Test if you can access Gmail and Calendar APIs with your permissions.</p>
          
          <div className="test-buttons">
            <button 
              className="btn-primary" 
              onClick={testGmail}
              disabled={testing}
            >
              Test Gmail API
            </button>
            <button 
              className="btn-primary" 
              onClick={testCalendar}
              disabled={testing}
            >
              Test Calendar API
            </button>
          </div>

          {gmailTest && (
            <div className={`test-result ${gmailTest.success ? 'success' : 'error'}`}>
              <h3>Gmail API Test</h3>
              {gmailTest.success ? (
                <div>
                  <p>✓ Successfully accessed Gmail API</p>
                  <p>Found {gmailTest.data.messageCount} messages (Total: {gmailTest.data.totalMessages || 'N/A'})</p>
                  
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
                              backgroundColor: '#f9f9f9'
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
                                  <div style={{ 
                                    marginTop: '8px', 
                                    padding: '8px', 
                                    backgroundColor: '#fff',
                                    borderRadius: '4px',
                                    fontSize: '0.9em',
                                    color: '#555'
                                  }}>
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

        <div className="card">
          <h2>Email Threads</h2>
          <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button 
              className="btn-primary" 
              onClick={() => loadEmailThreads(selectedEmail)}
              disabled={loadingThreads}
            >
              {loadingThreads ? 'Loading...' : 'Refresh Emails'}
            </button>
            <button 
              className="btn-primary" 
              onClick={syncInbox}
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
                  <p>✓ Found {emailThreads.data.thread_count} threads (Total estimated: {emailThreads.data.total_estimated})</p>
                  
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
                              transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#f0f0f0'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = '#f9f9f9'}
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
                              <div style={{ 
                                marginTop: '8px', 
                                padding: '8px', 
                                backgroundColor: '#fff',
                                borderRadius: '4px',
                                fontSize: '0.9em',
                                color: '#555'
                              }}>
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

        <div className="card">
          <h2>Inbox Sync (Normalized)</h2>
          <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '16px' }}>
            Sync and normalize email threads using 方案 A (不存储). Data is normalized to internal Thread schema but not stored in database.
          </p>

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
                              backgroundColor: '#f9f9f9'
                            }}
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
                              <strong>Latest Date:</strong> {new Date(thread.latest_message_date).toLocaleString()}
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
                                <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#1976d2' }}>
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
                                        backgroundColor: '#fff'
                                      }}
                                    >
                                      <div style={{ marginBottom: '4px' }}>
                                        <strong>From:</strong> {msg.from}
                                      </div>
                                      <div style={{ marginBottom: '4px', fontSize: '0.9em', color: '#666' }}>
                                        <strong>Date:</strong> {new Date(msg.date).toLocaleString()}
                                      </div>
                                      {msg.snippet && (
                                        <div style={{ 
                                          marginTop: '8px', 
                                          padding: '8px', 
                                          backgroundColor: '#f5f5f5',
                                          borderRadius: '4px',
                                          fontSize: '0.85em',
                                          color: '#555'
                                        }}>
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
            <div style={{ padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '4px', color: '#666' }}>
              Click "Sync Inbox (Normalize)" to fetch and normalize email threads from Gmail API.
            </div>
          )}
        </div>

        <div className="card">
          <h2>Next Steps</h2>
          <ul className="next-steps">
            <li>✓ OAuth authentication complete</li>
            <li>✓ Database setup (PostgreSQL)</li>
            <li>✓ Email query functionality</li>
            <li>✓ Inbox sync functionality (方案 A: 不存储)</li>
            <li>⏳ Email triage agent</li>
            <li>⏳ Thread chat agent</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
