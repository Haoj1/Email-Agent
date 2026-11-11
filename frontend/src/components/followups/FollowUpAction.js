import React, { useState } from 'react';
import { followUpLabels, saveFollowUp } from './FollowUpEditor';

export default function FollowUpAction({ action }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const due = action.due_at ? new Date(action.due_at).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }) : 'No due date';
  const label = action.status === 'done' ? 'Mark complete'
    : action.expected_updated_at ? 'Update follow-up' : 'Add follow-up';

  async function apply() {
    setSaving(true);
    setError('');
    try {
      await saveFollowUp(action.thread_id, action.email, action.status, action.due_at, action.expected_updated_at);
      setSaved(true);
    } catch (error) {
      setError(error.response?.status === 409
        ? 'This follow-up changed. Ask Copilot for an updated action.'
        : 'Could not save the follow-up. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="workspace-follow-up-action">
      <strong>{action.subject}</strong>
      <small>{action.email}</small>
      <span>{followUpLabels[action.status]} · {due}</span>
      {saved ? <span role="status">Saved to Follow-ups</span> : (
        <button type="button" className="btn-primary" disabled={saving} onClick={apply}>
          {saving ? 'Saving…' : label}
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
