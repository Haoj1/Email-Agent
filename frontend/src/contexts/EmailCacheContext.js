import React, { createContext, useContext, useState, useCallback } from 'react';

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

  const value = {
    getCachedThreads,
    setCachedThreads,
    getCachedSyncResult,
    setCachedSyncResult,
    getCachedTriageResults,
    setCachedTriageResults,
    clearCache,
    clearExpiredCache,
    isCacheValid
  };

  return (
    <EmailCacheContext.Provider value={value}>
      {children}
    </EmailCacheContext.Provider>
  );
};
