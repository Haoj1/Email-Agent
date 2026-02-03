import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { api } from '../services/api';

const EmailCacheContext = createContext();

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
  
  // Cache expiration time: 5 minutes
  const CACHE_EXPIRY = 5 * 60 * 1000;
  
  // Global pending triage state
  const [pendingTriageCount, setPendingTriageCount] = useState(0);
  const [checkingPending, setCheckingPending] = useState(false);
  
  // Global cooldown mechanism - tracks last check time per email
  const lastCheckTimeRef = useRef({}); // { email: timestamp }
  const CHECK_COOLDOWN = 5 * 60 * 1000; // 5 minutes in milliseconds

  const getCacheKey = (email) => email || 'default';

  const isCacheValid = (timestamp) => {
    if (!timestamp) return false;
    return Date.now() - timestamp < CACHE_EXPIRY;
  };

  const getCachedThreads = useCallback((email = null) => {
    const key = getCacheKey(email);
    const cached = cache[key];
    
    if (cached && cached.threads && isCacheValid(cached.threadsTimestamp)) {
      return cached.threads;
    }
    return null;
  }, [cache]);

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
  }, [cache]);

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
  }, [cache]);

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
  }, []);

  // Global checkPendingTriage function with cooldown
  const checkPendingTriage = useCallback(async (email, force = false) => {
    const emailKey = email || 'primary';
    const now = Date.now();
    const lastCheck = lastCheckTimeRef.current[emailKey];

    // Check cooldown (unless forced)
    if (!force && lastCheck && (now - lastCheck) < CHECK_COOLDOWN) {
      const remainingMinutes = Math.ceil((CHECK_COOLDOWN - (now - lastCheck)) / 60000);
      console.log(`Skipping pending triage check for ${emailKey} - cooldown active (${remainingMinutes} min remaining)`);
      return;
    }

    setCheckingPending(true);
    try {
      const response = await api.get('/triage/stats', {
        params: { email, days: 7 }
      });
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
    resetPendingTriageCount,
    clearCooldownCache
  };

  return (
    <EmailCacheContext.Provider value={value}>
      {children}
    </EmailCacheContext.Provider>
  );
};
