import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailThreadsCard from '../components/dashboard/EmailThreadsCard';
import './Dashboard.css';

function EmailThreadsPage({ user, selectedEmail, onSelectEmail, onLogout }) {
  const [emailThreads, setEmailThreads] = useState(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [emailThreadsNextPageToken, setEmailThreadsNextPageToken] = useState(null);
  const [daysFilter, setDaysFilter] = useState(14); // Default to 14 days
  const [searchQuery, setSearchQuery] = useState('');
  
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
    query = searchQuery
  ) => {
    const trimmedQuery = (query || '').trim();

    if (!forceRefresh && !isLoadMore && !trimmedQuery) {
      const cached = getCachedThreads(email);
      // Only use cache if it matches current days filter
      if (cached && cached.days === days) {
        setEmailThreads(cached);
        return;
      }
    }

    setLoadingThreads(true);
    if (forceRefresh && !isLoadMore) {
      setEmailThreads(null);
      setEmailThreadsNextPageToken(null);
    }
    
    try {
      const params = { max_results: 30, days: days || 14 };
      if (email) params.email = email;
      if (trimmedQuery) params.q = trimmedQuery;
      if (isLoadMore && emailThreadsNextPageToken) {
        params.page_token = emailThreadsNextPageToken;
      }

      const response = await api.get('/gmail/threads', { params });
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
      if (!isLoadMore) setCachedThreads(email, threadsData);
    } catch (error) {
      setEmailThreads({
        success: false,
        error: error.response?.data?.detail || error.message,
      });
    } finally {
      setLoadingThreads(false);
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
          onLoadMore={() => loadEmailThreads(selectedEmail, false, true, daysFilter, searchQuery)}
          hasMore={!!emailThreadsNextPageToken}
          emailThreads={emailThreads}
          onOpenThread={handleOpenThread}
          daysFilter={daysFilter}
          onDaysFilterChange={handleDaysFilterChange}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onSearchSubmit={handleSearchSubmit}
          onClearSearch={handleClearSearch}
        />
      </div>
    </div>
  );
}

export default EmailThreadsPage;
