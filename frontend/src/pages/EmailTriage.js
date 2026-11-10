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
    reviewUnclear,
    setReviewUnclear,
    triageProgress,
    triageStatus,
    triageLastComplete,
    triageLastError,
    triageAccountInfo,
    runTriage,
    getTriageCursors
  } = useEmailCache();
  const [triageResults, setTriageResults] = useState(null);
  const [triagePage, setTriagePage] = useState(0);
  const TRIAGE_PAGE_SIZE = 20;
  const [loadingTriageResults, setLoadingTriageResults] = useState(false);
  // Default to last 3 days for better signal-to-noise
  const [triageDaysFilter, setTriageDaysFilter] = useState(3);
  
  const navigate = useNavigate();
  const pendingTriageCheckIntervalRef = useRef(null);
  const { getCachedTriageResults, setCachedTriageResults } = useEmailCache();

  useEffect(() => {
    return () => {
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

  const handleRunTriage = () => runTriage({
    emails: user?.emails?.map(account => account.email).filter(Boolean) || [],
    userId: user?.user_id,
  });

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

  const handleOpenThread = (threadId, account = selectedEmail) => {
    const params = new URLSearchParams();
    if (account) params.set('email', account);
    navigate(`/thread/${threadId}?${params.toString()}`);
  };

  const handleDaysFilterChange = (days) => {
    setTriageDaysFilter(days);
    loadTriageResults(null, true, false, false, days);
  };

  useEffect(() => {
    if (triageLastComplete) loadTriageResults(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageLastComplete?.run_id]);



  return (
    <div className="dashboard-container">
      <div className="dashboard-content full-width">
        <EmailTriageCard
          runningTriage={triageRunning}
          loadingTriageResults={loadingTriageResults}
          triageResults={triageResults}
          triageProgress={triageProgress}
          triageLastComplete={triageLastComplete}
          triageLastError={triageLastError}
          hasContinuation={Object.keys(getTriageCursors(user?.user_id)).length > 0}
            reviewUnclear={reviewUnclear}
            onReviewUnclearChange={setReviewUnclear}
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
