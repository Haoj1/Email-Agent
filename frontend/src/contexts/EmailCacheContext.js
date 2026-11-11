import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { api } from '../services/api';

const EmailCacheContext = createContext();

// Cache expiration time: 5 minutes
const CACHE_EXPIRY_MS = 5 * 60 * 1000;

// Schedule a bounded catch-up sooner than a normal incremental check.
const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const CATCH_UP_DELAY_MS = 20 * 1000;

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
  
  // Global triage run state (shared between Dashboard and /triage page)
  const [triageRunning, setTriageRunning] = useState(false);
  const [triageProgress, setTriageProgress] = useState({ current: 0, total: 0, progress: 0 });
  const [triageStatus, setTriageStatus] = useState('');
  const [triageLastComplete, setTriageLastComplete] = useState(null); // { run_id, ...payload }
  const [triageLastError, setTriageLastError] = useState(null); // { run_id, error }
  const triageRunIdRef = useRef(0);
  const triageAbortRef = useRef(null);
  const [triageAccountInfo, setTriageAccountInfo] = useState(null); // { email, index, total }
  
  const scanProgress = useRef(new Map());
  const returnViews = useRef(new Map());
  const rememberReturnView = (key, view) => {
    if (returnViews.current.size >= 4) returnViews.current.delete(returnViews.current.keys().next().value);
    returnViews.current.set(key, { ...view, scroll: window.scrollY });
  };
  const getReturnView = key => returnViews.current.get(key);
  const noteServerSync = useCallback(changedAccounts => {
    setTriageLastComplete({
      run_id: ++triageRunIdRef.current, serverSync: true, changedAccounts, completedAt: Date.now(),
    });
  }, []);

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
      returnViews.current.clear();
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

  const runTriage = useCallback(async ({ emails, userId, reviewMode, days = 7 }) => {
    if (!userId || !emails.length || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    const storageKey = `emailAgentAutoCheck:${userId}`;
    const scan = async () => {
      if (triageAbortRef.current) return;
      let progress = scanProgress.current.get(userId);
      try { progress = JSON.parse(localStorage.getItem(storageKey)) || progress; } catch {}
      if (progress?.reviewMode !== reviewMode) progress = null;
      if (Date.now() < (progress?.nextAt || 0)) return;

      const accounts = [...new Set(emails)];
      const cursors = progress?.cursors || {};
      const checkpoints = progress?.checkpoints || {};
      const pending = accounts.filter(account => cursors[account]);
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
      let errorMessage = '';
      const changedAccounts = new Set();

      const persist = nextAt => {
        const value = { cursors, checkpoints, nextAt, reviewMode };
        scanProgress.current.set(userId, value);
        try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch {}
      };
      persist(Date.now() + SCAN_INTERVAL_MS);

      const scanPage = async (email, cursor) => {
        const response = await fetch(`${api.defaults.baseURL}/triage/run`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          signal: controller.signal, body: JSON.stringify({ max_results: 25, days, email, cursor, checkpoint: checkpoints[email], automatic: true }),
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
        throw new Error('Email updates were interrupted. We’ll try again automatically.');
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
            const cursor = cursors[account] || null;
            let result = await scanPage(account, cursor);
            if (cursor && result.code === 'cursor_expired') {
              delete cursors[account];
              persist(Date.now() + SCAN_INTERVAL_MS);
              result = await scanPage(account, null);
            }
            if (result.type === 'error' || !result.success) {
              throw new Error(result.error || 'The current page could not be scanned.');
            }
            scanned += result.scanned_count || 0;
            skipped += result.skipped_count || 0;
            aiCalls += result.ai_calls || 0;
            aiReviewed += result.ai_reviewed || 0;
            aiUnavailable ||= Boolean(result.ai_unavailable);
            processed += result.processed_count || 0;
            if (result.processed_count > 0) changedAccounts.add(account);
            if (result.next_cursor) cursors[account] = result.next_cursor;
            else {
              delete cursors[account];
              if (result.checkpoint) checkpoints[account] = result.checkpoint;
            }
            persist(Date.now() + SCAN_INTERVAL_MS);
            if (!result.next_cursor) break;
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          errorMessage = error.message;
          setTriageLastError({ run_id: runId, error: errorMessage });
        }
      } finally {
        const hasMore = accounts.some(account => cursors[account]);
        persist(Date.now() + (hasMore && !errorMessage ? CATCH_UP_DELAY_MS : SCAN_INTERVAL_MS));
        setTriageLastComplete({
          run_id: runId, processed_count: processed, scanned, skipped, hasMore, aiCalls, aiReviewed,
          aiUnavailable, changedAccounts: [...changedAccounts], completedAt: Date.now(),
        });
        setTriageAccountInfo(null);
        setTriageRunning(false);
        setTriageStatus('');
        triageAbortRef.current = null;
      }
    };

    if (navigator.locks?.request) {
      await navigator.locks.request(storageKey, { ifAvailable: true }, lock => lock ? scan() : undefined);
    } else {
      await scan();
    }
  }, []);

  const cancelTriage = useCallback(() => triageAbortRef.current?.abort(), []);

  const value = {
    rememberReturnView,
    getReturnView,
    noteServerSync,
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
    // Global triage run state
    triageRunning,
    triageProgress,
    triageStatus,
    triageLastComplete,
    triageLastError,
    triageAccountInfo,
    runTriage,
    cancelTriage,
  };

  return (
    <EmailCacheContext.Provider value={value}>
      {children}
    </EmailCacheContext.Provider>
  );
};
