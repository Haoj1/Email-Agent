import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailTriageCard from '../components/dashboard/EmailTriageCard';
import './Dashboard.css';

function EmailTriagePage({ user, selectedEmail, onSelectEmail, onLogout }) {
  const { 
    triageRunning,
    reviewUnclear,
    setReviewUnclear,
    triageProgress,
    triageStatus,
    triageLastComplete,
    triageLastError,
    triageAccountInfo,
  } = useEmailCache();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { getCachedTriageResults, setCachedTriageResults, getReturnView, rememberReturnView } = useEmailCache();
  const [restored] = useState(() => navigationType === 'POP' ? getReturnView(location.key) : null);
  const [triageResults, setTriageResults] = useState(restored?.results || null);
  const [triagePage, setTriagePage] = useState(restored?.page || 0);
  const TRIAGE_PAGE_SIZE = 20;
  const [loadingTriageResults, setLoadingTriageResults] = useState(false);
  // Default to last 3 days for better signal-to-noise
  const [triageDaysFilter, setTriageDaysFilter] = useState(restored ? restored.days : 3);
  
  const navigate = useNavigate();

  useEffect(() => {
    if (restored) {
      const frame = requestAnimationFrame(() => window.scrollTo(0, restored.scroll));
      return () => cancelAnimationFrame(frame);
    }
    if (user?.authenticated) loadTriageResults(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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

  const loadTriageResults = async (label = null, forceRefresh = false, returnData = false, isLoadMore = false, days = triageDaysFilter, preserve = false) => {
    if (!forceRefresh && !label && !isLoadMore) {
      const cached = getCachedTriageResults(null);
      if (cached?.days === days) {
        setTriageResults(cached);
        return returnData ? cached : undefined;
      }
    }

    setLoadingTriageResults(true);
    if (forceRefresh && !isLoadMore) {
      if (!preserve) setTriageResults(null);
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
        days,
        data: { ...newData, results: mergedResults, count: mergedResults.length }
      });
      
      setTriageResults(triageData);
      setTriagePage(isLoadMore ? currentPage : 0);
      if (!label && !isLoadMore) setCachedTriageResults(null, triageData);
    } catch (error) {
      if (!preserve) setTriageResults({ success: false, error: error.message });
    } finally {
      setLoadingTriageResults(false);
    }
  };

  const handleOpenThread = (threadId, account = selectedEmail) => {
    const params = new URLSearchParams();
    if (account) params.set('email', account);
    rememberReturnView(location.key, { results: triageResults, page: triagePage, days: triageDaysFilter });
    navigate(`/thread/${threadId}?${params.toString()}`, { state: { backTo: location.pathname } });
  };

  const handleDaysFilterChange = (days) => {
    setTriageDaysFilter(days);
    loadTriageResults(null, true, false, false, days);
  };

  useEffect(() => {
    if ((triageLastComplete?.processed_count || triageLastComplete?.serverSync) && triagePage === 0) {
      loadTriageResults(null, true, false, false, triageDaysFilter, true);
    }
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
            hasMailboxes={Boolean(user?.emails?.length)}
          triageLastError={triageLastError}
            reviewUnclear={reviewUnclear}
            onReviewUnclearChange={setReviewUnclear}
          triageStatus={triageStatus}
          triageAccountInfo={triageAccountInfo}
          daysFilter={triageDaysFilter}
          onDaysFilterChange={handleDaysFilterChange}
          onLoadMore={() => loadTriageResults(null, false, false, true)}
          onOpenThread={handleOpenThread}
        />
      </div>
    </div>
  );
}

export default EmailTriagePage;
