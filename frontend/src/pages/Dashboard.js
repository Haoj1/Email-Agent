import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailAccountsCard from '../components/dashboard/EmailAccountsCard';
import ApiAccessTestCard from '../components/dashboard/ApiAccessTestCard';
import EmailThreadsCard from '../components/dashboard/EmailThreadsCard';
import InboxSyncCard from '../components/dashboard/InboxSyncCard';
import EmailTriageCard from '../components/dashboard/EmailTriageCard';
import NextStepsCard from '../components/dashboard/NextStepsCard';
import './Dashboard.css';

function Dashboard({ user, selectedEmail, onSelectEmail, onLogout }) {
  const { 
    pendingTriageCount, 
    checkingPending, 
    checkPendingTriage, 
    setPendingTriageCount 
  } = useEmailCache();
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
  const pendingTriageCheckIntervalRef = useRef(null);
  const [triageDaysFilter, setTriageDaysFilter] = useState(null);
  
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
    // Check if we just added an email (from callback)
    const action = searchParams.get('action');
    const success = searchParams.get('success');
    if (action === 'add_email' && success === 'true') {
      setTimeout(() => {
        setSearchParams({});
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triagePollingRef = useRef(null);
  const TRIAGE_POLL_INTERVAL = 3000; 
  const TRIAGE_POLL_MAX_ATTEMPTS = 10;

  const stopTriagePolling = () => {
    if (triagePollingRef.current) {
      clearTimeout(triagePollingRef.current);
      triagePollingRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopTriagePolling();
  }, []);

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

  const loadEmailThreads = async (email = null, forceRefresh = false, isLoadMore = false, days = 14) => {
    if (!forceRefresh && !isLoadMore) {
      const cached = getCachedThreads(email);
      if (cached && cached.days === days) {
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
      const params = { max_results: 30, days: days || 14 };
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
        days: days,
        data: { ...newData, threads: mergedThreads } 
      };
      
      setEmailThreads(threadsData);
      setEmailThreadsNextPageToken(newData.next_page_token || null);
      if (!isLoadMore) setCachedThreads(email, threadsData);
    } catch (error) {
      setEmailThreads({
        success: false,
        error: error.response?.data?.detail || error.message,
      });
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
    if (forceRefresh) setTriageResults(null);

    try {
      const baseURL = api.defaults.baseURL || 'http://localhost:5001/api';
      const response = await fetch(`${baseURL}/triage/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          max_results: 100,
          days: 7,
          email: selectedEmail || null,
        }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

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
              if (data.type === 'status') setTriageStatus(data.message || '');
              else if (data.type === 'progress') {
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
                if (setPendingTriageCount) {
                  setPendingTriageCount(0); // Clear pending count after successful run
                // Force check after triage to update count
                checkPendingTriage(selectedEmail, true);
                }
                // Auto-refresh results to ensure everything is in sync
                loadTriageResults(null, true);
                startTriagePolling();
              } else if (data.type === 'error') {
                setTriageResults({ success: false, error: data.error || 'Unknown error' });
                setRunningTriage(false);
                setTriageStatus('');
              }
            } catch (e) { console.error('Error parsing SSE data:', e); }
          }
        }
      }
    } catch (error) {
      setTriageResults({ success: false, error: error.message });
      setRunningTriage(false);
      setTriageStatus('');
    }
  };

  const loadTriageResults = async (label = null, forceRefresh = false, returnData = false, isLoadMore = false, days = triageDaysFilter) => {
    if (!forceRefresh && !label && !isLoadMore && !days) {
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
      const params = { limit: TRIAGE_PAGE_SIZE, skip: currentPage * TRIAGE_PAGE_SIZE };
      if (label) params.label = label;
      if (days) params.days = days;

      const response = await api.get('/triage/results', { params });
      const newData = response.data;
      let mergedResults = newData.results || [];
      if (isLoadMore && triageResults?.data?.results) {
        mergedResults = [...triageResults.data.results, ...mergedResults];
      }
      
      const triageData = sortTriageData({ 
        success: true, 
        data: { ...newData, results: mergedResults, count: mergedResults.length }
      });
      
      setTriageResults(triageData);
      setTriagePage(isLoadMore ? currentPage : 0);
      if (!label && !isLoadMore) setCachedTriageResults(null, triageData);
      return returnData ? triageData : undefined;
    } catch (error) {
      setTriageResults({ success: false, error: error.message });
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
      const hasResults = data?.success && Array.isArray(data.data?.results) && data.data.results.length > 0;
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
    if (!forceRefresh) {
      const cached = getCachedSyncResult(selectedEmail);
      if (cached) { setSyncResult(cached); return; }
    }

    setSyncing(true);
    if (forceRefresh) setSyncResult(null);
    try {
      const response = await api.post('/gmail/sync', {
        max_results: 100, days: 30, email: selectedEmail || null,
      });
      const syncData = { success: true, data: response.data };
      setSyncResult(syncData);
      setCachedSyncResult(selectedEmail, syncData);
    } catch (error) {
      setSyncResult({ success: false, error: error.response?.data?.detail || error.message });
    } finally { setSyncing(false); }
  };


  useEffect(() => {
    if (user && user.authenticated) {
      loadEmailThreads(selectedEmail, false);
      loadTriageResults(null, false);
      // Check immediately on mount/email change (respects global cooldown)
      checkPendingTriage(selectedEmail);
      
      // Then check every 5 minutes (300000 ms) - global cooldown will handle skipping if needed
      const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
      pendingTriageCheckIntervalRef.current = setInterval(() => {
        checkPendingTriage(selectedEmail);
      }, CHECK_INTERVAL);
    }
    
    // Cleanup interval on unmount or when user/email changes
    return () => {
      if (pendingTriageCheckIntervalRef.current) {
        clearInterval(pendingTriageCheckIntervalRef.current);
        pendingTriageCheckIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedEmail]);

  const handleOpenThread = (threadId) => {
    const params = new URLSearchParams();
    if (selectedEmail) params.set('email', selectedEmail);
    navigate(`/thread/${threadId}?${params.toString()}`);
  };

  const handleAddEmail = async () => {
    if (!user || !user.user_id) {
      setAddEmailError('User ID not found. Please refresh the page.');
      return;
    }
    try {
      setAddingEmail(true);
      setAddEmailError(null);
      const response = await api.get('/auth/google/login', {
        params: { action: 'add_email', user_id: user.user_id },
      });
      if (response.data.authUrl) window.location.href = response.data.authUrl;
      else setAddEmailError('Failed to get OAuth URL');
    } catch (error) {
      setAddEmailError(error.response?.data?.detail || error.message);
      setAddingEmail(false);
    }
  };

  const handleDaysFilterChange = (days) => {
    setTriageDaysFilter(days);
    loadTriageResults(null, true, false, false, days);
  };

  const handleThreadsDaysFilterChange = (days) => {
    loadEmailThreads(selectedEmail, true, false, days);
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-content">
        <EmailAccountsCard
          user={user}
          selectedEmail={selectedEmail}
          onSelectEmail={onSelectEmail}
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
          onLoadMore={() => loadEmailThreads(selectedEmail, false, true, emailThreads?.days)}
          hasMore={!!emailThreadsNextPageToken}
          syncing={syncing}
          onSyncInbox={() => syncInbox(true)}
          emailThreads={emailThreads}
          onOpenThread={handleOpenThread}
          daysFilter={emailThreads?.days || 14}
          onDaysFilterChange={handleThreadsDaysFilterChange}
        />

        <EmailTriageCard
          runningTriage={runningTriage}
          loadingTriageResults={loadingTriageResults}
          triageResults={triageResults}
          triageProgress={triageProgress}
          triageStatus={triageStatus}
          pendingCount={pendingTriageCount}
          checkingPending={checkingPending}
          daysFilter={triageDaysFilter}
          onDaysFilterChange={handleDaysFilterChange}
          onRunTriage={runTriage}
          onRefreshStats={() => checkPendingTriage(selectedEmail, true)}
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
