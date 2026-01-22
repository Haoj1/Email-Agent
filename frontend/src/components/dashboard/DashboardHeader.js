import React from 'react';

export default function DashboardHeader({
  user,
  selectedEmail,
  onSelectEmail,
  onAddEmail,
  addingEmail,
  addEmailError,
  onLogout,
}) {
  return (
    <div className="dashboard-header">
      <h1>Email Agent Dashboard</h1>
      <div className="user-info">
        <div>
          <span>
            Logged in as: <strong>{user?.email || user?.primary_email}</strong>
          </span>
          <div
            style={{
              marginTop: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            {user?.emails && user.emails.length > 1 && (
              <div>
                <label>Switch Email: </label>
                <select
                  value={selectedEmail || user.primary_email || user.emails[0]?.email}
                  onChange={(e) => onSelectEmail(e.target.value)}
                  style={{ marginLeft: '8px', padding: '4px 8px' }}
                >
                  {user.emails.map((e) => (
                    <option key={e.id} value={e.email}>
                      {e.email} {e.is_primary && '(Primary)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              className="btn-primary"
              onClick={onAddEmail}
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
        <button className="btn-secondary" onClick={onLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}

