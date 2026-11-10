import React from 'react';

export default function AssistChatCard({ onOpenChat }) {
  return (
    <section className="card workspace-card workspace-tool-card">
      <div><p className="workspace-eyebrow">ASSISTANT</p><h2>Inbox Copilot</h2><p>Find related mail, pull out key points, and ask about your priorities.</p></div>
      <button type="button" className="btn-secondary" onClick={onOpenChat}>Open Copilot</button>
    </section>
  );
}
