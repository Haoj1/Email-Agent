import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { EmailCacheProvider, useEmailCache } from './contexts/EmailCacheContext';
import { api } from './services/api';
import Navigation from './components/dashboard/Navigation';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Dashboard from './pages/Dashboard';
import EmailThreadsPage from './pages/EmailThreads';
import EmailTriagePage from './pages/EmailTriage';
import ThreadDetail from './pages/ThreadDetail';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import './App.css';

// Inner component that has access to EmailCache context
function AppContent() {
  const { resetPendingTriageCount, clearCooldownCache, checkPendingTriage } = useEmailCache();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState(() => {
    try {
      return localStorage.getItem('selectedEmail') || null;
    } catch {
      return null;
    }
  });

  // Component to conditionally show Navigation
  function ConditionalNavigation({ user, selectedEmail, onSelectEmail, onLogout }) {
    const location = useLocation();
    const isThreadDetail = location.pathname.startsWith('/thread/');

    if (isThreadDetail) {
      return null; // Don't show Navigation on ThreadDetail pages
    }

    return (
      <Navigation
        user={user}
        selectedEmail={selectedEmail}
        onSelectEmail={onSelectEmail}
        onLogout={onLogout}
      />
    );
  }

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await api.get('/auth/me');
      if (response.data.authenticated) {
        setUser(response.data);
      }
    } catch (error) {
      console.error('Auth check failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectEmail = (email) => {
    setSelectedEmail(email);
    localStorage.setItem('selectedEmail', email);
    // Switching accounts should proactively fetch pending triage for that account
    if (user?.authenticated) {
      checkPendingTriage(email, true);
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
      setUser(null);
      resetPendingTriageCount(); // Reset pending count on logout
      clearCooldownCache(); // Clear cooldown cache
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          {user ? (
            <Route
              path="*"
              element={
                <>
                  <ConditionalNavigation
                    user={user}
                    selectedEmail={selectedEmail}
                    onSelectEmail={handleSelectEmail}
                    onLogout={handleLogout}
                  />
                  <div className="main-content">
                    <Routes>
                      <Route
                        path="/dashboard"
                        element={
                          <Dashboard
                            user={user}
                            selectedEmail={selectedEmail}
                            onSelectEmail={handleSelectEmail}
                            onLogout={handleLogout}
                          />
                        }
                      />
                      <Route
                        path="/threads"
                        element={
                          <EmailThreadsPage
                            user={user}
                            selectedEmail={selectedEmail}
                            onSelectEmail={handleSelectEmail}
                            onLogout={handleLogout}
                          />
                        }
                      />
                      <Route
                        path="/triage"
                        element={
                          <EmailTriagePage
                            user={user}
                            selectedEmail={selectedEmail}
                            onSelectEmail={handleSelectEmail}
                            onLogout={handleLogout}
                          />
                        }
                      />
                      <Route path="/thread/:threadId" element={<ThreadDetail />} />
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </div>
                </>
              }
            />
          ) : (
            <Route path="*" element={<Navigate to="/" replace />} />
          )}
        </Routes>
      </div>
    </Router>
  );
}

function App() {
  return (
    <EmailCacheProvider>
      <AppContent />
    </EmailCacheProvider>
  );
}

export default App;
