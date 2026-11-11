import React, { useEffect, useRef } from 'react';
import WorkspaceIcon from '../workspace/WorkspaceIcon';
import { Link, useLocation } from 'react-router-dom';

const dateLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function senderName(value) {
  const address = value || '';
  return address.split('<')[0].trim().replace(/^"|"$/g, '') || address.replace(/[<>]/g, '').trim() || 'Unknown sender';
}

export default function EmailThreadsCard({
  loadingThreads, onLoadMore, hasMore, emailThreads, onOpenThread,
  daysFilter, onDaysFilterChange, searchQuery, onSearchChange, onSearchSubmit, onClearSearch, searchMode, onSearchModeChange,
  promotions, onPromotionsChange,
}) {
  const isStandalonePage = useLocation().pathname === '/threads';
  const searchInput = useRef(null);
  useEffect(() => {
    const focusSearch = event => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented
        || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const threads = emailThreads?.data?.threads || [];

  return (
    <section className="card workspace-card conversation-card" aria-labelledby="conversations-title" aria-busy={loadingThreads}>
      <div className="workspace-card-heading">
        <div>
          <p className="workspace-eyebrow"><WorkspaceIcon name="mail" /> MAILBOX</p>
          <h2 id="conversations-title">Inbox</h2>
        </div>
        {!isStandalonePage && <Link className="workspace-link" to="/threads">Open inbox <WorkspaceIcon name="arrow" /></Link>}
      </div>
      <form className="workspace-toolbar" onSubmit={event => { event.preventDefault(); onSearchSubmit(); }}>
        <label className="workspace-search-field">
          <WorkspaceIcon name="search" />
          <input ref={searchInput} type="search" aria-label="Search conversations" aria-keyshortcuts="/"
            placeholder="Subject, sender, or keyword" value={searchQuery || ''}
            onChange={event => onSearchChange(event.target.value)} />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <button type="submit" className="btn-secondary" disabled={loadingThreads}>Search</button>
        {searchQuery?.trim() && <button type="button" className="workspace-quiet" onClick={onClearSearch}>Clear</button>}
      </form>
      <div className="workspace-list-meta">
        <div className="workspace-search-modes" role="group" aria-label="Search mode">
          <button type="button" aria-pressed={searchMode === 'exact'} onClick={() => onSearchModeChange('exact')}>Keywords</button>
          <button type="button" aria-pressed={searchMode === 'fuzzy'} onClick={() => onSearchModeChange('fuzzy')}>Similar spelling</button>
        </div>
        <label className="workspace-filter">
          <span className="workspace-sr-only">Conversation date range</span>
          <select value={daysFilter || 14} onChange={event => onDaysFilterChange(Number(event.target.value))}>
            <option value={1}>Today</option><option value={3}>Last 3 days</option>
            <option value={7}>Last week</option><option value={14}>Last 2 weeks</option><option value={30}>Last month</option>
          </select>
        </label>
        <label className="workspace-filter">
          <span className="workspace-sr-only">Promotions visibility</span>
          <select value={promotions} onChange={event => onPromotionsChange(event.target.value)}>
            <option value="hide">Hide promotions</option>
            <option value="all">All mail</option>
            <option value="only">Promotions only</option>
          </select>
        </label>
        <span role="status">{loadingThreads ? 'Loading…' : `${threads.length} conversation${threads.length === 1 ? '' : 's'}`}</span>
      </div>
      {searchMode === 'fuzzy' && <p className="workspace-search-hint">
        Looks for close spellings in the latest 30 email subjects, senders, and previews.
      </p>}
      {emailThreads?.success === false && <p className="workspace-error" role="alert">{emailThreads.error}</p>}
      {!loadingThreads && emailThreads?.success && threads.length === 0 && <p className="workspace-empty">
        {promotions === 'only' ? 'No promotions found in this view.' : 'No conversations found in this view.'}
      </p>}
      <ul className="conversation-list">
        {threads.map((thread, index) => {
          const sender = senderName(thread.from);
          const initials = sender.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
          const date = new Date(thread.date);
          return (
            <li key={thread.thread_id}>
              <button type="button" className="conversation-row" onClick={() => onOpenThread(thread.thread_id)}>
                <span className={`conversation-avatar avatar-${index % 4}`} aria-hidden="true">{initials}</span>
                <span className="conversation-copy">
                  <span className="conversation-sender">{sender}</span>
                  <strong>{thread.subject || '(No subject)'}</strong>
                  {thread.snippet && <span className="conversation-snippet">{thread.snippet}</span>}
                </span>
                <span className="conversation-meta">
                  {thread.date && !Number.isNaN(date.getTime()) && <time dateTime={date.toISOString()}>{dateLabel.format(date)}</time>}
                  {thread.message_count > 1 && <small>{thread.message_count} messages</small>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore && <button type="button" className="workspace-load-more" disabled={loadingThreads} onClick={onLoadMore}>Load more conversations</button>}
    </section>
  );
}
