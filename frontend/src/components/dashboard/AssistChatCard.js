import React from 'react';

export default function AssistChatCard({ onOpenChat }) {
  return (
    <div className="card">
      <h2>Assist Chat Agent</h2>
      <p>
        Ask questions about your emails, find important messages, and get help with email management.
        The agent can search your emails using semantic search and query triage results.
      </p>

      <div style={{ marginTop: '20px' }}>
        <button className="btn-primary" onClick={onOpenChat}>
          Open Assist Chat
        </button>
      </div>

      <div style={{ marginTop: '16px', fontSize: '13px', color: '#666' }}>
        <strong>Capabilities:</strong>
        <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
          <li>Find important emails that need attention</li>
          <li>Search emails by meaning (semantic search)</li>
          <li>Query triage results by label, priority, date</li>
          <li>Get email summaries and key points</li>
          <li>Continue previous conversations</li>
        </ul>
      </div>
    </div>
  );
}
