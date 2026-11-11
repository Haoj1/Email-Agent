import React, { useRef, useState } from 'react';
import { api } from '../../services/api';
import WorkspaceIcon from '../workspace/WorkspaceIcon';

export default function MailboxMenu({
  user, current, onSelectEmail, onDisconnect, theme, onToggleTheme, onLogout,
}) {
  const dialog = useRef(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accounts = user?.emails || [];

  const addMailbox = async () => {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.get('/auth/google/login', {
        params: { action: 'add_email', user_id: user.user_id },
      });
      const destination = new URL(data.authUrl);
      if (destination.origin !== 'https://accounts.google.com') throw new Error('Invalid sign-in URL');
      window.location.assign(destination.href);
    } catch {
      setError('Couldn’t open Google to connect a mailbox. Try again.');
      setBusy(false);
    }
  };

  const confirmDisconnect = async () => {
    setError('');
    setBusy(true);
    try {
      await onDisconnect(disconnecting.id);
      setDisconnecting(null);
    } catch (error) {
      const message = error.response?.data?.detail;
      setError(typeof message === 'string' ? message : 'Couldn’t disconnect this mailbox.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workspace-profile">
      <button type="button" className="mailbox-trigger" aria-haspopup="dialog" aria-label="Manage mailboxes"
        onClick={() => { setError(''); dialog.current.showModal(); }}>
        <span className="mailbox-avatar" aria-hidden="true">{(current?.[0] || 'E').toUpperCase()}</span>
        <span className="mailbox-trigger-label"><strong>Mailboxes</strong><small title={current}>{current || 'Connect an account'}</small></span>
        <WorkspaceIcon name="chevron" />
      </button>
      <dialog ref={dialog} className="mailbox-dialog" aria-labelledby="mailbox-dialog-heading"
        onClose={() => setDisconnecting(null)}>
        <div className="mailbox-dialog-heading">
          <h2 id="mailbox-dialog-heading">Mailboxes</h2>
          <button type="button" className="workspace-quiet" aria-label="Close mailbox settings"
            onClick={() => dialog.current.close()}><WorkspaceIcon name="close" /></button>
        </div>
        <ul className="mailbox-options">
          {accounts.map(account => (
            <li key={account.id}>
              <button className="mailbox-option" type="button" aria-pressed={current === account.email}
                onClick={() => { onSelectEmail(account.email); dialog.current.close(); }}>
                <strong>{account.email}</strong>
                <small>{account.is_primary ? 'Primary mailbox' : 'Connected mailbox'}{current === account.email ? ' · Active' : ''}</small>
              </button>
              {accounts.length > 1 && <button type="button" className="workspace-quiet mailbox-disconnect"
                disabled={busy} aria-label={`Disconnect ${account.email}`}
                onClick={() => { setError(''); setDisconnecting(account); }}>Disconnect</button>}
            </li>
          ))}
        </ul>
        {accounts.length === 1 && <p className="mailbox-help">Keep multiple Gmail mailboxes connected and switch between them here.</p>}
        {disconnecting && <div className="mailbox-confirm">
          <p>Disconnect <strong>{disconnecting.email}</strong> from Email Agent? Its saved follow-ups will be removed here. You can reconnect the Gmail mailbox later.</p>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDisconnecting(null)}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={confirmDisconnect}>
            {busy ? 'Disconnecting…' : 'Disconnect mailbox'}
          </button>
        </div>}
        {error && <p className="workspace-error" role="alert">{error}</p>}
        <div className="mailbox-dialog-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={addMailbox}>
            <WorkspaceIcon name="add" /> {busy && !disconnecting ? 'Opening Google…' : 'Add mailbox'}
          </button>
          <button type="button" className="workspace-theme" onClick={onToggleTheme}>
            <WorkspaceIcon name={theme === 'dark' ? 'sun' : 'moon'} /> {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" className="workspace-logout" onClick={onLogout}><WorkspaceIcon name="logout" /> Sign out</button>
        </div>
      </dialog>
    </div>
  );
}
