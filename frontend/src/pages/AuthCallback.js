import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './AuthCallback.css';

function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing');
  const [message, setMessage] = useState('Processing authentication...');

  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    const email = searchParams.get('email');
    const action = searchParams.get('action');

    if (success === 'true') {
      setStatus('success');
      if (action === 'add_email') {
        setMessage(`Successfully added email: ${email}`);
      } else {
        setMessage(`Successfully authenticated as ${email}`);
      }
      // Redirect to dashboard after 1.5 seconds
      setTimeout(() => {
        // Force a full check of auth state
        window.location.href = '/dashboard';
      }, 1500);
    } else {
      setStatus('error');
      setMessage(error || 'Authentication failed');
    }
  }, [searchParams, navigate]);

  return (
    <div className="callback-container">
      <div className="callback-card">
        {status === 'processing' && (
          <>
            <div className="spinner"></div>
            <h2>Processing...</h2>
            <p>{message}</p>
          </>
        )}
        
        {status === 'success' && (
          <>
            <div className="success-icon">✓</div>
            <h2>Success!</h2>
            <p>{message}</p>
            <p className="redirect-message">Redirecting to dashboard...</p>
          </>
        )}
        
        {status === 'error' && (
          <>
            <div className="error-icon">✗</div>
            <h2>Authentication Failed</h2>
            <p>{message}</p>
            <button 
              className="btn-primary"
              onClick={() => navigate('/')}
            >
              Back to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default AuthCallback;
