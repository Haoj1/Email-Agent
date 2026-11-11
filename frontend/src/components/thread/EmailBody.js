import React, { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';

function formatDocument(html, loadImages) {
  const document = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['base', 'meta', 'link', 'form', 'input', 'button', 'select', 'textarea',
      'iframe', 'frame', 'object', 'embed', 'audio', 'video', 'source', 'template', 'map', 'area'],
    FORBID_ATTR: ['srcset', 'ping', 'autofocus', 'download', 'target'],
  });
  const head = document.querySelector('head');
  if (!head) return null;

  let hasRemoteImages = false;
  for (const image of document.querySelectorAll('img[src]')) {
    const original = image.getAttribute('src');
    const source = original.startsWith('//') ? 'https:' + original : original;
    if (/^https:\/\//i.test(source)) {
      hasRemoteImages = true;
      if (!loadImages) {
        const placeholder = document.ownerDocument.createElement('span');
        placeholder.textContent = image.getAttribute('alt') || 'Remote image';
        placeholder.setAttribute('style', 'display:inline-block;padding:5px 8px;background:#eef2f7;color:#52617a;border-radius:4px');
        image.replaceWith(placeholder);
        continue;
      }
      image.setAttribute('src', source);
    } else if (!/^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(source)) {
      image.removeAttribute('src');
    }
    image.setAttribute('referrerpolicy', 'no-referrer');
  }
  for (const link of document.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    if (href.startsWith('#')) continue;
    if (!/^(?:https?:\/\/|mailto:)/i.test(href)) {
      link.removeAttribute('href');
      continue;
    }
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  const meta = document.ownerDocument.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${loadImages ? ' https:' : ''}; base-uri 'none'; form-action 'none'`;
  head.prepend(meta);
  const referrer = document.ownerDocument.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  head.prepend(referrer);
  const defaults = document.ownerDocument.createElement('style');
  defaults.textContent = 'body{margin:16px;color:#202124;background:#fff;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere} img{max-width:100%;height:auto} table{max-width:100%}';
  head.insertBefore(defaults, meta.nextSibling);
  return { source: '<!doctype html>' + document.outerHTML, hasRemoteImages };
}

export default function EmailBody({ message }) {
  const [showText, setShowText] = useState(false);
  const [loadImages, setLoadImages] = useState(false);
  const formatted = useMemo(() => message.body_html ? formatDocument(message.body_html, loadImages) : null,
    [message.body_html, loadImages]);

  return (
    <div className="message-body">
      {formatted && <div className="email-format-toolbar">
        <div className="workspace-search-modes" role="group" aria-label="Message format">
          <button type="button" aria-pressed={!showText} onClick={() => setShowText(false)}>Formatted</button>
          <button type="button" aria-pressed={showText} onClick={() => setShowText(true)}>Plain text</button>
        </div>
        {!showText && formatted.hasRemoteImages && !loadImages &&
          <button className="workspace-quiet" type="button" onClick={() => setLoadImages(true)}>Load remote images</button>}
      </div>}
      {formatted && !showText ? (
        <iframe className="formatted-email" title="Formatted email" srcDoc={formatted.source} loading="lazy"
          sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
      ) : (
        <div className={message.body ? 'body-text' : 'body-snippet'}>
          {message.body || message.snippet || 'No plain-text content.'}
        </div>
      )}
    </div>
  );
}
