import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import WorkspaceIcon from '../workspace/WorkspaceIcon';
import MailboxMenu from './MailboxMenu';

const pages = [
  { path: '/dashboard', icon: 'overview', label: 'Home' },
  { path: '/threads', icon: 'mail', label: 'Inbox' },
  { path: '/triage', icon: 'priority', label: 'Needs attention' },
  { path: '/follow-ups', icon: 'followup', label: 'Follow-ups' },
  { path: '/calendar', icon: 'calendar', label: 'Calendar' },
  { path: '/assistant', icon: 'spark', label: 'Assistant' },
];

export default function Navigation({ user, selectedEmail, onSelectEmail, onDisconnect, onLogout, onTabIntent, theme, onToggleTheme }) {
  const accounts = user?.emails || [];
  const current = accounts.find(account => account.email === selectedEmail)?.email
    || user?.primary_email || accounts[0]?.email || '';

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
      <MailboxMenu user={user} current={current} onSelectEmail={onSelectEmail} onDisconnect={onDisconnect}
        theme={theme} onToggleTheme={onToggleTheme} onLogout={onLogout} />
    </aside>
  );
}
