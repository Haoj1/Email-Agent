import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { api } from '../services/api';

const EmailCacheContext = createContext();

// Cache expiration time: 5 minutes
const CACHE_EXPIRY_MS = 5 * 60 * 1000;

// Pending-triage check cooldown: 5 minutes
const CHECK_COOLDOWN_MS = 5 * 60 * 1000;

export const useEmailCache = () => {
  const context = useContext(EmailCacheContext);
  if (!context) {
    throw new Error('useEmailCache must be used within EmailCacheProvider');
  }
  return context;
};

export const EmailCacheProvider = ({ children }) => {
  // Cache structure: { email: { threads: {...}, syncResult: {...}, timestamp: number } }
  const [cache, setCache] = useState({});
  
  // Global pending triage state
  const [pendingTriageCount, setPendingTriageCount] = useState(0);
  const [checkingPending, setCheckingPending] = useState(false);

  // Global triage run state (shared between Dashboard and /triage page)
  const [triageRunning, setTriageRunning] = useState(false);
  const [triageProgress, setTriageProgress] = useState({ current: 0, total: 0, progress: 0 });
  const [triageStatus, setTriageStatus] = useState('');
  const [triageLastComplete, setTriageLastComplete] = useState(null); // { run_id, ...payload }
  const [triageLastError, setTriageLastError] = useState(null); // { run_id, error }
  const triageRunIdRef = useRef(0);
  const triageAbortRef = useRef(null);
  const [triageAccountInfo, setTriageAccountInfo] = useState(null); // { email, index, total }
  
  // Global cooldown mechanism - tracks last check time per email
  const lastCheckTimeRef = useRef({}); // { email: timestamp }

  const getCacheKey = (email) => email || 'default';

  const isCacheValid = useCallback((timestamp) => {
    if (!timestamp) return false;
    return Date.now() - timestamp < CACHE_EXPIRY_MS;
  }, []);

  const getCachedThreads = useCallback((email = null) => {
    const key = getCacheKey(email);
    const cached = cache[key];
    
    if (cached && cached.threads && isCacheValid(cached.threadsTimestamp)) {
      return cached.threads;
    }
    return null;
  }, [cache, isCacheValid]);

  const setCachedThreads = useCallback((email, threadsData) => {
    const key = getCacheKey(email);
    setCache(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        threads: threadsData,
        threadsTimestamp: Date.now()
      }
    }));
  }, []);

  const getCachedSyncResult = useCallback((email = null) => {
    const key = getCacheKey(email);
    const cached = cache[key];
    
    if (cached && cached.syncResult && isCacheValid(cached.syncResultTimestamp)) {
      return cached.syncResult;
    }
    return null;
  }, [cache, isCacheValid]);

  const setCachedSyncResult = useCallback((email, syncData) => {
    const key = getCacheKey(email);
    setCache(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        syncResult: syncData,
        syncResultTimestamp: Date.now()
      }
    }));
  }, []);

  const getCachedTriageResults = useCallback((email = null) => {
    const key = getCacheKey(email);
    const cached = cache[key];
    
    if (cached && cached.triageResults && isCacheValid(cached.triageResultsTimestamp)) {
      return cached.triageResults;
    }
    return null;
  }, [cache, isCacheValid]);

  const setCachedTriageResults = useCallback((email, triageData) => {
    const key = getCacheKey(email);
    setCache(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        triageResults: triageData,
        triageResultsTimestamp: Date.now()
      }
    }));
  }, []);

  const clearCache = useCallback((email = null) => {
    if (email) {
      const key = getCacheKey(email);
      setCache(prev => {
        const newCache = { ...prev };
        delete newCache[key];
        return newCache;
      });
    } else {
      setCache({});
    }
  }, []);

  const clearExpiredCache = useCallback(() => {
    setCache(prev => {
      const newCache = {};
      Object.keys(prev).forEach(key => {
        const cached = prev[key];
        if (
          (cached.threads && isCacheValid(cached.threadsTimestamp)) ||
          (cached.syncResult && isCacheValid(cached.syncResultTimestamp)) ||
          (cached.triageResults && isCacheValid(cached.triageResultsTimestamp))
        ) {
          newCache[key] = cached;
        }
      });
      return newCache;
    });
  }, [isCacheValid]);

  // Global checkPendingTriage function with cooldown
  const checkPendingTriage = useCallback(async (email, force = false) => {
    // We track cooldown per logical scope. For global stats we use 'all' as the key.
    const emailKey = email || 'all';
    const now = Date.now();
    const lastCheck = lastCheckTimeRef.current[emailKey];

    // Check cooldown (unless forced)
    if (!force && lastCheck && (now - lastCheck) < CHECK_COOLDOWN_MS) {
      const remainingMinutes = Math.ceil((CHECK_COOLDOWN_MS - (now - lastCheck)) / 60000);
      console.log(`Skipping pending triage check for ${emailKey} - cooldown active (${remainingMinutes} min remaining)`);
      return;
    }

    setCheckingPending(true);
    try {
      const params = { days: 7 };
      if (email) params.email = email;
      const response = await api.get('/triage/stats', { params });
      if (response.data.success) {
        setPendingTriageCount(response.data.pending_count);
        // Update last check time
        lastCheckTimeRef.current[emailKey] = now;
      }
    } catch (error) {
      console.error('Failed to check pending triage:', error);
    } finally {
      setCheckingPending(false);
    }
  }, []);

  // Global Run Triage (SSE streaming) shared across pages
  const runTriage = useCallback(async ({ email = null, days = 7, max_results = 100 } = {}) => {
    if (triageRunning) return;

    // Cancel any previous run (safety)
    try {
      if (triageAbortRef.current) triageAbortRef.current.abort();
    } catch {}

    const runId = triageRunIdRef.current + 1;
    triageRunIdRef.current = runId;

    setTriageLastError(null);
    setTriageLastComplete(null);
    setTriageRunning(true);
    setTriageProgress({ current: 0, total: 0, progress: 0 });
    setTriageStatus('Starting triage...');

    const controller = new AbortController();
    triageAbortRef.current = controller;

    try {
      const baseURL = api.defaults.baseURL || 'http://localhost:5001/api';
      const response = await fetch(`${baseURL}/triage/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          max_results,
          days,
          email: email || null,
        }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      if (!response.body) throw new Error('No response body for triage stream');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Ignore updates from stale runs
        if (triageRunIdRef.current !== runId) continue;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try {
            data = JSON.parse(line.slice(6));
          } catch (e) {
            console.error('Error parsing SSE data:', e);
            continue;
          }

          if (triageRunIdRef.current !== runId) continue;

          if (data.type === 'status') {
            setTriageStatus(data.message || '');
          } else if (data.type === 'progress') {
            setTriageProgress({
              current: data.current || 0,
              total: data.total || 0,
              progress: data.progress || 0,
            });
          } else if (data.type === 'complete') {
            setTriageLastComplete({
              run_id: runId,
              email: email || null,
              success: data.success,
              processed_count: data.processed_count,
              results: data.results || [],
              message: data.message,
              completed_at: Date.now(),
            });
            setTriageRunning(false);
            setTriageStatus('');
            setTriageProgress({
              current: data.total || data.current || 0,
              total: data.total || 0,
              progress: 100,
            });

            // Clear pending count after a successful run and force refresh stats
            if (data.success) {
              setPendingTriageCount(0);
              checkPendingTriage(null, true);
            }
          } else if (data.type === 'error') {
            const errMsg = data.error || 'Unknown error';
            setTriageLastError({ run_id: runId, error: errMsg });
            setTriageRunning(false);
            setTriageStatus('');
          }
        }
      }
    } catch (error) {
      if (triageRunIdRef.current === runId) {
        const errMsg = error?.message || String(error);
        setTriageLastError({ run_id: runId, error: errMsg });
        setTriageRunning(false);
        setTriageStatus('');
      }
    }
  }, [checkPendingTriage, triageRunning]);

  // Reset pending triage count (e.g., after running triage)
  const resetPendingTriageCount = useCallback(() => {
    setPendingTriageCount(0);
  }, []);

  // Clear cooldown cache (e.g., on logout)
  const clearCooldownCache = useCallback(() => {
    lastCheckTimeRef.current = {};
  }, []);

  const value = {
    // Cache functions
    getCachedThreads,
    setCachedThreads,
    getCachedSyncResult,
    setCachedSyncResult,
    getCachedTriageResults,
    setCachedTriageResults,
    clearCache,
    clearExpiredCache,
    isCacheValid,
    // Pending triage state
    pendingTriageCount,
    setPendingTriageCount,
    checkingPending,
    checkPendingTriage,
    // Global triage run state
    triageRunning,
    triageProgress,
    triageStatus,
    triageLastComplete,
    triageLastError,
    triageAccountInfo,
    runTriage,
    resetPendingTriageCount,
    clearCooldownCache,
    setTriageAccountInfo,
  };

  return (
    <EmailCacheContext.Provider value={value}>
      {children}
    </EmailCacheContext.Provider>
  );
};
