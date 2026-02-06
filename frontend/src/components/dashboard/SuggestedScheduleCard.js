import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';

import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

function safeIso(d) {
  try {
    return d?.toISOString?.() || null;
  } catch {
    return null;
  }
}

export default function SuggestedScheduleCard({ selectedEmail }) {
  const navigate = useNavigate();
  const calendarRef = useRef(null);
  const [days, setDays] = useState(7);
  const [triageDays, setTriageDays] = useState(3);
  const [maxItems, setMaxItems] = useState(15);

  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [confirmError, setConfirmError] = useState(null);

  const [busyCount, setBusyCount] = useState(0);
  const [busyBlocks, setBusyBlocks] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [confirmResult, setConfirmResult] = useState(null);

  const suggestionKey = (s) => s?._key;

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    setConfirmResult(null);
    setConfirmError(null);
    try {
      const resp = await api.get('/calendar/suggestions', {
        params: {
          days,
          triage_days: triageDays,
          email: selectedEmail || null,
          max_items: maxItems,
        },
      });

      const data = resp.data;
      if (!data?.success) {
        throw new Error(data?.detail || 'Failed to generate schedule');
      }

      const list = Array.isArray(data.suggestions) ? data.suggestions : [];
      const withKeys = list.map((s, idx) => ({
        ...s,
        _key: `${s.thread_id || 'no_thread'}_${idx}`,
      }));
      setSuggestions(withKeys);

      const busy = Array.isArray(data.busy) ? data.busy : [];
      setBusyBlocks(busy);
      setBusyCount(busy.length);

      // Default select all suggestions
      setSelectedKeys(new Set(withKeys.map(suggestionKey)));
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to generate schedule');
      setSuggestions([]);
      setBusyBlocks([]);
      setBusyCount(0);
      setSelectedKeys(new Set());
    } finally {
      setLoading(false);
    }
  }, [days, triageDays, selectedEmail, maxItems]);

  useEffect(() => {
    // Auto-generate when switching accounts
    loadSuggestions();
  }, [loadSuggestions]);

  const selectedSuggestions = useMemo(() => {
    return suggestions.filter((s) => selectedKeys.has(suggestionKey(s)));
  }, [suggestions, selectedKeys]);

  const selectAll = () => setSelectedKeys(new Set(suggestions.map(suggestionKey)));
  const selectNone = () => setSelectedKeys(new Set());

  const updateSuggestionTime = useCallback((key, startIso, endIso) => {
    setSuggestions((prev) => {
      return prev.map((s) => {
        if (s._key !== key) return s;
        let duration_minutes = s.duration_minutes;
        try {
          const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
          duration_minutes = Math.max(5, Math.round(ms / 60000));
        } catch {}
        return {
          ...s,
          start_iso: startIso,
          end_iso: endIso,
          duration_minutes,
        };
      });
    });
  }, []);

  const handleConfirm = async () => {
    if (selectedSuggestions.length === 0) return;
    setConfirming(true);
    setConfirmError(null);
    setConfirmResult(null);
    try {
      const resp = await api.post('/calendar/confirm', {
        email: selectedEmail || null,
        suggestions: selectedSuggestions,
      });
      setConfirmResult(resp.data);
      // After creating, refresh suggestions (so user sees updated availability)
      loadSuggestions();
    } catch (e) {
      setConfirmError(e.response?.data?.detail || e.message || 'Failed to create calendar events');
    } finally {
      setConfirming(false);
    }
  };

  const calendarEvents = useMemo(() => {
    const busyEvents = busyBlocks
      .map((b) => {
        const start = b?.start?.dateTime || b?.start?.date;
        const end = b?.end?.dateTime || b?.end?.date;
        if (!start || !end) return null;
        return {
          id: `busy_${b.id || `${start}_${end}`}`,
          title: '',
          start,
          end,
          display: 'background',
          backgroundColor: 'rgba(60, 64, 67, 0.12)',
          overlap: true,
          editable: false,
          extendedProps: { kind: 'busy' },
        };
      })
      .filter(Boolean);

    const suggestionEvents = suggestions.map((s) => {
      const checked = selectedKeys.has(s._key);
      const priorityPct = s.priority != null ? Math.round(s.priority * 100) : null;
      return {
        id: s._key,
        title: s.title || 'Follow up',
        start: s.start_iso,
        end: s.end_iso,
        editable: true,
        durationEditable: true,
        startEditable: true,
        backgroundColor: checked ? '#7b1fa2' : 'rgba(123, 31, 162, 0.35)',
        borderColor: checked ? '#6a1b9a' : 'rgba(123, 31, 162, 0.55)',
        textColor: checked ? '#fff' : '#2b0a3d',
        extendedProps: {
          kind: 'suggestion',
          thread_id: s.thread_id,
          email: s.email,
          label: s.label,
          priority: s.priority,
          priorityPct,
        },
      };
    });

    return [...busyEvents, ...suggestionEvents];
  }, [busyBlocks, suggestions, selectedKeys]);

  return (
    <div className="card" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
        <div>
          <h2 style={{ marginBottom: '6px' }}>Suggested Schedule</h2>
          <p style={{ margin: 0, fontSize: '0.9em', color: '#666' }}>
            Auto-plans follow‑ups from your Priority Inbox into open time on your calendar. Review first, then confirm.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={loadSuggestions} disabled={loading || confirming}>
            {loading ? 'Generating…' : 'Regenerate'}
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={confirming || loading || selectedSuggestions.length === 0}
            style={{ backgroundColor: '#7b1fa2' }}
          >
            {confirming ? 'Creating…' : `Confirm & Create (${selectedSuggestions.length})`}
          </button>
        </div>
      </div>

      <div style={{ marginTop: '14px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85em', color: '#666' }}>Schedule:</label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            disabled={loading || confirming}
            style={{
              height: '38px',
              padding: '0 12px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
              backgroundColor: '#fff',
              color: '#333',
              outline: 'none',
            }}
          >
            <option value={3}>Next 3 days</option>
            <option value={7}>Next 7 days</option>
            <option value={14}>Next 2 weeks</option>
          </select>

          <label style={{ fontSize: '0.85em', color: '#666' }}>From Priority Inbox:</label>
          <select
            value={triageDays}
            onChange={(e) => setTriageDays(parseInt(e.target.value))}
            disabled={loading || confirming}
            style={{
              height: '38px',
              padding: '0 12px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
              backgroundColor: '#fff',
              color: '#333',
              outline: 'none',
            }}
          >
            <option value={1}>Today</option>
            <option value={3}>Last 3 Days</option>
            <option value={7}>Last Week</option>
          </select>

          <label style={{ fontSize: '0.85em', color: '#666' }}>Max items:</label>
          <select
            value={maxItems}
            onChange={(e) => setMaxItems(parseInt(e.target.value))}
            disabled={loading || confirming}
            style={{
              height: '38px',
              padding: '0 12px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
              backgroundColor: '#fff',
              color: '#333',
              outline: 'none',
            }}
          >
            <option value={10}>10</option>
            <option value={15}>15</option>
            <option value={20}>20</option>
          </select>

          <button className="btn-secondary" onClick={selectAll} disabled={loading || confirming || suggestions.length === 0}>
            Select all
          </button>
          <button className="btn-secondary" onClick={selectNone} disabled={loading || confirming || suggestions.length === 0}>
            Select none
          </button>
        </div>

        <div style={{ marginLeft: 'auto', fontSize: '0.85em', color: '#666' }}>
          Avoiding <strong>{busyCount}</strong> existing calendar event(s)
        </div>
      </div>

      {error && (
        <div className="test-result error" style={{ marginTop: '16px' }}>
          <p style={{ margin: 0 }}>✗ {error}</p>
        </div>
      )}
      {confirmError && (
        <div className="test-result error" style={{ marginTop: '16px' }}>
          <p style={{ margin: 0 }}>✗ {confirmError}</p>
        </div>
      )}
      {confirmResult?.created_count > 0 && (
        <div className="test-result success" style={{ marginTop: '16px' }}>
          <p style={{ margin: 0 }}>
            ✓ Created {confirmResult.created_count} calendar event(s)
            {confirmResult.error_count ? ` (with ${confirmResult.error_count} error(s))` : ''}
          </p>
        </div>
      )}

      <div style={{ marginTop: '16px' }}>
        {loading && (
          <div style={{ padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '4px', color: '#666', textAlign: 'center' }}>
            <span className="spinner" style={{ marginRight: '10px' }}></span>
            Generating suggestions…
          </div>
        )}

        {!loading && suggestions.length === 0 && !error && (
          <div style={{ padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '4px', color: '#666' }}>
            No suggested follow‑ups found for the selected range. Try expanding the time range or increasing Priority Inbox lookback.
          </div>
        )}

        {!loading && suggestions.length > 0 && (
          <>
            <div style={{ border: '1px solid #eee', borderRadius: '10px', overflow: 'hidden', background: '#fff' }}>
              <FullCalendar
                ref={calendarRef}
                plugins={[timeGridPlugin, interactionPlugin]}
                initialView="timeGridWeek"
                height={680}
                nowIndicator={true}
                editable={true}
                eventStartEditable={true}
                eventDurationEditable={true}
                eventOverlap={true}
                slotMinTime="08:00:00"
                slotMaxTime="20:00:00"
                allDaySlot={false}
                expandRows={true}
                headerToolbar={{
                  left: 'prev,next today',
                  center: 'title',
                  right: 'timeGridWeek,timeGridDay',
                }}
                buttonText={{
                  today: 'Today',
                  week: 'Week',
                  day: 'Day',
                }}
                events={calendarEvents}
                eventClick={(info) => {
                  const kind = info.event.extendedProps?.kind;
                  if (kind !== 'suggestion') return;
                  const key = info.event.id;
                  setSelectedKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                }}
                eventDrop={(info) => {
                  const kind = info.event.extendedProps?.kind;
                  if (kind !== 'suggestion') return;
                  const startIso = safeIso(info.event.start);
                  const endIso = safeIso(info.event.end);
                  if (startIso && endIso) updateSuggestionTime(info.event.id, startIso, endIso);
                }}
                eventResize={(info) => {
                  const kind = info.event.extendedProps?.kind;
                  if (kind !== 'suggestion') return;
                  const startIso = safeIso(info.event.start);
                  const endIso = safeIso(info.event.end);
                  if (startIso && endIso) updateSuggestionTime(info.event.id, startIso, endIso);
                }}
                eventContent={(arg) => {
                  if (arg.event.extendedProps?.kind !== 'suggestion') return null;
                  const pct = arg.event.extendedProps?.priorityPct;
                  return (
                    <div style={{ fontSize: '12px', lineHeight: 1.2 }}>
                      <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {arg.event.title}
                      </div>
                      {pct != null && (
                        <div style={{ opacity: 0.9, marginTop: '2px' }}>
                          Priority {pct}%
                        </div>
                      )}
                    </div>
                  );
                }}
              />
            </div>

            <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.85em', color: '#666' }}>
                Tip: click a block to select/deselect. Drag to move. Resize to change duration.
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: '#7b1fa2', display: 'inline-block' }} />
                  <span style={{ fontSize: '0.85em', color: '#666' }}>Selected</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(123, 31, 162, 0.35)', display: 'inline-block' }} />
                  <span style={{ fontSize: '0.85em', color: '#666' }}>Not selected</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(60, 64, 67, 0.12)', display: 'inline-block' }} />
                  <span style={{ fontSize: '0.85em', color: '#666' }}>Busy</span>
                </div>
              </div>
            </div>

            {selectedSuggestions.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Selected items</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
                  {selectedSuggestions.slice(0, 12).map((s) => (
                    <div key={s._key} style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ fontWeight: 700, color: '#333' }}>{s.title}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#7b1fa2' }}>
                          {s.priority != null ? `${Math.round(s.priority * 100)}%` : ''}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                        {new Date(s.start_iso).toLocaleString()} → {new Date(s.end_iso).toLocaleTimeString()}
                      </div>
                      <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {s.thread_id && (
                          <button
                            className="btn-secondary"
                            onClick={() => {
                              const params = new URLSearchParams();
                              if (selectedEmail) params.set('email', selectedEmail);
                              navigate(`/thread/${s.thread_id}?${params.toString()}`);
                            }}
                            style={{ padding: '4px 10px', fontSize: 12 }}
                          >
                            Open Conversation
                          </button>
                        )}
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            const text = `${s.title}\n${s.start_iso}\n${s.end_iso}`;
                            navigator.clipboard?.writeText(text);
                          }}
                          style={{ padding: '4px 10px', fontSize: 12 }}
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

