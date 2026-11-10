import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailAccountsCard from '../components/dashboard/EmailAccountsCard';
import AssistChatCard from '../components/dashboard/AssistChatCard';
import EmailThreadsCard from '../components/dashboard/EmailThreadsCard';
import EmailTriageCard from '../components/dashboard/EmailTriageCard';
import WorkspaceIcon from '../components/workspace/WorkspaceIcon';
import './Dashboard.css';

const SuggestedScheduleCard = lazy(() => import('../components/dashboard/SuggestedScheduleCard'));
const AssistChatPanel = lazy(() => import('../components/assist/AssistChatPanel'));

function Dashboard({ user, selectedEmail, onSelectEmail, onLogout }) {
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
  const [emailThreads, setEmailThreads] = useState(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const threadsRequest = useRef(null);
  useEffect(() => () => threadsRequest.current?.controller.abort(), []);
  const [emailThreadsNextPageToken, setEmailThreadsNextPageToken] = useState(null);
  const [triageResults, setTriageResults] = useState(null);
  const [triagePage, setTriagePage] = useState(0);
  const TRIAGE_PAGE_SIZE = 20;
  const [loadingTriageResults, setLoadingTriageResults] = useState(false);
  // Default to last 3 days for better signal-to-noise
  const [triageDaysFilter, setTriageDaysFilter] = useState(3);
  const [threadsSearchQuery, setThreadsSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState('exact');
  const [threadDays, setThreadDays] = useState(14);
  
  const [addingEmail, setAddingEmail] = useState(false);
  const [addEmailError, setAddEmailError] = useState(null);
  const [showAssistChat, setShowAssistChat] = useState(null);
  const [showSchedule, setShowSchedule] = useState(null);
  const [onboardingStep, setOnboardingStep] = useState(0); // 0 = inactive, 1..N = steps
  const [showOnboarding, setShowOnboarding] = useState(false);
  const onboardingAccountsRef = useRef(null);
  const onboardingConversationsRef = useRef(null);
  const onboardingPriorityRef = useRef(null);
  const onboardingCopilotRef = useRef(null);
  const onboardingCalendarRef = useRef(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    getCachedThreads,
    setCachedThreads,
    getCachedTriageResults,
    setCachedTriageResults,
  } = useEmailCache();

  useEffect(() => {
    // Check if we just added an email (from callback)
    const action = searchParams.get('action');
    const success = searchParams.get('success');
    if (action === 'add_email' && success === 'true') {
      setTimeout(() => {
        setSearchParams({});
      }, 500);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!showOnboarding || !onboardingStep) return;

    const el =
      onboardingStep === 1
        ? onboardingAccountsRef.current
        : onboardingStep === 2
        ? onboardingConversationsRef.current
        : onboardingStep === 3
        ? onboardingPriorityRef.current
        : onboardingStep === 4
        ? onboardingCopilotRef.current
        : onboardingStep === 5
        ? onboardingCalendarRef.current
        : null;

    if (!el || typeof el.scrollIntoView !== 'function') return;

    // Defer to next paint so layout is stable before scrolling
    const id = window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [showOnboarding, onboardingStep]);

  const loadEmailThreads = async (email = null, forceRefresh = false, isLoadMore = false, days = threadDays, query = threadsSearchQuery, mode = searchMode) => {
    const trimmedQuery = (query || '').trim();
    const previous = threadsRequest.current;
    previous?.controller.abort();
    const controller = new AbortController();
    threadsRequest.current = { email, controller, query: trimmedQuery, mode };


    if (!forceRefresh && !isLoadMore && !trimmedQuery) {
      const cached = getCachedThreads(email);
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
      return returnData ? triageData : undefined;
    } catch (error) {
      if (!preserve) setTriageResults({ success: false, error: error.message });
      return returnData ? null : undefined;
    } finally {
      setLoadingTriageResults(false);
    }
  };

  useEffect(() => {
    if (triageLastComplete?.processed_count && triagePage === 0) {
      loadTriageResults(null, true, false, false, triageDaysFilter, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageLastComplete?.run_id]);



  useEffect(() => {
    if (user?.authenticated) loadEmailThreads(selectedEmail, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedEmail]);

  useEffect(() => {
    if (user?.authenticated) loadTriageResults(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const mailbox = selectedEmail || user?.primary_email;
    if (triageLastComplete?.changedAccounts.includes(mailbox) && !threadsRequest.current?.query
      && (emailThreads?.data?.threads?.length || 0) <= 30) {
      loadEmailThreads(selectedEmail, true, false, threadDays, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageLastComplete?.run_id]);

  const handleOpenThread = (threadId, account = selectedEmail) => {
    const params = new URLSearchParams();
    if (account) params.set('email', account);
    navigate(`/thread/${threadId}?${params.toString()}`);
  };

  const handleAddEmail = async () => {
    if (!user || !user.user_id) {
      setAddEmailError('User ID not found. Please refresh the page.');
      return;
    }
    try {
      setAddingEmail(true);
      setAddEmailError(null);
      const response = await api.get('/auth/google/login', {
        params: { action: 'add_email', user_id: user.user_id },
      });
      if (response.data.authUrl) window.location.href = response.data.authUrl;
      else setAddEmailError('Failed to get OAuth URL');
    } catch (error) {
      setAddEmailError(error.response?.data?.detail || error.message);
      setAddingEmail(false);
    }
  };

  const handleDaysFilterChange = (days) => {
    setTriageDaysFilter(days);
    loadTriageResults(null, true, false, false, days);
  };

  const handleThreadsDaysFilterChange = (days) => {
    setThreadDays(days);
    loadEmailThreads(selectedEmail, true, false, days);
  };

  const handleThreadsSearchChange = (value) => {
    setThreadsSearchQuery(value);
  };

  const handleThreadsSearchSubmit = () => {
    loadEmailThreads(selectedEmail, true, false, threadDays);
  };

  const handleSearchModeChange = (mode) => {
    setSearchMode(mode);
    if (threadsSearchQuery.trim()) loadEmailThreads(selectedEmail, true, false, threadDays, threadsSearchQuery, mode);
  };

  const handleThreadsClearSearch = () => {
    setThreadsSearchQuery('');
    loadEmailThreads(selectedEmail, true, false, threadDays, '');
  };

  const completeOnboarding = () => {
    setShowOnboarding(false);
    setOnboardingStep(0);
    try {
      localStorage.setItem('emailAgent_onboarding_completed', 'true');
    } catch {
      // ignore storage errors
    }
  };

  const handleOnboardingNext = () => {
    // Define 5 steps: 1=Accounts, 2=Conversations, 3=Priority Inbox, 4=Inbox Copilot, 5=Calendar
    if (onboardingStep >= 5) {
      completeOnboarding();
    } else {
      setOnboardingStep(onboardingStep + 1);
    }
  };

  const handleOnboardingSkip = () => {
    completeOnboarding();
  };

  const scheduleVisible = showSchedule || (showOnboarding && onboardingStep === 5);

  return (
    <div className="dashboard-container">
      <div className="dashboard-content workspace-dashboard">
        <div className="workspace-topline">
          <span>Workspace</span>
          <span className="workspace-connection">{user?.emails?.length ? 'Mailboxes connected' : 'No connected mailboxes'}</span>
        </div>
        <header className="workspace-intro">
          <div className="workspace-intro-copy">
            <h1>Your inbox</h1>
            <p>Find emails, see what needs a reply, and plan your follow-ups.</p>
            <div className="workspace-intro-actions">
              <a className="btn-primary" href="#priority-inbox"><WorkspaceIcon name="priority" /> Review follow-ups</a>
              <button type="button" className="btn-secondary" onClick={() => setShowAssistChat(true)}><WorkspaceIcon name="spark" /> Ask Copilot</button>
              <button type="button" className="workspace-quiet" onClick={() => { setShowOnboarding(true); setOnboardingStep(1); }}>Guide</button>
            </div>
          </div>
          <div className="workspace-intro-summary" aria-label="Workspace status">
            <div><WorkspaceIcon name="priority" /><strong>{triageRunning ? '…' : triageLastComplete?.processed_count ?? '—'}</strong><span>Updated last check</span></div>
            <div><WorkspaceIcon name="mail" /><strong>{user?.emails?.length ?? 0}</strong><span>Connected mailboxes</span></div>
          </div>
        </header>
        <div
          ref={onboardingAccountsRef}
          className={`onboarding-section workspace-accounts ${
            showOnboarding && onboardingStep === 1 ? 'onboarding-active' : ''
          }`}
        >
          <EmailAccountsCard
            user={user}
            selectedEmail={selectedEmail}
            onSelectEmail={onSelectEmail}
            onAddEmail={handleAddEmail}
            addingEmail={addingEmail}
            addEmailError={addEmailError}
          />
          {showOnboarding && onboardingStep === 1 && (
            <div className="onboarding-tooltip">
              <h3 className="onboarding-title">Choose your email account</h3>
              <p className="onboarding-text">
                Here you can see all connected accounts, switch between them, and add new inboxes.
              </p>
              <div className="onboarding-buttons">
                <button className="btn-secondary" onClick={handleOnboardingSkip}>
                  Skip guide
                </button>
                <button className="btn-primary" onClick={handleOnboardingNext}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        <div
          ref={onboardingCopilotRef}
          className={`onboarding-section workspace-copilot ${
            showOnboarding && onboardingStep === 4 ? 'onboarding-active' : ''
          }`}
        >
          <AssistChatCard onOpenChat={() => setShowAssistChat(true)} />
          {showOnboarding && onboardingStep === 4 && (
            <div className="onboarding-tooltip">
              <h3 className="onboarding-title">Inbox Copilot</h3>
              <p className="onboarding-text">
                Chat with an AI assistant about your emails, ask how to use this app, and get
                step‑by‑step help.
              </p>
              <div className="onboarding-buttons">
                <button className="btn-secondary" onClick={handleOnboardingSkip}>
                  Skip guide
                </button>
                <button className="btn-primary" onClick={handleOnboardingNext}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        <div
          ref={onboardingConversationsRef}
          className={`onboarding-section workspace-conversations ${
            showOnboarding && onboardingStep === 2 ? 'onboarding-active' : ''
          }`}
        >
          <EmailThreadsCard
            loadingThreads={loadingThreads}
            onLoadMore={() =>
              loadEmailThreads(selectedEmail, false, true, threadDays, threadsRequest.current?.query, threadsRequest.current?.mode)
            }
            hasMore={!!emailThreadsNextPageToken}
            emailThreads={emailThreads}
            onOpenThread={handleOpenThread}
            daysFilter={threadDays}
            onDaysFilterChange={handleThreadsDaysFilterChange}
            searchQuery={threadsSearchQuery}
            searchMode={searchMode}
            onSearchModeChange={handleSearchModeChange}
            onSearchChange={handleThreadsSearchChange}
            onSearchSubmit={handleThreadsSearchSubmit}
            onClearSearch={handleThreadsClearSearch}
          />
          {showOnboarding && onboardingStep === 2 && (
            <div className="onboarding-tooltip">
              <h3 className="onboarding-title">Inbox</h3>
              <p className="onboarding-text">
                Browse and search your email threads by time range or keyword, and open any
                conversation in detail.
              </p>
              <div className="onboarding-buttons">
                <button className="btn-secondary" onClick={handleOnboardingSkip}>
                  Skip guide
                </button>
                <button className="btn-primary" onClick={handleOnboardingNext}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        <div
          ref={onboardingPriorityRef}
          className={`onboarding-section workspace-priority ${
            showOnboarding && onboardingStep === 3 ? 'onboarding-active' : ''
          }`}
        >
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
          {showOnboarding && onboardingStep === 3 && (
            <div className="onboarding-tooltip">
              <h3 className="onboarding-title">Needs attention</h3>
              <p className="onboarding-text">
                Run Update Priorities to scan for important emails, then work through the
                high‑priority list first.
              </p>
              <div className="onboarding-buttons">
                <button className="btn-secondary" onClick={handleOnboardingSkip}>
                  Skip guide
                </button>
                <button className="btn-primary" onClick={handleOnboardingNext}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        <div
          ref={onboardingCalendarRef}
          className={`onboarding-section workspace-schedule ${
            showOnboarding && onboardingStep === 5 ? 'onboarding-active' : ''
          }`}
        >
          <section className="card workspace-card workspace-tool-card">
            <div><p className="workspace-eyebrow"><WorkspaceIcon name="calendar" /> FOLLOW-UPS</p><h2>Plan follow-ups</h2><p>Review email follow-ups before adding them to your calendar.</p></div>
            <button type="button" className="btn-secondary" aria-expanded={Boolean(scheduleVisible)} onClick={() => setShowSchedule(!scheduleVisible)}>
              {scheduleVisible ? 'Hide schedule' : 'View suggested times'}
            </button>
          </section>
          {(showSchedule !== null || scheduleVisible) && (
            <div hidden={!scheduleVisible} className="workspace-schedule-panel">
              <Suspense fallback={<p className="workspace-empty" role="status">Loading schedule…</p>}>
                <SuggestedScheduleCard selectedEmail={selectedEmail} />
              </Suspense>
            </div>
          )}
          {showOnboarding && onboardingStep === 5 && (
            <div className="onboarding-tooltip">
              <h3 className="onboarding-title">Suggested Schedule</h3>
              <p className="onboarding-text">
                Turn important emails into a weekly plan. Drag to move, resize to adjust duration,
                and confirm to create calendar events.
              </p>
              <div className="onboarding-buttons">
                <button className="btn-secondary" onClick={handleOnboardingSkip}>
                  Skip guide
                </button>
                <button className="btn-primary" onClick={handleOnboardingNext}>
                  Finish
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <footer className="dashboard-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h4>Email Agent</h4>
            <p>AI-powered email management with Gmail and Calendar</p>
          </div>
          <div className="footer-section">
            <h4>Contact</h4>
            <p>
              <a href="mailto:haoji.bian@mail-agents.net">haoji.bian@mail-agents.net</a>
            </p>
          </div>
          <div className="footer-section">
            <h4>Links</h4>
            <p>
              <a href="https://github.com/Haoj1/Email-Agent" target="_blank" rel="noopener noreferrer">
                GitHub Repository
              </a>
            </p>
            <p>
              <a href="/privacy">Privacy Policy</a>
            </p>
            <p>
              <a href="/terms">Terms of Service</a>
            </p>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} Email Agent. All rights reserved.</p>
        </div>
      </footer>
      {showAssistChat !== null && (
        <div className={`thread-chat-wrapper ${showAssistChat ? 'open' : ''}`} hidden={!showAssistChat}>
          <Suspense fallback={<p className="workspace-panel-loading" role="status">Loading Copilot…</p>}>
            <AssistChatPanel isOpen={showAssistChat} onClose={() => setShowAssistChat(false)} selectedEmail={selectedEmail} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
