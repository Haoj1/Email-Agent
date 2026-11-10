import React, { useState } from 'react';
import { api } from '../../services/api';

export default function DraftEditor({ draft, threadId, email, onSaved }) {
  const [values, setValues] = useState({ to: draft.to || '', subject: draft.subject || '', body: draft.body || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const field = name => ({
    value: values[name],
    onChange: event => setValues({ ...values, [name]: event.target.value }),
    disabled: saving,
    required: true,
  });

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/thread-chat/save-draft', {
        ...values, thread_id: threadId, email: email || null,
      });
      if (!data.success || !data.gmail_draft_id) throw new Error('Draft unavailable');
      onSaved({ ...values, gmail_draft_id: data.gmail_draft_id });
    } catch {
      setError('Could not save this draft to Gmail. Your edits are still here.');
    } finally {
      setSaving(false);
    }
  }

  return <details className="thread-draft-editor">
    <summary>Review and edit draft</summary>
    <form onSubmit={save}>
      <label>To<input type="email" {...field('to')} /></label>
      <label>Subject<input type="text" {...field('subject')} /></label>
      <label>Reply<textarea rows={6} {...field('body')} /></label>
      <button className="draft-save-btn" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save draft to Gmail'}
      </button>
      {error && <p className="workspace-error" role="alert">{error}</p>}
    </form>
  </details>;
}
