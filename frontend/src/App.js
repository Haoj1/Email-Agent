import React, { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { EmailCacheProvider, useEmailCache } from './contexts/EmailCacheContext';
import { api } from './services/api';
import Navigation from './components/dashboard/Navigation';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Dashboard from './pages/Dashboard';
import './App.css';
import './Workspace.css';

const loadThreads = () => import('./pages/EmailThreads');
const loadPriority = () => import('./pages/EmailTriage');
const EmailThreadsPage = lazy(loadThreads);
const EmailTriagePage = lazy(loadPriority);

function preloadTab(path) {
  const load = path === '/threads' ? loadThreads : path === '/triage' ? loadPriority : null;
  load?.().catch(() => {});
}
const ThreadDetail = lazy(() => import('./pages/ThreadDetail'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));

const pageLoading = <p className="workspace-route-loading" role="status">Loading view…</p>;

function initialTheme() {
  try {
    const value = localStorage.getItem('emailAgentTheme');
    if (value === 'light' || value === 'dark') return value;
  } catch {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Inner component that has access to EmailCache context
function AppContent() {
  const { runTriage, cancelTriage, clearCache } = useEmailCache();
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState(initialTheme);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('emailAgentTheme', next); } catch {}
  };
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState(() => {
    try {
      return localStorage.getItem('selectedEmail') || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!user?.authenticated || !user.emails?.length) return;
    const emails = user.emails.map(account => account.email).filter(Boolean);
    const check = () => runTriage({ emails, userId: user.user_id }).catch(error => {
      console.error('Unable to start automatic email check:', error);
    });
    check();
    const timer = window.setInterval(check, 30 * 1000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, [user, runTriage]);

  const checkAuth = async () => {
    try {
      const response = await api.get('/auth/me');
      if (response.data.authenticated) {
        setUser(response.data);
        setSelectedEmail(email => response.data.emails?.some(account => account.email === email) ? email : null);
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
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
      setUser(null);
      cancelTriage();
      clearCache();
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="App" data-theme={theme}>
        <Routes>
          <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/privacy" element={<Suspense fallback={pageLoading}><PrivacyPolicy /></Suspense>} />
          <Route path="/terms" element={<Suspense fallback={pageLoading}><TermsOfService /></Suspense>} />
          {user ? (
            <Route
              path="*"
              element={
                <div className="workspace-shell">
                  <Navigation
                    onTabIntent={preloadTab}
                    theme={theme}
                    onToggleTheme={toggleTheme}
                    user={user}
                    selectedEmail={selectedEmail}
                    onSelectEmail={handleSelectEmail}
                    onLogout={handleLogout}
                  />
                  <main className="workspace-main">
                    <Suspense fallback={pageLoading}>
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
                        <Route path="/thread/:threadId" element={<ThreadDetail primaryEmail={user.primary_email} userId={user.user_id} />} />
                        <Route path="*" element={<Navigate to="/dashboard" replace />} />
                      </Routes>
                    </Suspense>
                  </main>
                </div>
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
