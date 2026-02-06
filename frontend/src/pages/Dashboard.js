import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailAccountsCard from '../components/dashboard/EmailAccountsCard';
import AssistChatCard from '../components/dashboard/AssistChatCard';
import EmailThreadsCard from '../components/dashboard/EmailThreadsCard';
import EmailTriageCard from '../components/dashboard/EmailTriageCard';
import SuggestedScheduleCard from '../components/dashboard/SuggestedScheduleCard';
import AssistChatPanel from '../components/assist/AssistChatPanel';
import './Dashboard.css';

function Dashboard({ user, selectedEmail, onSelectEmail, onLogout }) {
  const { 
    pendingTriageCount, 
    checkingPending, 
    checkPendingTriage, 
    triageRunning,
    triageProgress,
    triageStatus,
    triageLastComplete,
    triageLastError,
    runTriage
  } = useEmailCache();
  const [emailThreads, setEmailThreads] = useState(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [emailThreadsNextPageToken, setEmailThreadsNextPageToken] = useState(null);
  const [triageResults, setTriageResults] = useState(null);
  const [triagePage, setTriagePage] = useState(0);
  const TRIAGE_PAGE_SIZE = 20;
  const [loadingTriageResults, setLoadingTriageResults] = useState(false);
  const pendingTriageCheckIntervalRef = useRef(null);
  // Default to last 3 days for better signal-to-noise
  const [triageDaysFilter, setTriageDaysFilter] = useState(3);
  
  const [addingEmail, setAddingEmail] = useState(false);
  const [addEmailError, setAddEmailError] = useState(null);
  const [showAssistChat, setShowAssistChat] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    getCachedThreads,
    setCachedThreads,
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

  const handleRunTriage = async () => {
    stopTriagePolling();
    // Clear old results so progress UI is visible while running
    setTriageResults(null);
    runTriage({ email: selectedEmail || null, days: 7, max_results: 100 });
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
        return;
      }
      triagePollingRef.current = setTimeout(poll, TRIAGE_POLL_INTERVAL);
    };
    triagePollingRef.current = setTimeout(poll, TRIAGE_POLL_INTERVAL);
  };

  useEffect(() => {
    if (!triageLastComplete) return;

    const triageData = sortTriageData({
      success: triageLastComplete.success,
      data: {
        processed_count: triageLastComplete.processed_count,
        results: triageLastComplete.results || [],
        message: triageLastComplete.message,
      },
    });

    setTriageResults(triageData);
    setCachedTriageResults(null, triageData);
    loadTriageResults(null, true);
    startTriagePolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageLastComplete?.run_id]);

  useEffect(() => {
    if (!triageLastError) return;
    setTriageResults({ success: false, error: triageLastError.error || 'Unknown error' });
  }, [triageLastError]);

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

        <AssistChatCard onOpenChat={() => setShowAssistChat(true)} />

        <EmailThreadsCard
          loadingThreads={loadingThreads}
          onRefreshEmails={() => loadEmailThreads(selectedEmail, true)}
          onLoadMore={() => loadEmailThreads(selectedEmail, false, true, emailThreads?.days)}
          hasMore={!!emailThreadsNextPageToken}
          emailThreads={emailThreads}
          onOpenThread={handleOpenThread}
          daysFilter={emailThreads?.days || 14}
          onDaysFilterChange={handleThreadsDaysFilterChange}
        />

        <EmailTriageCard
          runningTriage={triageRunning}
          loadingTriageResults={loadingTriageResults}
          triageResults={triageResults}
          triageProgress={triageProgress}
          triageStatus={triageStatus}
          pendingCount={pendingTriageCount}
          checkingPending={checkingPending}
          daysFilter={triageDaysFilter}
          onDaysFilterChange={handleDaysFilterChange}
          onRunTriage={handleRunTriage}
          onRefreshStats={() => checkPendingTriage(selectedEmail, true)}
          onLoadTriageResults={() => loadTriageResults(null, true)}
          onLoadMore={() => loadTriageResults(null, false, false, true)}
          onOpenThread={handleOpenThread}
        />

        <div className="dashboard-grid-span-full">
          <SuggestedScheduleCard selectedEmail={selectedEmail} />
        </div>
      </div>
      <div className={`thread-chat-wrapper ${showAssistChat ? 'open' : ''}`}>
        <AssistChatPanel
          onClose={() => setShowAssistChat(false)}
          selectedEmail={selectedEmail}
        />
      </div>
    </div>
  );
}

export default Dashboard;
