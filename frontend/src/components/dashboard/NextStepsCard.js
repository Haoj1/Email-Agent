import React from 'react';

export default function NextStepsCard() {
  return (
    <div className="card">
      <h2>Next Steps</h2>
      <ul className="next-steps">
        <li>✓ OAuth authentication complete</li>
        <li>✓ Database setup (PostgreSQL)</li>
        <li>✓ Email query functionality</li>
        <li>✓ Inbox sync functionality (方案 A: 不存储)</li>
        <li>✓ Email triage agent</li>
        <li>⏳ Thread chat agent</li>
      </ul>
    </div>
  );
}

