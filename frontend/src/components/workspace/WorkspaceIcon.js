import React from 'react';

const paths = {
  overview: 'M3.5 4h7v7h-7zM13.5 4h7v4h-7zM13.5 11h7v9h-7zM3.5 14h7v6h-7z',
  mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm0 1 8 6 8-6',
  priority: 'M4 5h16M4 12h10M4 19h5m8-5 3 3-3 3-3-3z',
  logout: 'M10 5H5v14h5m4-11 4 4-4 4m-5-4h9',
  spark: 'M12 2.8 14.5 9.5 21.2 12l-6.7 2.5-2.5 6.7-2.5-6.7L2.8 12l6.7-2.5L12 2.8Z',
  calendar: 'M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1Zm-1 5h16M8 3v4m8-4v4m-8 7h2m4 0h2',
  search: 'M15.5 15.5 20 20M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  arrow: 'M7 17 17 7M7 7h10v10',
  back: 'm10 6-6 6 6 6M4 12h16',
  chevron: 'm6 9 6 6 6-6',
  refresh: 'M20 11a8 8 0 1 0-2 6m2-12v6h-6',
  add: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  history: 'M4 11a8 8 0 1 1 2.3 6.7M4 5v6h6m2-3v4l3 2',
  trash: 'M4 6h16m-10 0V4h4v2m-8 0 1 14h10l1-14m-8 4v6m4-6v6',
  send: 'm4 4 16 8-16 8 3-8-3-8Zm3 8h13',
  link: 'm10 13 4-4m-6 6-1.5 1.5a3.5 3.5 0 0 1-5-5L6 7a3.5 3.5 0 0 1 5 0m2 10a3.5 3.5 0 0 0 5 0l4.5-4.5a3.5 3.5 0 0 0-5-5L16 9',
};

export default function WorkspaceIcon({ name, className = '' }) {
  return (
    <svg className={`workspace-icon ${className}`} viewBox="0 0 24 24" width="18" height="18"
      fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
