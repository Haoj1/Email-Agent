import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function Navigation({
  user,
  selectedEmail,
  onSelectEmail,
  onAddEmail,
  addingEmail,
  addEmailError,
  onLogout,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const navItemStyle = (path) => ({
    padding: '8px 16px',
    cursor: 'pointer',
    borderRadius: '4px',
    backgroundColor: location.pathname === path ? '#e3f2fd' : 'transparent',
    color: location.pathname === path ? '#1976d2' : '#666',
    fontWeight: location.pathname === path ? 'bold' : 'normal',
    border: 'none',
    fontSize: '0.95em',
    transition: 'all 0.2s',
  });

  return (
    <div className="dashboard-header" style={{ 
      flexDirection: 'column', 
      alignItems: 'stretch',
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      backgroundColor: '#fff',
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
      marginBottom: '20px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Email Agent</h1>
        <div className="user-info" style={{ margin: 0, padding: 0, background: 'none', boxShadow: 'none', border: 'none' }}>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.9em' }}>
              Logged in as: <strong>{user?.email || user?.primary_email}</strong>
            </span>
            <div style={{ marginTop: '4px' }}>
              <button className="btn-secondary" onClick={onLogout} style={{ padding: '2px 8px', fontSize: '0.75em' }}>
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ 
        display: 'flex', 
        gap: '8px', 
        borderBottom: '1px solid #eee', 
        paddingBottom: '8px',
        marginBottom: '12px',
        overflowX: 'auto'
      }}>
        <button style={navItemStyle('/dashboard')} onClick={() => navigate('/dashboard')}>Dashboard</button>
        <button style={navItemStyle('/threads')} onClick={() => navigate('/threads')}>Email Threads</button>
        <button style={navItemStyle('/triage')} onClick={() => navigate('/triage')}>Triage Agent</button>
      </div>
      
      <div style={{ 
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
        paddingBottom: '4px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {user?.emails && user.emails.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <label style={{ fontSize: '0.85em', color: '#666' }}>Switch Email: </label>
              <select
                value={selectedEmail || user.primary_email || user.emails[0]?.email}
                onChange={(e) => onSelectEmail(e.target.value)}
                style={{ marginLeft: '8px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '0.85em' }}
              >
                {user.emails.map((e) => (
                  <option key={e.id} value={e.email}>
                    {e.email} {e.is_primary && '(Primary)'}
                  </option>
                ))}
              </select>
            </div>
          )}
          {onAddEmail && (
            <button
              className="btn-primary"
              onClick={onAddEmail}
              disabled={addingEmail}
              style={{ padding: '4px 12px', fontSize: '0.85em' }}
            >
              {addingEmail ? 'Connecting...' : '+ Add Email'}
            </button>
          )}
        </div>
        {addEmailError && (
          <span style={{ color: '#d32f2f', fontSize: '0.85em' }}>{addEmailError}</span>
        )}
      </div>
    </div>
  );
}
