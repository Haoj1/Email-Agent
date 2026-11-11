import React, { useState } from 'react';
import WorkspaceIcon from '../workspace/WorkspaceIcon';
import { Link, useLocation } from 'react-router-dom';

export function PriorityBadge({ priority }) {
  const score = Math.round((priority || 0) * 100);
  const tone = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
  return <span className={`priority-badge priority-${tone}`}>{tone[0].toUpperCase() + tone.slice(1)} priority</span>;
}

export default function EmailTriageCard({
  runningTriage, loadingTriageResults, triageResults, triageProgress, triageStatus,
  triageAccountInfo, triageLastComplete, triageLastError, hasMailboxes, aiReviewMode, onAiReviewChange,
  daysFilter, onDaysFilterChange, onLoadMore, onOpenThread,
  reviewStatus, onReviewStatusChange, reviewingId, reviewMessage, onSetReviewed,
}) {
  const isStandalonePage = useLocation().pathname === '/triage';
  const results = triageResults?.data?.results || [];
  const isReviewed = reviewStatus === 'reviewed';
  const reviewBusy = reviewingId !== null;
  const busy = runningTriage || loadingTriageResults || reviewBusy;
  const [savingMode, setSavingMode] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const changeReviewMode = async mode => {
    setSavingMode(true);
    setSaveFailed(false);
    try {
      await onAiReviewChange(mode);
    } catch {
      setSaveFailed(true);
    } finally {
      setSavingMode(false);
    }
  };

  return (
    <section id="priority-inbox" className="card workspace-card priority-card" aria-labelledby="priorities-title">
      <div className="workspace-card-heading">
        <div><p className="workspace-eyebrow"><WorkspaceIcon name="priority" /> NEEDS ATTENTION</p><h2 id="priorities-title">Needs attention</h2></div>
        {!isStandalonePage && <Link className="workspace-link" to="/triage">See all <WorkspaceIcon name="arrow" /></Link>}
      </div>
      <div className="workspace-toolbar priority-toolbar">
        <span className="workspace-autosync">
          <WorkspaceIcon name="refresh" className={runningTriage ? 'workspace-spinning' : ''} />
          {hasMailboxes ? 'Updates automatically' : 'Connect a mailbox to get updates'}
        </span>
        <div className="priority-filters">
          <div className="workspace-search-modes" role="group" aria-label="Review status">
            <button type="button" aria-pressed={reviewStatus === 'pending'} disabled={reviewBusy}
              onClick={() => onReviewStatusChange('pending')}>To review</button>
            <button type="button" aria-pressed={reviewStatus === 'reviewed'} disabled={reviewBusy}
              onClick={() => onReviewStatusChange('reviewed')}>Reviewed</button>
          </div>
          <label className="workspace-filter">
            <span className="workspace-sr-only">Priority date range</span>
            <select value={daysFilter ?? ''} disabled={reviewBusy}
              onChange={event => onDaysFilterChange(event.target.value ? Number(event.target.value) : null)}>
              <option value="">All time</option><option value="1">Today</option><option value="3">Last 3 days</option>
              <option value="5">Last 5 days</option><option value="7">Last week</option><option value="30">Last month</option>
            </select>
          </label>
        </div>
      </div>
      {hasMailboxes && <details className="workspace-email-options">
        <summary>Email summary options</summary>
        <div className="workspace-ai-review">
          <label className="workspace-filter">
            <span>AI review</span>
            <select value={aiReviewMode} disabled={savingMode} aria-describedby="ai-review-help"
              onChange={event => changeReviewMode(event.target.value)}>
              <option value="off">Off</option>
              <option value="unclear">New unclear emails</option>
              <option value="primary_important">New Primary or Important emails</option>
            </select>
          </label>
          <small id="ai-review-help">Saved to your account. AI reviews new mail while Email Agent is open.
            Primary or Important mode uses previews first, then sends a short body excerpt to DeepSeek if needed.</small>
          {savingMode && <small role="status">Saving…</small>}
          {saveFailed && <small className="workspace-error" role="alert">Could not save your preference. Try again.</small>}
        </div>
      </details>}
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
      {!runningTriage && triageLastError && <p className="workspace-error" role="status">Email updates paused. We’ll try again automatically.</p>}
      {!runningTriage && triageLastComplete?.completedAt && <p className="workspace-search-hint" role="status">
        {triageLastComplete.processed_count > 0
          ? `${triageLastComplete.processed_count} conversation${triageLastComplete.processed_count === 1 ? '' : 's'} updated`
          : triageLastComplete.serverSync ? 'Mailbox updated' : 'No new changes'}
        {triageLastComplete.aiCalls > 0 && ` · ${triageLastComplete.aiCalls} AI batch(es), ${triageLastComplete.aiReviewed} refined`}
        {triageLastComplete.hasMore && ' · continuing automatically'}
        {triageLastComplete.aiUnavailable && ' · AI was unavailable, basic checks still completed'}
      </p>}
      {loadingTriageResults && !runningTriage && <p className="workspace-empty" role="status">Loading priorities…</p>}
      {triageResults?.success === false && <p className="workspace-error" role="alert">{triageResults.error}</p>}
      {reviewMessage && <p className={reviewMessage.error ? 'workspace-error' : 'workspace-search-hint'}
        role={reviewMessage.error ? 'alert' : 'status'}>{reviewMessage.text}</p>}
      {triageResults?.success && !results.length && <p className="workspace-empty">
        {reviewStatus === 'reviewed' ? 'No reviewed conversations in this date range.'
          : runningTriage ? 'Checking your mailbox. Summaries will appear here.' : 'Nothing to review in this date range.'}
      </p>}
      <ul className="priority-list">
        {results.map((result, index) => {
          return (
            <li key={result.id || `${result.email || ''}-${result.thread_id}-${index}`}>
              <article className="priority-item">
                <div className="priority-badges"><PriorityBadge priority={result.priority} /><span>{({ NEEDS_REPLY: 'Needs reply', FYI: 'FYI', ARCHIVE: 'Archive', SPAM_LIKE: 'Likely spam', REVIEW: 'Review' })[result.label] || result.label || 'Review'}</span></div>
                <button type="button" className="priority-open" disabled={!result.thread_id} onClick={() => onOpenThread(result.thread_id, result.email)}>
                  {result.subject || result.summary || 'Open conversation'} <WorkspaceIcon name="arrow" />
                </button>
                {result.subject && result.summary && <p>{result.summary}</p>}
                {result.key_points?.length > 0 && <details className="priority-points"><summary>Key points</summary><ul>{result.key_points.map((point, i) => <li key={i}>{point}</li>)}</ul></details>}
                <div className="priority-item-footer">
                  {result.email && <small title={result.email}>{result.email}</small>}
                  {result.id && <label className="priority-review-action" aria-busy={reviewingId === result.id}>
                    <input type="checkbox"
                      checked={reviewingId === result.id ? !isReviewed : isReviewed}
                      disabled={reviewBusy || loadingTriageResults}
                      onChange={event => onSetReviewed(result, event.target.checked)} />
                    <span>{isReviewed ? 'Reviewed' : 'Mark as reviewed'}</span>
                  </label>}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      {triageResults?.data?.total_count > results.length && <button type="button" className="workspace-load-more" onClick={onLoadMore} disabled={busy}>Load more priorities</button>}
    </section>
  );
}
