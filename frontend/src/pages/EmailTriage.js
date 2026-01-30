import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailTriageCard from '../components/dashboard/EmailTriageCard';
import './Dashboard.css';

function EmailTriagePage({ user, selectedEmail, onSelectEmail, onLogout }) {
  const [triageResults, setTriageResults] = useState(null);
  const [triagePage, setTriagePage] = useState(0);
  const TRIAGE_PAGE_SIZE = 20;
  const [runningTriage, setRunningTriage] = useState(false);
  const [loadingTriageResults, setLoadingTriageResults] = useState(false);
  const [triageProgress, setTriageProgress] = useState({ current: 0, total: 0, progress: 0 });
  const [triageStatus, setTriageStatus] = useState('');
  
  const navigate = useNavigate();
  const triagePollingRef = useRef(null);
  const { getCachedTriageResults, setCachedTriageResults } = useEmailCache();

  useEffect(() => {
    return () => stopTriagePolling();
  }, []);

  useEffect(() => {
    if (user && user.authenticated) {
      loadTriageResults(null, false);
    }
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

  const runTriage = async (forceRefresh = false) => {
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
            } else if (data.type === 'error') {
              setTriageResults({ success: false, error: data.error || 'Unknown error' });
              setRunningTriage(false);
              setTriageStatus('');
            }
          }
        }
      }
    } catch (error) {
      setTriageResults({ success: false, error: error.message });
      setRunningTriage(false);
    }
  };

  const loadTriageResults = async (label = null, forceRefresh = false, returnData = false, isLoadMore = false) => {
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
      const params = { limit: TRIAGE_PAGE_SIZE, skip: currentPage * TRIAGE_PAGE_SIZE };
      if (label) params.label = label;

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

  return (
    <div className="dashboard-container">
      <div className="dashboard-content full-width">
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
      </div>
    </div>
  );
}

export default EmailTriagePage;
