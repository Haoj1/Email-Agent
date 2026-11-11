import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthBrand, AuthSpinner } from '../components/AuthFrame';
import WorkspaceIcon from '../components/workspace/WorkspaceIcon';
import { api } from '../services/api';

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

const preview = [
  { icon: 'mail', title: 'Studio launch brief', detail: 'Review the latest conversation' },
  { icon: 'followup', title: 'Production estimate', detail: 'Follow up by Thursday' },
  { icon: 'spark', title: 'Reply to the project team', detail: 'Draft a reply with Copilot' },
];

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(false);
    try {
      const { data } = await api.get('/auth/google/login');
      const destination = new URL(data.authUrl);
      if (destination.origin !== 'https://accounts.google.com') throw new Error('Invalid sign-in URL');
      window.location.assign(destination.href);
    } catch {
      setError(true);
      setLoading(false);
    }
  };

  return (
    <main className="auth-scene">
      <div className="auth-login-card">
        <section className="auth-login-content" aria-labelledby="sign-in-heading">
          <AuthBrand />
          <div className="auth-login-heading">
            <h1 id="sign-in-heading">Sign in to your inbox</h1>
            <p>Read conversations, draft replies, and keep track of follow-ups in one workspace.</p>
          </div>
          <button type="button" className="auth-google" onClick={handleGoogleLogin} disabled={loading} aria-busy={loading}>
            {loading ? <AuthSpinner /> : <GoogleMark />}
            <span>{loading ? 'Opening Google…' : 'Continue with Google'}</span>
          </button>
          {error && <p className="auth-login-error" role="alert">Couldn’t open Google sign-in. Try again.</p>}
          <details className="auth-permissions">
            <summary>What Email Agent can access</summary>
            <ul>
              <li>Gmail messages to show conversations and summaries</li>
              <li>Gmail drafts for replies you review</li>
              <li>Google Calendar events for scheduling follow-ups</li>
            </ul>
          </details>
          <p className="auth-legal">
            By signing in, you agree to the <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>.
          </p>
        </section>
        <aside className="auth-preview" aria-label="Workspace preview">
          <div className="auth-preview-card">
            <div className="auth-preview-header"><WorkspaceIcon name="overview" /> Workspace preview</div>
            {preview.map(item => (
              <div className="auth-preview-row" key={item.title}>
                <span className="auth-preview-icon"><WorkspaceIcon name={item.icon} /></span>
                <div><strong>{item.title}</strong><small>{item.detail}</small></div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
