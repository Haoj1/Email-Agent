import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import EmailTriageCard from '../components/dashboard/EmailTriageCard';
import './Dashboard.css';

async function animateReviewExit(row) {
  if (!row?.isConnected || !row.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try {
    const animation = row.animate([
      { height: `${row.getBoundingClientRect().height}px`, opacity: 1, transform: 'translateX(0)', overflow: 'hidden' },
      { height: '0px', opacity: 0, transform: 'translateX(16px)', overflow: 'hidden' },
    ], { duration: 220, easing: 'cubic-bezier(.22,.7,.3,1)', fill: 'forwards' });
    await animation.finished;
  } catch {
    // A cancelled animation must not prevent a saved review from leaving the list.
  }
}

function EmailTriagePage({ user, selectedEmail, onAiReviewChange }) {
  const { 
    triageRunning,
    triageProgress,
    triageStatus,
    triageLastComplete,
    triageLastError,
    triageAccountInfo,
  } = useEmailCache();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { getCachedTriageResults, setCachedTriageResults, getReturnView, rememberReturnView } = useEmailCache();
  const [restored] = useState(() => navigationType === 'POP' ? getReturnView(location.key) : null);
  const [triageResults, setTriageResults] = useState(restored?.results || null);
  const [reviewStatus, setReviewStatus] = useState(restored?.reviewStatus || 'pending');
  const [triageDaysFilter, setTriageDaysFilter] = useState(restored ? restored.days : 3);
  const [loadingTriageResults, setLoadingTriageResults] = useState(false);
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewMessage, setReviewMessage] = useState(null);
  const requestRef = useRef(null);
  const lastRefreshRun = useRef(null);
  const pageSize = 20;
  const navigate = useNavigate();

  useEffect(() => {
    if (restored) {
      const frame = requestAnimationFrame(() => window.scrollTo(0, restored.scroll));
      return () => cancelAnimationFrame(frame);
    }
    if (user?.authenticated) loadTriageResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const loadTriageResults = async ({
    refresh = false, more = false, days = triageDaysFilter, status = reviewStatus, preserve = false,
  } = {}) => {
    requestRef.current?.abort();
    if (!refresh && !more) {
      const cached = getCachedTriageResults(null);
      if (cached?.days === days && cached.reviewStatus === status) {
        setTriageResults(cached);
        setLoadingTriageResults(false);
        return;
      }
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setLoadingTriageResults(true);
    if (!more && !preserve) setTriageResults(null);
    const previous = more ? triageResults?.data?.results || [] : [];
    const params = { limit: pageSize, skip: previous.length, review_status: status };
    if (days) params.days = days;

    try {
      const { data } = await api.get('/triage/results', { params, signal: controller.signal });
      if (controller.signal.aborted) return;
      const results = [...previous, ...(data.results || [])];
      const next = { success: true, days, reviewStatus: status, data: { ...data, results, count: results.length } };
      setTriageResults(next);
      if (!more) setCachedTriageResults(null, next);
    } catch (error) {
      if (!controller.signal.aborted && !preserve) {
        setTriageResults({ success: false, error: error.message });
      }
    } finally {
      if (!controller.signal.aborted) setLoadingTriageResults(false);
    }
  };

  const handleOpenThread = (threadId, account = selectedEmail) => {
    const params = new URLSearchParams();
    if (account) params.set('email', account);
    rememberReturnView(location.key, { results: triageResults, reviewStatus, days: triageDaysFilter });
    navigate(`/thread/${threadId}?${params.toString()}`, { state: { backTo: location.pathname } });
  };

  const changeDays = days => {
    setTriageDaysFilter(days);
    loadTriageResults({ days });
  };

  const changeStatus = status => {
    if (status === reviewStatus) return;
    setReviewStatus(status);
    setReviewMessage(null);
    loadTriageResults({ status });
  };

  const setReviewed = async (item, reviewed, row) => {
    requestRef.current?.abort();
    setLoadingTriageResults(false);
    setReviewingId(item.id);
    setReviewMessage(null);
    try {
      await api.patch(`/triage/results/${item.id}/review`, {
        reviewed, email: item.email ?? null, last_inbound_at_ms: item.last_inbound_at_ms,
      });
      setCachedTriageResults(null, null);
      await animateReviewExit(row);
      setTriageResults(current => current?.data ? {
        ...current,
        data: { ...current.data,
          results: current.data.results.filter(result => result.id !== item.id),
          count: Math.max(0, current.data.count - 1),
          total_count: Math.max(0, current.data.total_count - 1),
        },
      } : current);
      setReviewMessage({ text: reviewed ? 'Marked as reviewed.' : 'Moved back to To review.' });
    } catch (error) {
      const changed = error.response?.status === 409;
      setReviewMessage({ error: true, text: changed
        ? 'This conversation has changed. Check the latest version.'
        : 'Could not update the review status. Try again.' });
      if (changed) await loadTriageResults({ refresh: true, preserve: true });
    } finally {
      setReviewingId(null);
    }
  };

  useEffect(() => {
    const runId = triageLastComplete?.run_id;
    if (reviewingId || runId === lastRefreshRun.current
      || !(triageLastComplete?.processed_count || triageLastComplete?.serverSync)) return;
    lastRefreshRun.current = runId;
    if ((triageResults?.data?.results?.length || 0) <= pageSize) {
      loadTriageResults({ refresh: true, preserve: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageLastComplete?.run_id, reviewingId]);

  return (
    <div className="dashboard-container">
      <div className="dashboard-content full-width">
        <EmailTriageCard
          runningTriage={triageRunning}
          loadingTriageResults={loadingTriageResults}
          triageResults={triageResults}
          triageProgress={triageProgress}
          triageLastComplete={triageLastComplete}
          hasMailboxes={Boolean(user?.emails?.length)}
          triageLastError={triageLastError}
          aiReviewMode={user?.ai_review_mode || 'off'}
          onAiReviewChange={onAiReviewChange}
          triageStatus={triageStatus}
          triageAccountInfo={triageAccountInfo}
          daysFilter={triageDaysFilter}
          onDaysFilterChange={changeDays}
          reviewStatus={reviewStatus}
          onReviewStatusChange={changeStatus}
          reviewingId={reviewingId}
          reviewMessage={reviewMessage}
          onSetReviewed={setReviewed}
          onLoadMore={() => loadTriageResults({ more: true })}
          onOpenThread={handleOpenThread}
        />
      </div>
    </div>
  );
}

export default EmailTriagePage;
