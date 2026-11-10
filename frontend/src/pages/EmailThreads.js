import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailThreadsCard from '../components/dashboard/EmailThreadsCard';
import './Dashboard.css';

function EmailThreadsPage({ user, selectedEmail, onSelectEmail, onLogout }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const { getCachedThreads, setCachedThreads, triageLastComplete, rememberReturnView, getReturnView } = useEmailCache();
  const saved = navigationType === 'POP' ? getReturnView(location.key) : null;
  const [restored] = useState(() => saved?.email === selectedEmail ? saved : null);
  const [emailThreads, setEmailThreads] = useState(restored?.results || null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const threadsRequest = useRef(null);
  useEffect(() => () => threadsRequest.current?.controller.abort(), []);
  const [emailThreadsNextPageToken, setEmailThreadsNextPageToken] = useState(restored?.nextPage || null);
  const [daysFilter, setDaysFilter] = useState(restored?.days ?? 14);
  const [searchQuery, setSearchQuery] = useState(restored?.query || '');
  const [searchMode, setSearchMode] = useState(restored?.mode || 'exact');
  
  const navigate = useNavigate();

  useEffect(() => {
    if (restored && restored.email === selectedEmail && !threadsRequest.current) {
      const frame = requestAnimationFrame(() => window.scrollTo(0, restored.scroll));
      return () => cancelAnimationFrame(frame);
    }
    if (user && user.authenticated) {
      loadEmailThreads(selectedEmail, false, false, daysFilter, searchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedEmail]);

  useEffect(() => {
    const mailbox = selectedEmail || user?.primary_email;
    if (triageLastComplete?.changedAccounts.includes(mailbox) && !(threadsRequest.current?.query ?? searchQuery.trim())
      && (emailThreads?.data?.threads?.length || 0) <= 30) {
      loadEmailThreads(selectedEmail, true, false, daysFilter, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageLastComplete?.run_id]);

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
    rememberReturnView(location.key, {
      email: selectedEmail, results: emailThreads, nextPage: emailThreadsNextPageToken,
      days: daysFilter, query: searchQuery, mode: searchMode,
    });
    navigate(`/thread/${threadId}?${params.toString()}`, { state: { backTo: location.pathname } });
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-content full-width">
        <EmailThreadsCard
          loadingThreads={loadingThreads}
          onLoadMore={() => loadEmailThreads(selectedEmail, false, true, daysFilter, threadsRequest.current?.query ?? searchQuery, threadsRequest.current?.mode ?? searchMode)}
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
