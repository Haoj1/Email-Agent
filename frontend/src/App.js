import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { EmailCacheProvider } from './contexts/EmailCacheContext';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Dashboard from './pages/Dashboard';
import ThreadDetail from './pages/ThreadDetail';
import './App.css';

function App() {
  return (
    <EmailCacheProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/thread/:threadId" element={<ThreadDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Router>
    </EmailCacheProvider>
  );
}

export default App;
