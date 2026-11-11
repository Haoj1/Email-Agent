import React, { lazy, Suspense, useState, useEffect, useLayoutEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom';
import { EmailCacheProvider, useEmailCache } from './contexts/EmailCacheContext';
import { api } from './services/api';
import Navigation from './components/dashboard/Navigation';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import { AuthStatus } from './components/AuthFrame';
import Dashboard from './pages/Dashboard';
import './App.css';
import './Workspace.css';

const loadThreads = () => import('./pages/EmailThreads');
const loadPriority = () => import('./pages/EmailTriage');
const loadFollowUps = () => import('./pages/FollowUps');
const loadCalendar = () => import('./components/dashboard/SuggestedScheduleCard');
const loadAssistant = () => import('./components/assist/AssistChatPanel');
const FollowUpsPage = lazy(loadFollowUps);
const EmailThreadsPage = lazy(loadThreads);
const EmailTriagePage = lazy(loadPriority);
const CalendarPage = lazy(loadCalendar);
const AssistantPage = lazy(loadAssistant);

function preloadTab(path) {
  const load = {
    '/threads': loadThreads, '/triage': loadPriority, '/follow-ups': loadFollowUps,
    '/calendar': loadCalendar, '/assistant': loadAssistant,
  }[path];
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

function WorkspaceView({ children, activeMailbox, mailboxCount }) {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const showAssistant = pathname === '/assistant';
  const [assistantVisited, setAssistantVisited] = useState(showAssistant);
  useEffect(() => {
    if (showAssistant) setAssistantVisited(true);
  }, [showAssistant]);
  useLayoutEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navigationType]);
  return (
    <main className="workspace-main">
      {(showAssistant || assistantVisited) && (
        <div className="workspace-route workspace-tool-page assistant-workspace" hidden={!showAssistant}>
          <Suspense fallback={pageLoading}>
            <AssistantPage embedded isOpen={showAssistant} selectedEmail={activeMailbox} mailboxCount={mailboxCount} />
          </Suspense>
        </div>
      )}
      {!showAssistant && <div className="workspace-route" key={pathname}>{children}</div>}
    </main>
  );
}

// Inner component that has access to EmailCache context
function AppContent() {
  const { runTriage, cancelTriage, clearCache, reviewUnclear, noteServerSync } = useEmailCache();
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState(initialTheme);
  const [promotions, setPromotions] = useState(() => {
    try {
      const value = localStorage.getItem('emailAgentPromotions');
      if (value === 'all' || value === 'only') return value;
    } catch {}
    return 'hide';
  });
  const changePromotions = value => {
    setPromotions(value);
    try { localStorage.setItem('emailAgentPromotions', value); } catch {}
  };
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
    if (!user?.authenticated || !user.emails?.length || (user.server_sync && !reviewUnclear)) return;
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
  }, [user, runTriage, reviewUnclear]);

  useEffect(() => {
    if (!user?.server_sync) return;
    let revisions;
    let request;
    const check = async () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine || request) return;
      const controller = new AbortController();
      request = controller;
      try {
        const { data } = await api.get('/mailbox-sync', { signal: controller.signal });
        if (controller.signal.aborted) return;
        const next = data.revisions || {};
        const changed = Object.keys(next).filter(email => next[email] !== revisions?.[email]);
        if (changed.length) noteServerSync(changed);
        revisions = next;
      } catch {
        // The mailbox worker runs independently of this display update.
      } finally {
        request = null;
      }
    };
    check();
    const timer = window.setInterval(check, 30 * 1000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => {
      request?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, [user, noteServerSync]);

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

  const disconnectMailbox = async id => {
    const { data } = await api.delete(`/emails/${id}`);
    setUser(current => ({ ...current, emails: data.emails, primary_email: data.primary_email }));
    if (selectedEmail && !data.emails.some(mailbox => mailbox.email === selectedEmail)) {
      setSelectedEmail(null);
      try { localStorage.removeItem('selectedEmail'); } catch {}
    }
    clearCache();
  };

  const activeMailbox = selectedEmail || user?.primary_email || user?.emails?.[0]?.email;

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="App" data-theme={theme}>
        {loading ? <AuthStatus title={window.location.pathname === '/auth/callback' ? 'Finishing sign-in…' : 'Opening Email Agent…'}
          description="Checking your session." /> : <Routes>
          <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
          <Route path="/auth/callback" element={<AuthCallback authenticated={Boolean(user?.authenticated)} />} />
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
                    onDisconnect={disconnectMailbox}
                    onLogout={handleLogout}
                  />
                  <WorkspaceView activeMailbox={activeMailbox} mailboxCount={user.emails?.length || 0}>
                    <Suspense fallback={pageLoading}>
                      <Routes>
                        <Route
                          path="/dashboard"
                          element={
                            <Dashboard
                              user={user}
                              selectedEmail={selectedEmail}
                              promotions={promotions}
                            />
                          }
                        />
                        <Route
                          path="/threads"
                          element={
                            <EmailThreadsPage
                              user={user}
                              selectedEmail={selectedEmail}
                              promotions={promotions}
                              onPromotionsChange={changePromotions}
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
                        <Route path="/follow-ups" element={<FollowUpsPage email={activeMailbox} />} />
                        <Route path="/calendar" element={<div className="workspace-tool-page workspace-schedule-panel">
                          <h1>Calendar</h1>
                          <CalendarPage selectedEmail={activeMailbox} />
                        </div>} />
                        <Route path="/thread/:threadId" element={<ThreadDetail primaryEmail={user.primary_email} userId={user.user_id} />} />
                        <Route path="*" element={<Navigate to="/dashboard" replace />} />
                      </Routes>
                    </Suspense>
                  </WorkspaceView>
                </div>
              }
            />
          ) : (
            <Route path="*" element={<Navigate to="/" replace />} />
          )}
        </Routes>}
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
