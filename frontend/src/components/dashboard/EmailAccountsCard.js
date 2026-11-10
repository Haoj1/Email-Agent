import React from 'react';

export default function EmailAccountsCard({
  user, selectedEmail, onSelectEmail, onAddEmail, addingEmail, addEmailError,
}) {
  const accounts = user?.emails || [];
  const activeEmail = selectedEmail || user?.primary_email || accounts[0]?.email;

  return (
    <section className="card workspace-card" aria-labelledby="mailboxes-title">
      <div className="workspace-card-heading">
        <div>
          <p className="workspace-eyebrow">ACCOUNTS</p>
          <h2 id="mailboxes-title">Mailboxes</h2>
        </div>
        <button type="button" className="btn-secondary" onClick={onAddEmail} disabled={addingEmail}>
          {addingEmail ? 'Connecting…' : '+ Add account'}
        </button>
      </div>
      {accounts.length ? (
        <ul className="workspace-mailbox-list">
          {accounts.map(account => {
            const isActive = activeEmail === account.email;
            return (
              <li key={account.id}>
                <button type="button" aria-pressed={isActive} onClick={() => onSelectEmail(account.email)}>
                  <span>
                    <strong>{account.email}</strong>
                    <small>{account.is_primary ? 'Primary · ' : ''}{account.verified ? 'Verified' : 'Unverified'}</small>
                  </span>
                  {isActive && <span className="workspace-mailbox-active">Active</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="workspace-empty">Connect a mailbox to start reviewing conversations.</p>}
      {addEmailError && <p className="workspace-error" role="alert">{addEmailError}</p>}
    </section>
  );
}
