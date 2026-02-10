import React from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/logo.png';
import './PrivacyPolicy.css';

function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <div className="legal-header">
          <Link to="/" className="logo-link">
            <img src={logo} alt="Email Agent Logo" className="legal-logo" />
            <h1>Email Agent</h1>
          </Link>
        </div>
        
        <div className="legal-content">
          <h1>Privacy Policy</h1>
          <p className="last-updated">Last Updated: February 5, 2026</p>

          <section>
            <h2>1. Introduction</h2>
            <p>
              Welcome to Email Agent ("we," "our," or "us"). We are committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our email management service.
            </p>
          </section>

          <section>
            <h2>2. Information We Collect</h2>
            <h3>2.1 Gmail Data</h3>
            <p>
              When you connect your Gmail account, we access and process the following information:
            </p>
            <ul>
              <li>Email messages and threads</li>
              <li>Email metadata (sender, recipient, subject, timestamps)</li>
              <li>Email content for AI processing and analysis</li>
            </ul>

            <h3>2.2 Google Calendar Data</h3>
            <p>
              With your permission, we access:
            </p>
            <ul>
              <li>Calendar events and schedules</li>
              <li>Event details (title, description, time, attendees)</li>
            </ul>

            <h3>2.3 Account Information</h3>
            <p>
              We collect basic account information:
            </p>
            <ul>
              <li>Email address</li>
              <li>Name (from your Google account)</li>
              <li>OAuth tokens (stored securely for API access)</li>
            </ul>

            <h3>2.4 Usage Data</h3>
            <p>
              We may collect information about how you use our service:
            </p>
            <ul>
              <li>Feature usage patterns</li>
              <li>Interaction logs</li>
              <li>Error reports</li>
            </ul>
          </section>

          <section>
            <h2>3. How We Use Your Information</h2>
            <p>We use the collected information for the following purposes:</p>
            <ul>
              <li><strong>Email Management:</strong> To organize, prioritize, and manage your emails</li>
              <li><strong>AI Processing:</strong> To provide AI-powered features such as email triage, summarization, and intelligent responses</li>
              <li><strong>Calendar Integration:</strong> To suggest and create calendar events based on your emails</li>
              <li><strong>Service Improvement:</strong> To enhance our algorithms and user experience</li>
              <li><strong>Communication:</strong> To respond to your inquiries and provide support</li>
            </ul>
          </section>

          <section>
            <h2>4. Data Storage and Security</h2>
            <h3>4.1 Storage</h3>
            <p>
              Your data is stored securely in our database:
            </p>
            <ul>
              <li>Email metadata and embeddings are stored in our PostgreSQL database</li>
              <li>OAuth tokens are encrypted and stored securely</li>
              <li>We use industry-standard security measures to protect your data</li>
            </ul>

            <h3>4.2 Security Measures</h3>
            <p>
              We implement various security measures including:
            </p>
            <ul>
              <li>Encryption in transit (HTTPS)</li>
              <li>Encryption at rest for sensitive data</li>
              <li>Secure authentication via OAuth 2.0</li>
              <li>Regular security audits and updates</li>
            </ul>
          </section>

          <section>
            <h2>5. Data Sharing and Disclosure</h2>
            <p>
              We do not sell, trade, or rent your personal information to third parties. We may share your information only in the following circumstances:
            </p>
            <ul>
              <li><strong>Service Providers:</strong> With trusted third-party service providers who assist in operating our service (e.g., cloud hosting providers)</li>
              <li><strong>Legal Requirements:</strong> When required by law or to protect our rights and safety</li>
              <li><strong>With Your Consent:</strong> When you explicitly authorize us to share your information</li>
            </ul>
          </section>

          <section>
            <h2>6. AI and Machine Learning</h2>
            <p>
              Our service uses AI models (including DeepSeek and OpenAI) to process your emails:
            </p>
            <ul>
              <li>Email content is processed by AI models to provide intelligent features</li>
              <li>We use local embeddings (all-MiniLM-L6-v2) for semantic search</li>
              <li>AI processing is performed securely and in compliance with data protection standards</li>
              <li>We do not use your data to train third-party AI models without your explicit consent</li>
            </ul>
          </section>

          <section>
            <h2>7. Your Rights and Choices</h2>
            <p>You have the following rights regarding your personal information:</p>
            <ul>
              <li><strong>Access:</strong> Request access to your personal data</li>
              <li><strong>Deletion:</strong> Request deletion of your account and associated data</li>
              <li><strong>Revoke Access:</strong> Revoke OAuth permissions at any time through Google Account settings</li>
              <li><strong>Data Portability:</strong> Request a copy of your data in a portable format</li>
              <li><strong>Opt-Out:</strong> Disconnect your account and stop using the service at any time</li>
            </ul>
            <p>
              To exercise these rights, please contact us at <a href="mailto:haoji.bian@mail-agents.net">haoji.bian@mail-agents.net</a>.
            </p>
          </section>

          <section>
            <h2>8. Data Retention</h2>
            <p>
              We retain your data for as long as necessary to provide our services:
            </p>
            <ul>
              <li>Account data is retained while your account is active</li>
              <li>Upon account deletion, we will delete your data within 30 days</li>
              <li>Some data may be retained longer if required by law or for legitimate business purposes</li>
            </ul>
          </section>

          <section>
            <h2>9. Children's Privacy</h2>
            <p>
              Our service is not intended for users under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have collected information from a child under 13, please contact us immediately.
            </p>
          </section>

          <section>
            <h2>10. International Data Transfers</h2>
            <p>
              Your information may be transferred to and processed in countries other than your country of residence. We ensure that appropriate safeguards are in place to protect your data in accordance with this Privacy Policy.
            </p>
          </section>

          <section>
            <h2>11. Changes to This Privacy Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new Privacy Policy on this page and updating the "Last Updated" date. You are advised to review this Privacy Policy periodically for any changes.
            </p>
          </section>

          <section>
            <h2>12. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us:
            </p>
            <ul>
              <li>Email: <a href="mailto:haoji.bian@mail-agents.net">haoji.bian@mail-agents.net</a></li>
              <li>Domain: mail-agents.net</li>
            </ul>
          </section>
        </div>

        <div className="legal-footer">
          <Link to="/">Back to Home</Link>
          <span>|</span>
          <Link to="/terms">Terms of Service</Link>
        </div>
      </div>
    </div>
  );
}

export default PrivacyPolicy;
