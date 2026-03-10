import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailTriageCard from '../components/dashboard/EmailTriageCard';
import './Dashboard.css';

function EmailTriagePage({ user, selectedEmail, onSelectEmail, onLogout }) {
  const { 
    pendingTriageCount, 
    checkingPending, 
    checkPendingTriage, 
    triageRunning,
    triageProgress,
    triageStatus,
    triageLastComplete,
    triageLastError,
    triageAccountInfo,
    runTriage,
    setTriageAccountInfo
  } = useEmailCache();
  const [triageResults, setTriageResults] = useState(null);
  const [triagePage, setTriagePage] = useState(0);
  const TRIAGE_PAGE_SIZE = 20;
  const [loadingTriageResults, setLoadingTriageResults] = useState(false);
  // Default to last 3 days for better signal-to-noise
  const [triageDaysFilter, setTriageDaysFilter] = useState(3);
  
  const navigate = useNavigate();
  const triagePollingRef = useRef(null);
  const pendingTriageCheckIntervalRef = useRef(null);
  const { getCachedTriageResults, setCachedTriageResults } = useEmailCache();

  useEffect(() => {
    return () => {
      stopTriagePolling();
      if (pendingTriageCheckIntervalRef.current) {
        clearInterval(pendingTriageCheckIntervalRef.current);
        pendingTriageCheckIntervalRef.current = null;
      }
    };
  }, []);


  useEffect(() => {
    if (user && user.authenticated) {
      loadTriageResults(null, false);
      // Check immediately on mount (respects global cooldown). Stats are global across all accounts.
      checkPendingTriage(null);
      
      // Then check every 5 minutes (300000 ms) - global cooldown will handle skipping if needed
      const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
      pendingTriageCheckIntervalRef.current = setInterval(() => {
        checkPendingTriage(null);
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

  const stopTriagePolling = () => {
    if (triagePollingRef.current) {
      clearTimeout(triagePollingRef.current);
      triagePollingRef.current = null;
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
    // Run triage across all connected email accounts so user doesn't need to switch manually
    const emails = (user?.emails || []).map((e) => e.email).filter(Boolean);
    const uniqueEmails = Array.from(new Set(emails));
    if (uniqueEmails.length === 0 && selectedEmail) {
      setTriageAccountInfo({ email: selectedEmail, index: 0, total: 1 });
      await runTriage({ email: selectedEmail, days: 7, max_results: 100 });
    } else if (uniqueEmails.length === 0) {
      setTriageAccountInfo({ email: null, index: 0, total: 1 });
      await runTriage({ email: null, days: 7, max_results: 100 });
    } else {
      for (let i = 0; i < uniqueEmails.length; i += 1) {
        const email = uniqueEmails[i];
        setTriageAccountInfo({ email, index: i, total: uniqueEmails.length });
        // eslint-disable-next-line no-await-in-loop
        await runTriage({ email, days: 7, max_results: 100 });
      }
    }
    setTriageAccountInfo(null);
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
    } catch (error) {
      setTriageResults({ success: false, error: error.message });
    } finally {
      setLoadingTriageResults(false);
    }
  };

  const handleOpenThread = (threadId) => {
    const params = new URLSearchParams();
    if (selectedEmail) params.set('email', selectedEmail);
    navigate(`/thread/${threadId}?${params.toString()}`);
  };

  const handleDaysFilterChange = (days) => {
    setTriageDaysFilter(days);
    loadTriageResults(null, true, false, false, days);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageLastComplete?.run_id]);

  useEffect(() => {
    if (!triageLastError) return;
    setTriageResults({ success: false, error: triageLastError.error || 'Unknown error' });
  }, [triageLastError]);

  return (
    <div className="dashboard-container">
      <div className="dashboard-content full-width">
        <EmailTriageCard
          runningTriage={triageRunning}
          loadingTriageResults={loadingTriageResults}
          triageResults={triageResults}
          triageProgress={triageProgress}
          triageStatus={triageStatus}
          triageAccountInfo={triageAccountInfo}
          pendingCount={pendingTriageCount}
          checkingPending={checkingPending}
          daysFilter={triageDaysFilter}
          onDaysFilterChange={handleDaysFilterChange}
          onRunTriage={handleRunTriage}
          onRefreshStats={() => checkPendingTriage(null, true)}
          onLoadTriageResults={() => loadTriageResults(null, true)}
          onLoadMore={() => loadTriageResults(null, false, false, true)}
          onOpenThread={handleOpenThread}
        />
      </div>
    </div>
  );
}

export default EmailTriagePage;
