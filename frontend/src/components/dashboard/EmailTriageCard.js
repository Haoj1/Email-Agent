import React from 'react';
import WorkspaceIcon from '../workspace/WorkspaceIcon';
import { Link, useLocation } from 'react-router-dom';

export default function EmailTriageCard({
  runningTriage, loadingTriageResults, triageResults, triageProgress, triageStatus,
  triageAccountInfo, triageLastComplete, triageLastError, hasContinuation, reviewUnclear, onReviewUnclearChange, pendingCount, checkingPending, daysFilter, onDaysFilterChange,
  onRunTriage, onRefreshStats, onLoadTriageResults, onLoadMore, onOpenThread,
}) {
  const isStandalonePage = useLocation().pathname === '/triage';
  const results = triageResults?.data?.results || [];
  const busy = runningTriage || loadingTriageResults;

  return (
    <section id="priority-inbox" className="card workspace-card priority-card" aria-labelledby="priorities-title">
      <div className="workspace-card-heading">
        <div><p className="workspace-eyebrow"><WorkspaceIcon name="priority" /> NEEDS ATTENTION</p><h2 id="priorities-title">Needs attention</h2></div>
        {!isStandalonePage && <Link className="workspace-link" to="/triage">See all <WorkspaceIcon name="arrow" /></Link>}
      </div>
      <div className="workspace-toolbar priority-toolbar">
        <button type="button" className="btn-primary" onClick={onRunTriage} disabled={busy}><WorkspaceIcon name={runningTriage ? 'refresh' : 'priority'} className={runningTriage ? 'workspace-spinning' : ''} /> {runningTriage ? 'Scanning…' : hasContinuation ? 'Continue checking' : 'Check emails'}</button>
        <label className="workspace-filter">
          <span className="workspace-sr-only">Priority date range</span>
          <select value={daysFilter ?? ''} onChange={event => onDaysFilterChange(event.target.value ? Number(event.target.value) : null)}>
            <option value="">All time</option><option value="1">Today</option><option value="3">Last 3 days</option>
            <option value="5">Last 5 days</option><option value="7">Last week</option><option value="30">Last month</option>
          </select>
        </label>
      </div>
      <div className="workspace-list-meta">
        <span role="status">{checkingPending ? 'Checking…' : pendingCount > 0 ? `${pendingCount} new in recent check` : 'No new threads in recent check'}</span>
        <button type="button" className="workspace-quiet" onClick={onRefreshStats} disabled={busy || checkingPending}>Refresh count</button>
      </div>
      <label className="workspace-ai-review">
        <input type="checkbox" checked={reviewUnclear} disabled={busy}
          onChange={event => onReviewUnclearChange(event.target.checked)} />
        <span>Use AI for unclear emails <small>{reviewUnclear ? 'Reviews up to 25 email previews together' : 'Off by default. Checks Gmail labels, subjects, and previews.'}</small></span>
      </label>
      {runningTriage && (
        <div className="workspace-progress" role="status">
          <strong>{triageStatus || 'Scanning conversations…'}</strong>
          {triageProgress?.total > 0 && <>
            <progress aria-label="Triage progress" max={triageProgress.total} value={triageProgress.current} />
            <span>{triageProgress.current} of {triageProgress.total} conversations</span>
          </>}
          {triageAccountInfo && <span>{triageAccountInfo.email || 'Primary mailbox'} · {triageAccountInfo.index + 1}/{triageAccountInfo.total}</span>}
        </div>
      )}
      {!runningTriage && triageLastError && <p className="workspace-error" role="alert">{triageLastError.error}</p>}
      {!runningTriage && triageLastComplete?.scanned > 0 && <p className="workspace-search-hint" role="status">
        {triageLastComplete.scanned} checked · {triageLastComplete.processed_count} updated · {triageLastComplete.skipped} unchanged
        {triageLastComplete.aiCalls > 0 && ` · ${triageLastComplete.aiCalls} AI batch(es), ${triageLastComplete.aiReviewed} refined`}
        {hasContinuation && ' · more emails to check'}
        {triageLastComplete.aiUnavailable && ' · AI was unavailable, basic checks still completed'}
      </p>}
      {loadingTriageResults && !runningTriage && <p className="workspace-empty" role="status">Loading priorities…</p>}
      {triageResults?.success === false && <p className="workspace-error" role="alert">{triageResults.error}</p>}
      {triageResults?.success && !results.length && <p className="workspace-empty">No checked emails in this date range.</p>}
      <ul className="priority-list">
        {results.map((result, index) => {
          const score = Math.round((result.priority || 0) * 100);
          return (
            <li key={result.id || `${result.email || ''}-${result.thread_id}-${index}`}>
              <article className="priority-item">
                <div className="priority-badges"><span className={score >= 80 ? 'priority-tag urgent' : 'priority-tag'}>{({ NEEDS_REPLY: 'Needs reply', FYI: 'FYI', ARCHIVE: 'Archive', SPAM_LIKE: 'Likely spam', REVIEW: 'Review' })[result.label] || result.label || 'Review'}</span><span>{score >= 80 ? 'High priority' : score >= 50 ? 'Medium priority' : 'Low priority'}</span></div>
                <button type="button" className="priority-open" disabled={!result.thread_id} onClick={() => onOpenThread(result.thread_id, result.email)}>
                  {result.subject || result.summary || 'Open conversation'} <WorkspaceIcon name="arrow" />
                </button>
                {result.subject && result.summary && <p>{result.summary}</p>}
                {result.key_points?.length > 0 && <details className="priority-points"><summary>Key points</summary><ul>{result.key_points.map((point, i) => <li key={i}>{point}</li>)}</ul></details>}
                {result.email && <small title={result.email}>{result.email}</small>}
              </article>
            </li>
          );
        })}
      </ul>
      {triageResults?.data?.total_count > results.length && <button type="button" className="workspace-load-more" onClick={onLoadMore} disabled={busy}>Load more priorities</button>}
      <button type="button" className="workspace-load-more" onClick={onLoadTriageResults} disabled={busy}>Refresh results</button>
    </section>
  );
}
