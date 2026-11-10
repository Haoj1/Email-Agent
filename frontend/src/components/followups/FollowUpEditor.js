import React, { useEffect, useState } from 'react';
import { useEmailCache } from '../../contexts/EmailCacheContext';
import { api } from '../../services/api';
import WorkspaceIcon from '../workspace/WorkspaceIcon';

export const followUpLabels = {
  reply: 'I need to reply', waiting: 'Waiting for reply', later: 'Handle later', done: 'Completed',
};

const endpoint = threadId => '/follow-ups/' + encodeURIComponent(threadId);

export function saveFollowUp(threadId, email, status, dueAt) {
  return api.put(endpoint(threadId), { status, due_at: dueAt }, { params: { email } });
}

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function FollowUpEditor({ threadId, email }) {
  const [item, setItem] = useState(undefined);
  const [status, setStatus] = useState('reply');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const { triageLastComplete } = useEmailCache();

  useEffect(() => {
    const controller = new AbortController();
    api.get(endpoint(threadId), { params: { email }, signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setItem(data.item);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load the follow-up.');
      });
    return () => controller.abort();
  }, [threadId, email, loadAttempt, triageLastComplete]);

  useEffect(() => {
    setStatus(item?.status || 'reply');
    setDue(localDateTime(item?.due_at));
  }, [item?.status, item?.due_at]);

  async function save(event) {
    event.preventDefault();
    const deadline = new FormData(event.currentTarget).get('deadline');
    setSaving(true);
    setError('');
    try {
      const { data } = await saveFollowUp(threadId, email, status, deadline ? new Date(deadline).toISOString() : null);
      setItem(data.item);
      setLoadAttempt(attempt => attempt + 1);
    } catch {
      setError('Could not save the follow-up. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return <details className="workspace-related followup-editor">
    <summary><WorkspaceIcon name="followup" /> <strong>Follow-up</strong>
      {item && <span className="followup-badge">{followUpLabels[item.status]}</span>}
    </summary>
    {item?.reopened_at && <p className="followup-note">A new reply moved this conversation back to your queue.</p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {item === undefined ? (
      error ? <button className="btn-secondary" type="button" onClick={() => {
        setError(''); setLoadAttempt(attempt => attempt + 1);
      }}>Try again</button> : <p role="status">Loading follow-up…</p>
    ) : (
      <form onSubmit={save} className="followup-form">
        <label>Status<select value={status} onChange={event => setStatus(event.target.value)} disabled={saving}>
          {Object.entries(followUpLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Due date <small>(optional, local time)</small>
          <input name="deadline" type="datetime-local" value={due} onChange={event => setDue(event.target.value)} disabled={saving} />
        </label>
        <button className="btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : item ? 'Save follow-up' : 'Add to queue'}
        </button>
      </form>
    )}
  </details>;
}
