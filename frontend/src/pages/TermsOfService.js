import React from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/logo.png';
import './TermsOfService.css';

function TermsOfService() {
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
          <h1>Terms of Service</h1>
          <p className="last-updated">Last Updated: February 5, 2026</p>

          <section>
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing and using Email Agent ("the Service"), you accept and agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, please do not use the Service.
            </p>
          </section>

          <section>
            <h2>2. Description of Service</h2>
            <p>
              Email Agent is an AI-powered email management service that helps you:
            </p>
            <ul>
              <li>Organize and prioritize your emails</li>
              <li>Generate intelligent email summaries and responses</li>
              <li>Manage calendar events based on email content</li>
              <li>Search and analyze your email data</li>
            </ul>
            <p>
              The Service integrates with Google Gmail and Google Calendar through OAuth 2.0 authentication.
            </p>
          </section>

          <section>
            <h2>3. User Accounts and Authentication</h2>
            <h3>3.1 Account Requirements</h3>
            <p>
              To use the Service, you must:
            </p>
            <ul>
              <li>Have a valid Google account</li>
              <li>Be at least 13 years of age</li>
              <li>Provide accurate and complete information</li>
              <li>Maintain the security of your account credentials</li>
            </ul>

            <h3>3.2 OAuth Permissions</h3>
            <p>
              By connecting your Google account, you grant us permission to:
            </p>
            <ul>
              <li>Read your Gmail messages</li>
              <li>Create Gmail drafts (with your explicit confirmation)</li>
              <li>Access your Google Calendar events</li>
            </ul>
            <p>
              You can revoke these permissions at any time through your Google Account settings.
            </p>
          </section>

          <section>
            <h2>4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Use the Service for any illegal or unauthorized purpose</li>
              <li>Violate any laws in your jurisdiction</li>
              <li>Transmit any malicious code, viruses, or harmful data</li>
              <li>Attempt to gain unauthorized access to the Service or related systems</li>
              <li>Interfere with or disrupt the Service or servers</li>
              <li>Use the Service to send spam or unsolicited messages</li>
              <li>Impersonate any person or entity</li>
              <li>Collect or harvest information about other users</li>
            </ul>
          </section>

          <section>
            <h2>5. AI-Generated Content</h2>
            <p>
              The Service uses artificial intelligence to generate content, including:
            </p>
            <ul>
              <li>Email summaries and responses</li>
              <li>Priority classifications</li>
              <li>Calendar event suggestions</li>
            </ul>
            <p>
              <strong>Important:</strong> AI-generated content may contain errors or inaccuracies. You are responsible for reviewing and verifying all AI-generated content before using it. We are not liable for any consequences resulting from the use of AI-generated content.
            </p>
          </section>

          <section>
            <h2>6. Email Actions and Confirmations</h2>
            <p>
              The Service requires your explicit confirmation before taking certain actions:
            </p>
            <ul>
              <li><strong>Sending Emails:</strong> We will never send emails without your explicit confirmation</li>
              <li><strong>Creating Calendar Events:</strong> Calendar events are only created after you confirm the suggested schedule</li>
              <li><strong>Draft Creation:</strong> Drafts are saved only with your approval</li>
            </ul>
            <p>
              You are solely responsible for all actions taken through the Service after your confirmation.
            </p>
          </section>

          <section>
            <h2>7. Data and Privacy</h2>
            <p>
              Your use of the Service is also governed by our Privacy Policy. By using the Service, you consent to:
            </p>
            <ul>
              <li>The collection, processing, and storage of your email and calendar data</li>
              <li>The use of AI models to process your data</li>
              <li>Data storage in our secure databases</li>
            </ul>
            <p>
              Please review our <Link to="/privacy">Privacy Policy</Link> for detailed information about how we handle your data.
            </p>
          </section>

          <section>
            <h2>8. Service Availability</h2>
            <p>
              We strive to provide reliable service but do not guarantee:
            </p>
            <ul>
              <li>Uninterrupted or error-free operation</li>
              <li>Immediate availability of all features</li>
              <li>Compatibility with all email systems or devices</li>
            </ul>
            <p>
              We reserve the right to modify, suspend, or discontinue the Service at any time with or without notice.
            </p>
          </section>

          <section>
            <h2>9. Intellectual Property</h2>
            <p>
              The Service, including its design, features, and functionality, is owned by us and protected by copyright, trademark, and other intellectual property laws. You may not:
            </p>
            <ul>
              <li>Copy, modify, or create derivative works of the Service</li>
              <li>Reverse engineer or attempt to extract source code</li>
              <li>Remove any copyright or proprietary notices</li>
              <li>Use our trademarks or logos without permission</li>
            </ul>
          </section>

          <section>
            <h2>10. Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR:
            </p>
            <ul>
              <li>Any indirect, incidental, special, or consequential damages</li>
              <li>Loss of data, profits, or business opportunities</li>
              <li>Errors or inaccuracies in AI-generated content</li>
              <li>Service interruptions or unavailability</li>
              <li>Unauthorized access to your account or data</li>
            </ul>
            <p>
              Our total liability shall not exceed the amount you paid for the Service (if any) in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2>11. Indemnification</h2>
            <p>
              You agree to indemnify and hold us harmless from any claims, damages, losses, or expenses (including legal fees) arising from:
            </p>
            <ul>
              <li>Your use of the Service</li>
              <li>Your violation of these Terms</li>
              <li>Your violation of any third-party rights</li>
              <li>Content you submit or transmit through the Service</li>
            </ul>
          </section>

          <section>
            <h2>12. Termination</h2>
            <p>
              We may terminate or suspend your access to the Service immediately, without prior notice, if you:
            </p>
            <ul>
              <li>Violate these Terms</li>
              <li>Engage in fraudulent or illegal activity</li>
              <li>Fail to pay any fees (if applicable)</li>
            </ul>
            <p>
              You may terminate your account at any time by disconnecting your Google account or contacting us. Upon termination, we will delete your data in accordance with our Privacy Policy.
            </p>
          </section>

          <section>
            <h2>13. Changes to Terms</h2>
            <p>
              We reserve the right to modify these Terms at any time. We will notify you of material changes by:
            </p>
            <ul>
              <li>Posting the updated Terms on this page</li>
              <li>Updating the "Last Updated" date</li>
              <li>Sending an email notification (if applicable)</li>
            </ul>
            <p>
              Your continued use of the Service after changes become effective constitutes acceptance of the new Terms.
            </p>
          </section>

          <section>
            <h2>14. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles. Any disputes arising from these Terms or the Service shall be resolved through appropriate legal channels.
            </p>
          </section>

          <section>
            <h2>15. Contact Information</h2>
            <p>
              If you have any questions about these Terms, please contact us:
            </p>
            <ul>
              <li>Email: <a href="mailto:haoji.bian@mail-agents.net">haoji.bian@mail-agents.net</a></li>
              <li>Domain: mail-agents.net</li>
            </ul>
          </section>

          <section>
            <h2>16. Entire Agreement</h2>
            <p>
              These Terms, together with our Privacy Policy, constitute the entire agreement between you and us regarding the Service and supersede all prior agreements and understandings.
            </p>
          </section>
        </div>

        <div className="legal-footer">
          <Link to="/">Back to Home</Link>
          <span>|</span>
          <Link to="/privacy">Privacy Policy</Link>
        </div>
      </div>
    </div>
  );
}

export default TermsOfService;
