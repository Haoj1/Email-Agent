import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import WorkspaceIcon from '../workspace/WorkspaceIcon';

const pages = [
  { path: '/dashboard', icon: 'overview', label: 'Home' },
  { path: '/threads', icon: 'mail', label: 'Inbox' },
  { path: '/triage', icon: 'priority', label: 'Needs attention' },
];

export default function Navigation({ user, selectedEmail, onSelectEmail, onLogout, onTabIntent, theme, onToggleTheme }) {
  const accounts = user?.emails || [];
  const current = accounts.find(account => account.email === selectedEmail)?.email
    || user?.primary_email || accounts[0]?.email || user?.email || '';

  return (
    <aside className="workspace-sidebar">
      <Link to="/dashboard" className="workspace-brand">
        <img src={`${process.env.PUBLIC_URL}/signal-mark.svg`} alt="" />
        <span><strong>Email Agent</strong><small>INBOX WORKSPACE</small></span>
      </Link>
      <nav className="workspace-nav" aria-label="Workspace navigation">
        <p className="workspace-nav-label">WORKSPACE</p>
        {pages.map(({ path, icon, label }) => (
          <NavLink key={path} to={path} onPointerEnter={() => onTabIntent(path)} onFocus={() => onTabIntent(path)}>
            <WorkspaceIcon name={icon} />{label}
          </NavLink>
        ))}
      </nav>
      <div className="workspace-profile">
        {accounts.length > 1 ? (
          <label className="workspace-account-label">
            <span>MAILBOX</span>
            <select value={current} onChange={event => onSelectEmail(event.target.value)}>
              {accounts.map(account => (
                <option key={account.id} value={account.email}>{account.email}</option>
              ))}
            </select>
          </label>
        ) : current && <span className="workspace-account-single" title={current}>{current}</span>}
        <button type="button" className="workspace-theme" onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          <WorkspaceIcon name={theme === 'dark' ? 'sun' : 'moon'} />
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
        <button type="button" className="workspace-logout" onClick={onLogout}><WorkspaceIcon name="logout" /> Sign out</button>
      </div>
    </aside>
  );
}
