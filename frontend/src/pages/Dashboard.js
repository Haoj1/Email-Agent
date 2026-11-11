import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEmailCache } from '../contexts/EmailCacheContext';
import { api } from '../services/api';
import WorkspaceIcon from '../components/workspace/WorkspaceIcon';
import { PriorityBadge } from '../components/dashboard/EmailTriageCard';
import './Dashboard.css';

const previewLimit = 3;

function Preview({ title, icon, path, items, empty, children }) {
  return (
    <section className="card workspace-card home-preview" aria-label={title}>
      <div className="home-preview-heading">
        <h2><WorkspaceIcon name={icon} />{title}</h2>
        <Link className="workspace-link" to={path} aria-label={`View all ${title.toLowerCase()}`}>View all <WorkspaceIcon name="arrow" /></Link>
      </div>
      {items === undefined ? <p className="workspace-empty" role="status">Loading…</p>
        : items === null ? <p className="workspace-error" role="status">Couldn’t load this preview.</p>
        : items.length ? <ul>{items.map(children)}</ul> : <p className="workspace-empty">{empty}</p>}
    </section>
  );
}

function threadPath(threadId, mailbox) {
  const query = mailbox ? '?' + new URLSearchParams({ email: mailbox }) : '';
  return '/thread/' + encodeURIComponent(threadId) + query;
}

export default function Dashboard({ user, selectedEmail, promotions }) {
  const mailbox = selectedEmail || user.primary_email || user.emails?.[0]?.email;
  const { triageLastComplete } = useEmailCache();
  const [overview, setOverview] = useState(null);
  const viewKey = mailbox + ':' + promotions;

  useEffect(() => {
    if (!mailbox) return;
    const controller = new AbortController();
    const get = (url, params) => api.get(url, { params, signal: controller.signal });
    Promise.allSettled([
      get('/triage/results', { email: mailbox, days: 3, limit: previewLimit }),
      get('/follow-ups', { email: mailbox, limit: previewLimit }),
      get('/gmail/threads', { email: mailbox, days: 14, max_results: previewLimit, promotions }),
    ]).then(results => {
      if (controller.signal.aborted) return;
      const list = (index, field) => results[index].status === 'fulfilled'
        ? (results[index].value.data[field] || []).slice(0, previewLimit) : null;
      setOverview({ viewKey, priority: list(0, 'results'), followUps: list(1, 'items'), recent: list(2, 'threads') });
    });
    return () => controller.abort();
  }, [mailbox, promotions, viewKey, triageLastComplete?.run_id]);

  const current = overview?.viewKey === viewKey ? overview : {};
  const back = { backTo: '/dashboard' };

  return (
    <div className="home-overview">
      <header className="card home-lead">
        <div>
          <h1>Your workspace</h1>
          <p>See what needs attention and pick up your follow-ups.</p>
        </div>
        <div className="home-actions">
          <Link className="btn-primary" to="/assistant"><WorkspaceIcon name="spark" /> Ask Copilot</Link>
          <Link className="btn-secondary" to="/threads"><WorkspaceIcon name="mail" /> Open inbox</Link>
        </div>
      </header>
      {!mailbox ? <p className="workspace-empty">Connect a mailbox from the account menu to get started.</p> : (
        <div className="home-previews">
          <Preview title="Needs attention" icon="priority" path="/triage" items={current.priority}
            empty="Nothing needs attention in the last three days.">
            {item => <li key={item.id || item.thread_id}>
              <Link to={threadPath(item.thread_id, item.email || mailbox)} state={back}>
                <PriorityBadge priority={item.priority} />
                <strong>{item.subject || item.summary || 'Open conversation'}</strong>
                {item.subject && item.summary && <small>{item.summary}</small>}
              </Link>
            </li>}
          </Preview>
          <Preview title="Follow-ups" icon="followup" path="/follow-ups" items={current.followUps}
            empty="No active follow-ups.">
            {item => <li key={item.thread_id}>
              <Link to={threadPath(item.thread_id, mailbox)} state={back}>
                <strong>{item.subject || 'Open conversation'}</strong>
                <small>{item.due_at ? new Date(item.due_at).toLocaleDateString() : 'Open follow-up'}</small>
              </Link>
            </li>}
          </Preview>
          <Preview title="Recent mail" icon="mail" path="/threads" items={current.recent}
            empty="No recent conversations in this view.">
            {item => <li key={item.thread_id}>
              <Link to={threadPath(item.thread_id, mailbox)} state={back}>
                <strong>{item.subject || '(No subject)'}</strong>
                <small>{item.from?.split('<')[0].trim() || item.snippet}</small>
              </Link>
            </li>}
          </Preview>
        </div>
      )}
      <footer className="home-footer"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></footer>
    </div>
  );
}
