import React from 'react';

export default function EmailAccountsCard({
  user,
  selectedEmail,
  onSelectEmail,
  onAddEmail,
  addingEmail,
  addEmailError,
}) {
  return (
    <div className="card">
      <h2>Email Accounts</h2>
      {user?.emails && user.emails.length > 0 ? (
        <div style={{ marginBottom: '16px' }}>
          <p>You have {user.emails.length} email account(s) connected. Click to switch:</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {user.emails.map((email) => {
              const isSelected =
                (selectedEmail || user.primary_email || user.emails[0]?.email) === email.email;
              return (
                <li
                  key={email.id}
                  onClick={() => onSelectEmail(email.email)}
                  style={{
                    padding: '12px',
                    marginBottom: '8px',
                    backgroundColor: isSelected
                      ? '#1976d2'
                      : email.is_primary
                      ? '#e3f2fd'
                      : '#f5f5f5',
                    color: isSelected ? '#fff' : '#000',
                    borderRadius: '4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    border: isSelected ? '2px solid #1565c0' : '1px solid transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.backgroundColor = email.is_primary
                        ? '#bbdefb'
                        : '#e0e0e0';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.backgroundColor = email.is_primary
                        ? '#e3f2fd'
                        : '#f5f5f5';
                    }
                  }}
                >
                  <span>
                    {email.email}
                    {email.is_primary && (
                      <span
                        style={{
                          color: isSelected ? '#fff' : '#1976d2',
                          fontWeight: 'bold',
                          marginLeft: '8px',
                        }}
                      >
                        (Primary)
                      </span>
                    )}
                    {isSelected && (
                      <span
                        style={{
                          marginLeft: '8px',
                          fontSize: '0.9em',
                          fontWeight: 'bold',
                        }}
                      >
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
        <div
          style={{
            marginBottom: '16px',
            padding: '12px',
            backgroundColor: '#fff3cd',
            borderRadius: '4px',
            color: '#856404',
          }}
        >
          <p>No email accounts connected yet. Add your first email account below.</p>
        </div>
      )}
      <button className="btn-primary" onClick={onAddEmail} disabled={addingEmail}>
        {addingEmail ? 'Connecting...' : '+ Add Email Account'}
      </button>
      {addEmailError && (
        <div
          style={{
            marginTop: '12px',
            padding: '8px',
            backgroundColor: '#ffebee',
            color: '#c62828',
            borderRadius: '4px',
          }}
        >
          {addEmailError}
        </div>
      )}
    </div>
  );
}

