import React from 'react';
import { Link } from 'react-router-dom';
import WorkspaceIcon from './workspace/WorkspaceIcon';
import './AuthFrame.css';

export function AuthBrand() {
  return (
    <Link to="/" className="auth-brand">
      <img src={`${process.env.PUBLIC_URL}/signal-mark.svg`} alt="" width="38" height="38" />
      <span>Email Agent</span>
    </Link>
  );
}

export function AuthSpinner() {
  return <span className="auth-spinner" aria-hidden="true" />;
}

export function AuthStatus({ tone = 'pending', title, description, children }) {
  return (
    <main className="auth-scene auth-status-scene">
      <div className="auth-status-card">
        <AuthBrand />
        <div className="auth-status-body">
          <span className="auth-status-mark" data-tone={tone} aria-hidden="true">
            {tone === 'pending' ? <AuthSpinner /> : <WorkspaceIcon name={tone === 'success' ? 'check' : 'close'} />}
          </span>
          <div role={tone === 'error' ? 'alert' : 'status'}>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
