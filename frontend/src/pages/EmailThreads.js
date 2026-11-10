import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailThreadsCard from '../components/dashboard/EmailThreadsCard';
import './Dashboard.css';

function EmailThreadsPage({ user, selectedEmail, onSelectEmail, onLogout }) {
  const [emailThreads, setEmailThreads] = useState(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const threadsRequest = useRef(null);
  useEffect(() => () => threadsRequest.current?.controller.abort(), []);
  const [emailThreadsNextPageToken, setEmailThreadsNextPageToken] = useState(null);
  const [daysFilter, setDaysFilter] = useState(14); // Default to 14 days
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState('exact');
  
  const navigate = useNavigate();
  const { getCachedThreads, setCachedThreads } = useEmailCache();

  useEffect(() => {
    if (user && user.authenticated) {
      loadEmailThreads(selectedEmail, false, false, daysFilter, searchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedEmail]);

  const loadEmailThreads = async (
    email = null,
    forceRefresh = false,
    isLoadMore = false,
    days = daysFilter,
    query = searchQuery,
    mode = searchMode
  ) => {
    const trimmedQuery = (query || '').trim();
    const previous = threadsRequest.current;
    previous?.controller.abort();
    const controller = new AbortController();
    threadsRequest.current = { email, controller, query: trimmedQuery, mode };


    if (!forceRefresh && !isLoadMore && !trimmedQuery) {
      const cached = getCachedThreads(email);
      // Only use cache if it matches current days filter
      if (cached && cached.days === days) {
        setLoadingThreads(false);
        setEmailThreads(cached);
        setEmailThreadsNextPageToken(cached.data?.next_page_token || null);
        return;
      }
    }

    setLoadingThreads(true);
    if (!isLoadMore) {
      setEmailThreadsNextPageToken(null);
      if (previous?.email !== email) setEmailThreads(null);
    }
    
    try {
      const params = { max_results: 30, days: days || 14 };
      if (email) params.email = email;
      if (trimmedQuery) {
        params.q = trimmedQuery;
        if (mode === 'fuzzy') params.mode = mode;
      }
      if (isLoadMore && emailThreadsNextPageToken) {
        params.page_token = emailThreadsNextPageToken;
      }

      const response = await api.get('/gmail/threads', { params, signal: controller.signal });
      if (controller.signal.aborted) return;
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
      if (!isLoadMore && !trimmedQuery) setCachedThreads(email, threadsData);
    } catch (error) {
      if (controller.signal.aborted) return;
      setEmailThreads({
        success: false,
        error: error.response?.data?.detail || error.message,
      });
    } finally {
      if (!controller.signal.aborted) setLoadingThreads(false);
    }
  };

  const handleDaysFilterChange = (days) => {
    setDaysFilter(days);
    loadEmailThreads(selectedEmail, true, false, days, searchQuery);
  };

  const handleSearchChange = (value) => {
    setSearchQuery(value);
  };

  const handleSearchSubmit = () => {
    loadEmailThreads(selectedEmail, true, false, daysFilter, searchQuery);
  };

  const handleSearchModeChange = (mode) => {
    setSearchMode(mode);
    if (searchQuery.trim()) loadEmailThreads(selectedEmail, true, false, daysFilter, searchQuery, mode);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    loadEmailThreads(selectedEmail, true, false, daysFilter, '');
  };

  const handleOpenThread = (threadId) => {
    const params = new URLSearchParams();
    if (selectedEmail) params.set('email', selectedEmail);
    navigate(`/thread/${threadId}?${params.toString()}`);
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-content full-width">
        <EmailThreadsCard
          loadingThreads={loadingThreads}
          onRefreshEmails={() => loadEmailThreads(selectedEmail, true)}
          onLoadMore={() => loadEmailThreads(selectedEmail, false, true, daysFilter, threadsRequest.current?.query, threadsRequest.current?.mode)}
          hasMore={!!emailThreadsNextPageToken}
          emailThreads={emailThreads}
          onOpenThread={handleOpenThread}
          daysFilter={daysFilter}
          onDaysFilterChange={handleDaysFilterChange}
          searchQuery={searchQuery}
            searchMode={searchMode}
            onSearchModeChange={handleSearchModeChange}
          onSearchChange={handleSearchChange}
          onSearchSubmit={handleSearchSubmit}
          onClearSearch={handleClearSearch}
        />
      </div>
    </div>
  );
}

export default EmailThreadsPage;
