import React from 'react';

export default function InboxSignal() {
  return (
    <svg className="inbox-signal" viewBox="0 0 300 200" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="signal-field">
          <stop stopColor="#40e2d3" stopOpacity=".21" />
          <stop offset="1" stopColor="#40e2d3" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="159" cy="100" r="91" fill="url(#signal-field)" />
      <g stroke="#3a677d" strokeWidth="1">
        <path d="M159 6v188M63 100h192" strokeDasharray="2 6" />
        <circle cx="159" cy="100" r="72" strokeDasharray="3 5" />
        <circle cx="159" cy="100" r="55" />
        <circle cx="159" cy="100" r="39" opacity=".65" />
        <path d="M86 46H59L35 70H11m185 80h28l25-25h42M225 51l16-16h35" />
        <circle cx="11" cy="70" r="3" /><circle cx="291" cy="125" r="3" /><circle cx="276" cy="35" r="3" />
      </g>
      <path d="M98 65a70 70 0 0 1 94-26m24 23a69 69 0 0 1-27 102m-43 5a71 71 0 0 1-54-52"
        stroke="#5fd7dc" strokeWidth="1.5" />
      <path d="M133 85 159 69l26 16v28l-26 16-26-16V85Z" fill="#102f3a" stroke="#78eddc" strokeWidth="1.5" />
      <path d="m134 86 25 16 25-16m-50 26 16-15m34 15-16-15"
        stroke="#a4ffee" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="159" cy="102" r="3.5" fill="#a4ffee" />
      <circle cx="225" cy="51" r="3" fill="#8df9e3" />
      <circle cx="86" cy="46" r="2.5" fill="#7f9dff" />
      <circle cx="196" cy="150" r="2.5" fill="#8df9e3" />
      <g className="inbox-signal-sweep">
        <path d="M159 100 230 100" stroke="#78eddc" strokeOpacity=".45" />
        <circle cx="231" cy="100" r="3" fill="#adffef" />
      </g>
    </svg>
  );
}
