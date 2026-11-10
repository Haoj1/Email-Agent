import React, { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useEmailCache } from '../contexts/EmailCacheContext';
import WorkspaceIcon from '../components/workspace/WorkspaceIcon';
import { followUpLabels, saveFollowUp } from '../components/followups/FollowUpEditor';

const filters = { active: 'Open', ...followUpLabels };
const pageSize = 40;

function FollowUpQueue({ email }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const filter = Object.hasOwn(filters, params.get('status')) ? params.get('status') : 'active';
  const page = Math.max(0, Math.min(100000, Number.parseInt(params.get('page'), 10) || 0));
  const { triageLastComplete } = useEmailCache();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/follow-ups', {
      params: { email, status: filter === 'active' ? undefined : filter, limit: pageSize, offset: page * pageSize },
      signal: controller.signal,
    }).then(({ data }) => {
      if (!controller.signal.aborted) setResult(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Could not load your follow-ups.');
    });
    return () => controller.abort();
  }, [email, filter, page, reload, triageLastComplete]);

  function show(nextFilter, nextPage) {
    setError('');
    setResult(null);
    setParams({ status: nextFilter, ...(nextPage ? { page: nextPage } : {}) });
  }

  async function complete(item) {
    setSaving(item.thread_id);
    setError('');
    try {
      await saveFollowUp(item.thread_id, email, 'done', item.due_at);
      setResult(current => current && ({ ...current, items: current.items.filter(row => row.thread_id !== item.thread_id) }));
      setReload(value => value + 1);
    } catch {
      setError('Could not mark the conversation complete. Try again.');
    } finally {
      setSaving(null);
    }
  }

  const backTo = location.pathname + location.search;
  return <>
    <nav className="followup-filters" aria-label="Follow-up status">
      {Object.entries(filters).map(([key, label]) => <button key={key} type="button" className="btn-secondary"
        aria-pressed={filter === key} disabled={saving !== null}
        onClick={() => { if (filter !== key || page) show(key, 0); }}>{label}</button>)}
    </nav>
    {error && <p className="workspace-error" role="alert">{error} <button className="btn-secondary" type="button"
      onClick={() => { setError(''); setReload(value => value + 1); }}>Try again</button></p>}
    {!result && !error && <p className="workspace-empty" role="status">Loading follow-ups…</p>}
    {result?.items.length === 0 && <div className="followup-empty">
      <strong>{filter === 'active' ? 'You’re caught up' : 'No conversations in this view'}</strong>
      <p>Open a conversation to set a follow-up status or due date.</p>
      <Link className="btn-secondary" to="/threads"><WorkspaceIcon name="mail" /> Open Inbox</Link>
    </div>}
    {!!result?.items.length && <ul className="followup-list">
      {result.items.map(item => {
        const overdue = item.status !== 'done' && item.due_at && new Date(item.due_at) < new Date();
        return <li key={item.thread_id}>
          <div className="followup-item-main">
            <Link to={'/thread/' + encodeURIComponent(item.thread_id) + '?' + new URLSearchParams({ email })}
              state={{ backTo }}>{item.subject || '(No subject)'}</Link>
            <div className="followup-meta">
              <span className="followup-badge">{followUpLabels[item.status]}</span>
              {item.reopened_at && <span className="followup-badge">New reply</span>}
              {item.due_at && <time dateTime={item.due_at} className={overdue ? 'followup-overdue' : undefined}>
                {overdue ? 'Overdue · ' : 'Due · '}{new Date(item.due_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>}
            </div>
          </div>
          {item.status !== 'done' && <button className="btn-secondary" type="button" disabled={saving !== null}
            onClick={() => complete(item)}>{saving === item.thread_id ? 'Saving…' : 'Mark done'}</button>}
        </li>;
      })}
    </ul>}
    {(page > 0 || result?.has_more) && <div className="followup-pagination">
      <button className="btn-secondary" type="button" disabled={!page || saving !== null} onClick={() => show(filter, page - 1)}>Previous</button>
      <span>Page {page + 1}</span>
      <button className="btn-secondary" type="button" disabled={!result?.has_more || saving !== null} onClick={() => show(filter, page + 1)}>Next</button>
    </div>}
  </>;
}

export default function FollowUps({ email }) {
  return <section className="followup-page">
    <header>
      <p className="workspace-eyebrow"><WorkspaceIcon name="followup" /> MAILBOX WORKFLOW</p>
      <h1>Follow-ups</h1>
      <p>Keep track of replies you owe, conversations you’re waiting on, and work you’re saving for later.</p>
    </header>
    {email ? <FollowUpQueue key={email} email={email} /> : <p className="workspace-empty">Connect a mailbox to start.</p>}
  </section>;
}
