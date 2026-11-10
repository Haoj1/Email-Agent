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
  const [reviewUnclear, setReviewUnclear] = useState(false);
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

  const getTriageCursors = useCallback(userId => {
    try { return JSON.parse(sessionStorage.getItem(`emailAgentTriage:${userId}`) || '{}'); }
    catch { return {}; }
  }, []);

  const runTriage = useCallback(async ({ emails, userId, days = 7 }) => {
    if (triageAbortRef.current) return;
    const accounts = [...new Set(emails.length ? emails : [null])];
    const cursors = getTriageCursors(userId);
    const key = account => account || 'primary';
    const pending = accounts.filter(account => cursors[key(account)]);
    const queue = pending.length ? pending : accounts;
    const controller = new AbortController();
    triageAbortRef.current = controller;
    const runId = ++triageRunIdRef.current;
    let processed = 0;
    let skipped = 0;
    let scanned = 0;
    let aiCalls = 0;
    let aiReviewed = 0;
    let aiUnavailable = false;

    const saveCursors = () => {
      try { sessionStorage.setItem(`emailAgentTriage:${userId}`, JSON.stringify(cursors)); } catch {}
    };

    const scanPage = async (email, cursor) => {
      const response = await fetch(`${api.defaults.baseURL}/triage/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        signal: controller.signal, body: JSON.stringify({ max_results: 25, days, email, cursor, review_unclear: reviewUnclear }),
      });
      if (!response.ok || !response.body) throw new Error(`Scan failed (${response.status}).`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const event = JSON.parse(line.slice(6));
            if (event.type === 'status') setTriageStatus(event.message);
            if (event.type === 'progress') setTriageProgress(event);
            if (event.type === 'complete' || event.type === 'error') return event;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      throw new Error('Scan interrupted. Run it again to continue.');
    };

    setTriageLastError(null);
    setTriageLastComplete(null);
    setTriageRunning(true);
    try {
      for (const [index, account] of queue.entries()) {
        setTriageAccountInfo({ email: account, index, total: queue.length });
        for (let page = 1; page <= 4; page += 1) {
          setTriageStatus(page === 1 ? 'Checking recent emails…' : 'Checking the next group of emails…');
          setTriageProgress({ current: 0, total: 0, progress: 0 });
          const result = await scanPage(account, cursors[key(account)] || null);
          if (result.type === 'error' || !result.success) {
            if (result.code === 'cursor_expired') {
              delete cursors[key(account)];
              saveCursors();
            }
            throw new Error(result.error || 'The current page could not be scanned.');
          }
          scanned += result.scanned_count || 0;
          skipped += result.skipped_count || 0;
          aiCalls += result.ai_calls || 0;
          aiReviewed += result.ai_reviewed || 0;
          aiUnavailable ||= Boolean(result.ai_unavailable);
          processed += result.processed_count || 0;
          if (result.next_cursor) cursors[key(account)] = result.next_cursor;
          else delete cursors[key(account)];
          saveCursors();
          if (!result.next_cursor) break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) setTriageLastError({ run_id: runId, error: error.message });
    } finally {
      const hasMore = accounts.some(account => cursors[key(account)]);
      setTriageLastComplete({ run_id: runId, processed_count: processed, scanned, skipped, hasMore, aiCalls, aiReviewed, aiUnavailable });
      setPendingTriageCount(previous => Math.max(0, previous - processed));
      setTriageAccountInfo(null);
      setTriageRunning(false);
      setTriageStatus('');
      triageAbortRef.current = null;
    }
  }, [getTriageCursors, reviewUnclear]);

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
    reviewUnclear,
    setReviewUnclear,
    triageProgress,
    triageStatus,
    triageLastComplete,
    triageLastError,
    triageAccountInfo,
    runTriage,
    getTriageCursors,
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
