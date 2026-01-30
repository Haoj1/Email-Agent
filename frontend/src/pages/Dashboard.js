import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import EmailAccountsCard from '../components/dashboard/EmailAccountsCard';
import ApiAccessTestCard from '../components/dashboard/ApiAccessTestCard';
import EmailThreadsCard from '../components/dashboard/EmailThreadsCard';
import InboxSyncCard from '../components/dashboard/InboxSyncCard';
import EmailTriageCard from '../components/dashboard/EmailTriageCard';
import NextStepsCard from '../components/dashboard/NextStepsCard';
import './Dashboard.css';

function Dashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gmailTest, setGmailTest] = useState(null);
  const [calendarTest, setCalendarTest] = useState(null);
  const [emailThreads, setEmailThreads] = useState(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [emailThreadsNextPageToken, setEmailThreadsNextPageToken] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [triageResults, setTriageResults] = useState(null);
  const [triagePage, setTriagePage] = useState(0);
  const TRIAGE_PAGE_SIZE = 20;
  const [runningTriage, setRunningTriage] = useState(false);
  const [loadingTriageResults, setLoadingTriageResults] = useState(false);
  const [triageProgress, setTriageProgress] = useState({ current: 0, total: 0, progress: 0 });
  const [triageStatus, setTriageStatus] = useState('');
  const [testing, setTesting] = useState(false);
  // Load selectedEmail from localStorage on mount
  const [selectedEmail, setSelectedEmail] = useState(() => {
    try {
      return localStorage.getItem('selectedEmail') || null;
    } catch {
      return null;
    }
  });

  // Save selectedEmail to localStorage whenever it changes
  useEffect(() => {
    if (selectedEmail) {
      try {
        localStorage.setItem('selectedEmail', selectedEmail);
      } catch (error) {
        console.error('Failed to save selectedEmail to localStorage:', error);
      }
    } else {
      try {
        localStorage.removeItem('selectedEmail');
      } catch (error) {
        console.error('Failed to remove selectedEmail from localStorage:', error);
      }
    }
  }, [selectedEmail]);

  // Save selectedEmail to localStorage whenever it changes
  useEffect(() => {
    if (selectedEmail) {
      try {
        localStorage.setItem('selectedEmail', selectedEmail);
      } catch (error) {
        console.error('Failed to save selectedEmail to localStorage:', error);
      }
    } else {
      try {
        localStorage.removeItem('selectedEmail');
      } catch (error) {
        console.error('Failed to remove selectedEmail from localStorage:', error);
      }
    }
  }, [selectedEmail]);
  const [addingEmail, setAddingEmail] = useState(false);
  const [addEmailError, setAddEmailError] = useState(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    getCachedThreads,
    setCachedThreads,
    getCachedSyncResult,
    setCachedSyncResult,
    getCachedTriageResults,
    setCachedTriageResults,
  } = useEmailCache();

  useEffect(() => {
    checkAuth();

    // Check if we just added an email (from callback)
    const action = searchParams.get('action');
    const success = searchParams.get('success');
    if (action === 'add_email' && success === 'true') {
      // Refresh user info to show new email
      setTimeout(() => {
        refreshUserInfo();
        // Clear URL params
        setSearchParams({});
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triagePollingRef = useRef(null);
  const TRIAGE_POLL_INTERVAL = 3000; // ms
  const TRIAGE_POLL_MAX_ATTEMPTS = 10;

  const stopTriagePolling = () => {
    if (triagePollingRef.current) {
      clearTimeout(triagePollingRef.current);
      triagePollingRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopTriagePolling();
    };
  }, []);

  const checkAuth = async () => {
    try {
      const response = await api.get('/auth/me');
      if (response.data.authenticated) {
        setUser(response.data);
      } else {
        navigate('/');
      }
    } catch (error) {
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
      navigate('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const testGmail = async () => {
    setTesting(true);
    setGmailTest(null);
    try {
      const response = await api.get('/auth/test/gmail');
      setGmailTest({ success: true, data: response.data });
    } catch (error) {
      setGmailTest({
        success: false,
        error: error.response?.data?.error || error.message,
      });
    } finally {
      setTesting(false);
    }
  };

  const testCalendar = async () => {
    setTesting(true);
    setCalendarTest(null);
    try {
      const response = await api.get('/auth/test/calendar');
      setCalendarTest({ success: true, data: response.data });
    } catch (error) {
      setCalendarTest({
        success: false,
        error: error.response?.data?.error || error.message,
      });
    } finally {
      setTesting(false);
    }
  };

  const loadEmailThreads = async (email = null, forceRefresh = false, isLoadMore = false) => {
    // Check cache first if not forcing refresh and not load more
    if (!forceRefresh && !isLoadMore) {
      const cached = getCachedThreads(email);
      if (cached) {
        setEmailThreads(cached);
        return;
      }
    }

    setLoadingThreads(true);
    if (forceRefresh && !isLoadMore) {
      setEmailThreads(null);
      setEmailThreadsNextPageToken(null);
    }
    
    try {
      const params = {
        max_results: 30,
        days: 14 // Increased to 14 days for better history coverage
      };
      if (email) params.email = email;
      if (isLoadMore && emailThreadsNextPageToken) {
        params.page_token = emailThreadsNextPageToken;
      }

      const response = await api.get('/gmail/threads', { params });
      const newData = response.data;
      
      let mergedThreads = newData.threads || [];
      if (isLoadMore && emailThreads?.data?.threads) {
        mergedThreads = [...emailThreads.data.threads, ...mergedThreads];
      }
      
      const threadsData = { 
        success: true, 
        data: {
          ...newData,
          threads: mergedThreads
        } 
      };
      
      setEmailThreads(threadsData);
      setEmailThreadsNextPageToken(newData.next_page_token || null);
      
      // Save to cache (only if not load more)
      if (!isLoadMore) {
        setCachedThreads(email, threadsData);
      }
    } catch (error) {
      const errorData = {
        success: false,
        error: error.response?.data?.detail || error.message,
      };
      setEmailThreads(errorData);
    } finally {
      setLoadingThreads(false);
    }
  };

  const sortTriageData = (triageData) => {
    if (!triageData?.success || !Array.isArray(triageData.data?.results)) return triageData;
    return {
      ...triageData,
      data: {
        ...triageData.data,
        results: [...triageData.data.results].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)),
      },
    };
  };

  const runTriage = async (forceRefresh = false) => {
    // Check cache first if not forcing refresh
    // Note: Triage results are per user, not per email, so we use null as cache key
    if (!forceRefresh) {
      const cached = getCachedTriageResults(null);
      if (cached) {
        setTriageResults(cached);
        return;
      }
    }

    stopTriagePolling();
    setRunningTriage(true);
    setTriageProgress({ current: 0, total: 0, progress: 0 });
    setTriageStatus('Starting triage...');
    if (forceRefresh) {
      setTriageResults(null);
    }

    try {
      const baseURL = api.defaults.baseURL || 'http://localhost:5001/api';
      const response = await fetch(`${baseURL}/triage/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          max_results: 100,
          days: 7,
          email: selectedEmail || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'status') {
                setTriageStatus(data.message || '');
              } else if (data.type === 'progress') {
                setTriageProgress({
                  current: data.current || 0,
                  total: data.total || 0,
                  progress: data.progress || 0,
                });
              } else if (data.type === 'complete') {
                const triageData = sortTriageData({
                  success: data.success,
                  data: {
                    processed_count: data.processed_count,
                    results: data.results || [],
                    message: data.message,
                  },
                });
                setTriageResults(triageData);
                setCachedTriageResults(null, triageData);
                setRunningTriage(false);
                setTriageStatus('');
                startTriagePolling();
              } else if (data.type === 'error') {
                setTriageResults({
                  success: false,
                  error: data.error || 'Unknown error occurred',
                });
                setRunningTriage(false);
                setTriageStatus('');
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      setTriageResults({
        success: false,
        error: error.message || 'Failed to run triage',
      });
      setRunningTriage(false);
      setTriageStatus('');
    }
  };

  const loadTriageResults = async (label = null, forceRefresh = false, returnData = false, isLoadMore = false) => {
    // Check cache first if not forcing refresh and no label filter and not load more
    // Note: Triage results are per user, not per email, so we use null as cache key
    if (!forceRefresh && !label && !isLoadMore) {
      const cached = getCachedTriageResults(null);
      if (cached) {
        setTriageResults(cached);
        return returnData ? cached : undefined;
      }
    }

    setLoadingTriageResults(true);
    if (forceRefresh && !isLoadMore) {
      setTriageResults(null);
      setTriagePage(0);
    }
    
    const currentPage = isLoadMore ? triagePage + 1 : 0;
    
    try {
      const params = {
        limit: TRIAGE_PAGE_SIZE,
        skip: currentPage * TRIAGE_PAGE_SIZE
      };
      // Don't pass email param - backend returns all results for the user
      if (label) params.label = label;

      const response = await api.get('/triage/results', { params });
      const newData = response.data;
      
      let mergedResults = newData.results || [];
      if (isLoadMore && triageResults?.data?.results) {
        mergedResults = [...triageResults.data.results, ...mergedResults];
      }
      
      const triageData = sortTriageData({ 
        success: true, 
        data: {
          ...newData,
          results: mergedResults,
          total_count: newData.total_count,
          count: mergedResults.length
        }
      });
      
      setTriageResults(triageData);
      if (isLoadMore) {
        setTriagePage(currentPage);
      } else {
        setTriagePage(0);
      }
      
      // Save to cache (only if no label filter and not load more)
      if (!label && !isLoadMore) {
        setCachedTriageResults(null, triageData);
      }
      return returnData ? triageData : undefined;
    } catch (error) {
      console.error('Failed to load triage results:', error);
      setTriageResults({
        success: false,
        error: error.response?.data?.detail || error.message,
      });
      return returnData ? null : undefined;
    } finally {
      setLoadingTriageResults(false);
    }
  };

  const startTriagePolling = () => {
    stopTriagePolling();
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      const data = await loadTriageResults(null, true, true);
      const hasResults =
        data?.success && Array.isArray(data.data?.results) && data.data.results.length > 0;
      if (hasResults || attempts >= TRIAGE_POLL_MAX_ATTEMPTS) {
        stopTriagePolling();
        setRunningTriage(false);
        return;
      }
      triagePollingRef.current = setTimeout(poll, TRIAGE_POLL_INTERVAL);
    };
    triagePollingRef.current = setTimeout(poll, TRIAGE_POLL_INTERVAL);
  };

  const syncInbox = async (forceRefresh = false) => {
    // Check cache first if not forcing refresh
    if (!forceRefresh) {
      const cached = getCachedSyncResult(selectedEmail);
      if (cached) {
        setSyncResult(cached);
        return;
      }
    }

    setSyncing(true);
    if (forceRefresh) {
      setSyncResult(null);
    }
    try {
      const response = await api.post('/gmail/sync', {
        max_results: 100,
        days: 30,
        email: selectedEmail || null,
      });
      const syncData = { success: true, data: response.data };
      setSyncResult(syncData);
      // Save to cache
      setCachedSyncResult(selectedEmail, syncData);
    } catch (error) {
      const errorData = {
        success: false,
        error: error.response?.data?.detail || error.message,
      };
      setSyncResult(errorData);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (user && user.authenticated) {
      // Check cache first, then load if needed
      const cached = getCachedThreads(selectedEmail);
      if (cached) {
        setEmailThreads(cached);
      } else {
        // Auto-load threads when user is loaded (only if no cache)
        loadEmailThreads(selectedEmail, false);
      }

      // Auto-load triage results (will check cache internally)
      loadTriageResults(null, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedEmail]);

  const handleSelectEmail = (email) => {
    setSelectedEmail(email);
    // loadEmailThreads will check cache automatically
    loadEmailThreads(email, false);
  };

  const handleOpenThread = (threadId) => {
    const params = new URLSearchParams();
    if (selectedEmail) params.set('email', selectedEmail);
    const qs = params.toString();
    navigate(`/thread/${threadId}${qs ? `?${qs}` : ''}`);
  };

  const handleAddEmail = async () => {
    if (!user || !user.user_id) {
      setAddEmailError('User ID not found. Please refresh the page.');
      return;
    }

    try {
      setAddingEmail(true);
      setAddEmailError(null);

      // Get OAuth URL for adding email
      const response = await api.get('/auth/google/login', {
        params: {
          action: 'add_email',
          user_id: user.user_id,
        },
      });

      if (response.data.authUrl) {
        // Redirect to Google OAuth
        window.location.href = response.data.authUrl;
      } else {
        setAddEmailError('Failed to get OAuth URL');
      }
    } catch (error) {
      setAddEmailError(
        error.response?.data?.detail || error.message || 'Failed to initiate add email',
      );
      setAddingEmail(false);
    }
  };

  const refreshUserInfo = async () => {
    try {
      const response = await api.get('/auth/me');
      if (response.data.authenticated) {
        setUser(response.data);
      }
    } catch (error) {
      console.error('Failed to refresh user info:', error);
    }
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <DashboardHeader
        user={user}
        selectedEmail={selectedEmail}
        onSelectEmail={handleSelectEmail}
        onAddEmail={handleAddEmail}
        addingEmail={addingEmail}
        addEmailError={addEmailError}
        onLogout={handleLogout}
      />

      <div className="dashboard-content">
        <EmailAccountsCard
          user={user}
          selectedEmail={selectedEmail}
          onSelectEmail={handleSelectEmail}
          onAddEmail={handleAddEmail}
          addingEmail={addingEmail}
          addEmailError={addEmailError}
        />

        <ApiAccessTestCard
          testing={testing}
          onTestGmail={testGmail}
          onTestCalendar={testCalendar}
          gmailTest={gmailTest}
          calendarTest={calendarTest}
        />

        <EmailThreadsCard
          loadingThreads={loadingThreads}
          onRefreshEmails={() => loadEmailThreads(selectedEmail, true)}
          onLoadMore={() => loadEmailThreads(selectedEmail, false, true)}
          hasMore={!!emailThreadsNextPageToken}
          syncing={syncing}
          onSyncInbox={() => syncInbox(true)}
          emailThreads={emailThreads}
          onOpenThread={handleOpenThread}
        />

        <EmailTriageCard
          runningTriage={runningTriage}
          loadingTriageResults={loadingTriageResults}
          triageResults={triageResults}
          triageProgress={triageProgress}
          triageStatus={triageStatus}
          onRunTriage={runTriage}
          onLoadTriageResults={() => loadTriageResults(null, true)}
          onLoadMore={() => loadTriageResults(null, false, false, true)}
          onOpenThread={handleOpenThread}
        />

        <InboxSyncCard syncResult={syncResult} onOpenThread={handleOpenThread} />

        <NextStepsCard />
      </div>
    </div>
  );
}

export default Dashboard;
