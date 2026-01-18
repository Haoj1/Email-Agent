import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import './Dashboard.css';

function Dashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gmailTest, setGmailTest] = useState(null);
  const [calendarTest, setCalendarTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    checkAuth();
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
          <span>Logged in as: <strong>{user?.email}</strong></span>
          <button className="btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="dashboard-content">
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
          <h2>Next Steps</h2>
          <ul className="next-steps">
            <li>✓ OAuth authentication complete</li>
            <li>⏳ Database setup (PostgreSQL)</li>
            <li>⏳ Inbox sync functionality</li>
            <li>⏳ Email triage agent</li>
            <li>⏳ Thread chat agent</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
