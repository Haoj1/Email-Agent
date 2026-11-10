import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import logo from '../../assets/logo.png';

const pages = [
  { path: '/dashboard', number: '01', label: 'Overview' },
  { path: '/threads', number: '02', label: 'Conversations' },
  { path: '/triage', number: '03', label: 'Priority inbox' },
];

export default function Navigation({ user, selectedEmail, onSelectEmail, onLogout }) {
  const accounts = user?.emails || [];
  const current = accounts.find(account => account.email === selectedEmail)?.email
    || user?.primary_email || accounts[0]?.email || user?.email || '';

  return (
    <aside className="workspace-sidebar">
      <Link to="/dashboard" className="workspace-brand">
        <img src={logo} alt="" />
        <span><strong>Email Agent</strong><small>INBOX WORKSPACE</small></span>
      </Link>
      <nav className="workspace-nav" aria-label="Workspace navigation">
        {pages.map(({ path, number, label }) => (
          <NavLink key={path} to={path}>
            <span aria-hidden="true">{number}</span>{label}
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
        <button type="button" className="workspace-logout" onClick={onLogout}>Sign out</button>
      </div>
    </aside>
  );
}
