import React, { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthStatus } from '../components/AuthFrame';

export default function AuthCallback({ authenticated }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const addingMailbox = params.get('action') === 'add_email';
  const completed = params.get('success') === 'true' && authenticated;

  useEffect(() => {
    if (!completed) return;
    const timer = window.setTimeout(() => navigate('/dashboard', { replace: true }), 850);
    return () => window.clearTimeout(timer);
  }, [completed, navigate]);

  if (completed) {
    return (
      <AuthStatus tone="success" title={addingMailbox ? 'Mailbox connected' : 'You’re signed in'}
        description="Opening your workspace…">
        <Link className="auth-primary" to="/dashboard" replace>Open workspace</Link>
      </AuthStatus>
    );
  }

  const reason = params.get('error');
  const description = reason === 'access_denied'
    ? 'Google authorization was cancelled. You can try again.'
    : reason === 'Sign-in expired. Start sign-in again.'
      ? 'Your sign-in session expired. Start again when you’re ready.'
      : authenticated ? 'Return to your workspace and try connecting the mailbox again.'
        : 'Return to sign-in and try connecting with Google again.';
  return (
    <AuthStatus tone="error" title={authenticated ? 'Couldn’t connect the mailbox' : 'Couldn’t finish sign-in'}
      description={description}>
      <Link className="auth-primary" to={authenticated ? '/dashboard' : '/'} replace>
        {authenticated ? 'Back to workspace' : 'Back to sign-in'}
      </Link>
    </AuthStatus>
  );
}
