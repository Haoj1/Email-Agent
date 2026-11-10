import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailAccountsCard from '../components/dashboard/EmailAccountsCard';
import AssistChatCard from '../components/dashboard/AssistChatCard';
import EmailThreadsCard from '../components/dashboard/EmailThreadsCard';
import EmailTriageCard from '../components/dashboard/EmailTriageCard';
import './Dashboard.css';

const SuggestedScheduleCard = lazy(() => import('../components/dashboard/SuggestedScheduleCard'));
const AssistChatPanel = lazy(() => import('../components/assist/AssistChatPanel'));

function Dashboard({ user, selectedEmail, onSelectEmail, onLogout }) {
  const { 
    pendingTriageCount, 
    checkingPending, 
    checkPendingTriage, 
    triageRunning,
    triageProgress,
    triageStatus,
    triageLastComplete,
    triageLastError,
    triageAccountInfo,
    runTriage,
    setTriageAccountInfo
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
  const pendingTriageCheckIntervalRef = useRef(null);
  // Default to last 3 days for better signal-to-noise
  const [triageDaysFilter, setTriageDaysFilter] = useState(3);
  const [threadsSearchQuery, setThreadsSearchQuery] = useState('');
  
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

  const triagePollingRef = useRef(null);
  const TRIAGE_POLL_INTERVAL = 3000; 
  const TRIAGE_POLL_MAX_ATTEMPTS = 10;

  const stopTriagePolling = () => {
    if (triagePollingRef.current) {
      clearTimeout(triagePollingRef.current);
      triagePollingRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopTriagePolling();
  }, []);


  const loadEmailThreads = async (email = null, forceRefresh = false, isLoadMore = false, days = 14, query = threadsSearchQuery) => {
    const trimmedQuery = (query || '').trim();
    const previous = threadsRequest.current;
    previous?.controller.abort();
    const controller = new AbortController();
    threadsRequest.current = { email, controller };


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
    if (!isLoadMore && (forceRefresh || previous?.email !== email)) {
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

  const handleRunTriage = async () => {
    stopTriagePolling();
    // Clear old results so progress UI is visible while running
    setTriageResults(null);
    // Run triage across all connected email accounts so user doesn't need to switch manually
    const emails = (user?.emails || []).map((e) => e.email).filter(Boolean);
    const uniqueEmails = Array.from(new Set(emails));
    if (uniqueEmails.length === 0 && selectedEmail) {
      setTriageAccountInfo({ email: selectedEmail, index: 0, total: 1 });
      await runTriage({ email: selectedEmail, days: 7, max_results: 100 });
    } else if (uniqueEmails.length === 0) {
      setTriageAccountInfo({ email: null, index: 0, total: 1 });
      await runTriage({ email: null, days: 7, max_results: 100 });
    } else {
      for (let i = 0; i < uniqueEmails.length; i += 1) {
        const email = uniqueEmails[i];
        setTriageAccountInfo({ email, index: i, total: uniqueEmails.length });
        // eslint-disable-next-line no-await-in-loop
        await runTriage({ email, days: 7, max_results: 100 });
      }
    }
    setTriageAccountInfo(null);
  };

  const loadTriageResults = async (label = null, forceRefresh = false, returnData = false, isLoadMore = false, days = triageDaysFilter) => {
    if (!forceRefresh && !label && !isLoadMore && !days) {
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
      if (days) params.days = days;

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
      return returnData ? triageData : undefined;
    } catch (error) {
      setTriageResults({ success: false, error: error.message });
      return returnData ? null : undefined;
    } finally {
      setLoadingTriageResults(false);
    }
  };

  const startTriagePolling = () => {
    stopTriagePolling();
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      const data = await loadTriageResults(null, true, true);
      const hasResults = data?.success && Array.isArray(data.data?.results) && data.data.results.length > 0;
      if (hasResults || attempts >= TRIAGE_POLL_MAX_ATTEMPTS) {
        stopTriagePolling();
        return;
      }
      triagePollingRef.current = setTimeout(poll, TRIAGE_POLL_INTERVAL);
    };
    triagePollingRef.current = setTimeout(poll, TRIAGE_POLL_INTERVAL);
  };

  useEffect(() => {
    if (!triageLastComplete) return;

    const triageData = sortTriageData({
      success: triageLastComplete.success,
      data: {
        processed_count: triageLastComplete.processed_count,
        results: triageLastComplete.results || [],
        message: triageLastComplete.message,
      },
    });

    setTriageResults(triageData);
    setCachedTriageResults(null, triageData);
    loadTriageResults(null, true);
    startTriagePolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageLastComplete?.run_id]);

  useEffect(() => {
    if (!triageLastError) return;
    setTriageResults({ success: false, error: triageLastError.error || 'Unknown error' });
  }, [triageLastError]);

  useEffect(() => {
    if (user && user.authenticated) {
      loadEmailThreads(selectedEmail, false);
      loadTriageResults(null, false);
      // Check immediately on mount (respects global cooldown). Stats are global across all accounts.
      checkPendingTriage(null);
      
      // Then check every 5 minutes (300000 ms) - global cooldown will handle skipping if needed
      const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
      pendingTriageCheckIntervalRef.current = setInterval(() => {
        checkPendingTriage(null);
      }, CHECK_INTERVAL);
    }
    
    // Cleanup interval on unmount or when user/email changes
    return () => {
      if (pendingTriageCheckIntervalRef.current) {
        clearInterval(pendingTriageCheckIntervalRef.current);
        pendingTriageCheckIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedEmail]);

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
    loadEmailThreads(selectedEmail, true, false, days);
  };

  const handleThreadsSearchChange = (value) => {
    setThreadsSearchQuery(value);
  };

  const handleThreadsSearchSubmit = () => {
    loadEmailThreads(selectedEmail, true, false, emailThreads?.days || 14);
  };

  const handleThreadsClearSearch = () => {
    setThreadsSearchQuery('');
    loadEmailThreads(selectedEmail, true, false, emailThreads?.days || 14, '');
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
        <header className="workspace-intro">
          <div>
            <p className="workspace-eyebrow">INBOX WORKSPACE</p>
            <h1>Inbox overview</h1>
            <p>See what needs a reply, find related conversations, and plan your follow-ups.</p>
            <div className="workspace-intro-actions">
              <a className="btn-primary" href="#priority-inbox">Review priorities</a>
              <button type="button" className="btn-secondary" onClick={() => setShowAssistChat(true)}>Ask Copilot</button>
              <button type="button" className="workspace-quiet" onClick={() => { setShowOnboarding(true); setOnboardingStep(1); }}>Guide</button>
            </div>
          </div>
          <div className="workspace-intro-summary" aria-label="Workspace status">
            <div><strong>{checkingPending ? '…' : pendingTriageCount}</strong><span>Awaiting triage</span></div>
            <div><strong>{user?.emails?.length ?? 0}</strong><span>Connected mailboxes</span></div>
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
            onRefreshEmails={() => loadEmailThreads(selectedEmail, true)}
            onLoadMore={() =>
              loadEmailThreads(selectedEmail, false, true, emailThreads?.days)
            }
            hasMore={!!emailThreadsNextPageToken}
            emailThreads={emailThreads}
            onOpenThread={handleOpenThread}
            daysFilter={emailThreads?.days || 14}
            onDaysFilterChange={handleThreadsDaysFilterChange}
            searchQuery={threadsSearchQuery}
            onSearchChange={handleThreadsSearchChange}
            onSearchSubmit={handleThreadsSearchSubmit}
            onClearSearch={handleThreadsClearSearch}
          />
          {showOnboarding && onboardingStep === 2 && (
            <div className="onboarding-tooltip">
              <h3 className="onboarding-title">Conversations</h3>
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
            triageStatus={triageStatus}
            triageAccountInfo={triageAccountInfo}
            pendingCount={pendingTriageCount}
            checkingPending={checkingPending}
            daysFilter={triageDaysFilter}
            onDaysFilterChange={handleDaysFilterChange}
            onRunTriage={handleRunTriage}
            onRefreshStats={() => checkPendingTriage(null, true)}
            onLoadTriageResults={() => loadTriageResults(null, true)}
            onLoadMore={() => loadTriageResults(null, false, false, true)}
            onOpenThread={handleOpenThread}
          />
          {showOnboarding && onboardingStep === 3 && (
            <div className="onboarding-tooltip">
              <h3 className="onboarding-title">Priority Inbox</h3>
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
            <div><p className="workspace-eyebrow">FOLLOW-UPS</p><h2>Suggested schedule</h2><p>Review email follow-ups before adding them to your calendar.</p></div>
            <button type="button" className="btn-secondary" aria-expanded={Boolean(scheduleVisible)} onClick={() => setShowSchedule(!scheduleVisible)}>
              {scheduleVisible ? 'Hide schedule' : 'Open schedule'}
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
            <AssistChatPanel onClose={() => setShowAssistChat(false)} selectedEmail={selectedEmail} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
