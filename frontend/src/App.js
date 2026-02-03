import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { EmailCacheProvider } from './contexts/EmailCacheContext';
import { api } from './services/api';
import Navigation from './components/dashboard/Navigation';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Dashboard from './pages/Dashboard';
import EmailThreadsPage from './pages/EmailThreads';
import EmailTriagePage from './pages/EmailTriage';
import ThreadDetail from './pages/ThreadDetail';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
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
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
      setUser(null);
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <EmailCacheProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            {user ? (
              <Route
                path="*"
                element={
                  <>
                    <Navigation
                      user={user}
                      selectedEmail={selectedEmail}
                      onSelectEmail={handleSelectEmail}
                      onLogout={handleLogout}
                    />
                    <div className="main-content">
                      <Routes>
                        <Route
                          path="/dashboard"
                          element={<Dashboard user={user} selectedEmail={selectedEmail} onSelectEmail={handleSelectEmail} onLogout={handleLogout} />}
                        />
                        <Route
                          path="/threads"
                          element={<EmailThreadsPage user={user} selectedEmail={selectedEmail} onSelectEmail={handleSelectEmail} onLogout={handleLogout} />}
                        />
                        <Route
                          path="/triage"
                          element={<EmailTriagePage user={user} selectedEmail={selectedEmail} onSelectEmail={handleSelectEmail} onLogout={handleLogout} />}
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
    </EmailCacheProvider>
  );
}

export default App;
