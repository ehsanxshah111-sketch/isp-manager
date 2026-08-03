import React, { useState, useEffect, useRef } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { getPageCache, setPageCache } from '../utils/pageCache';
import RefreshButton from '../components/RefreshButton';

// A short, friendly two-tone chime built entirely from the Web Audio API -
// no audio file needed, so this costs nothing and adds no extra assets.
// Played once per browser tab session (guarded by sessionStorage) the
// first time this page finds a customer overdue or due today, so it
// alerts you without becoming annoying on every refresh/navigation.
const playExpiryTune = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    const playTone = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.2, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.05);
    };

    playTone(880, 0, 0.18);
    playTone(1175, 0.2, 0.25);
  } catch (error) {
    // Some browsers block audio until the user has interacted with the
    // page at least once - that's fine, it's a nice-to-have, not core
    // functionality, so we just skip it silently.
    console.warn('Notification tune could not play:', error.message);
  }
};

const BUCKET_LABELS = {
  overdue: { label: 'Overdue', className: 'expiry-overdue' },
  today: { label: 'Due Today', className: 'expiry-today' },
  upcoming: { label: 'Expiring Soon', className: 'expiry-upcoming' },
  ok: { label: 'OK', className: 'expiry-ok' }
};

const formatDays = (e) => {
  if (e.bucket === 'overdue') return `Expired ${Math.abs(e.daysUntilDue)} day${Math.abs(e.daysUntilDue) === 1 ? '' : 's'} ago`;
  if (e.bucket === 'today') return 'Expires today';
  if (e.bucket === 'upcoming') return `In ${e.daysUntilDue} day${e.daysUntilDue === 1 ? '' : 's'}`;
  return `In ${e.daysUntilDue} day${e.daysUntilDue === 1 ? '' : 's'}`;
};

const PackageExpiry = () => {
  const cached = getPageCache('package-expiry');
  const [entries, setEntries] = useState(cached?.all || []);
  const [counts, setCounts] = useState(cached?.counts || { overdue: 0, today: 0, upcoming: 0 });
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('urgent'); // 'urgent' | 'all' | 'overdue' | 'today' | 'upcoming'
  const [sending, setSending] = useState(false);
  const tunePlayedRef = useRef(false);

  useEffect(() => {
    loadExpiry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadExpiry = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setRefreshing(true);
      else if (!cached) setLoading(true);
      const res = await API.get('/customers/expiry');
      const data = res.data.data;
      setEntries(data.all || []);
      setCounts(data.counts || { overdue: 0, today: 0, upcoming: 0 });
      setPageCache('package-expiry', data);

      const urgentCount = (data.counts?.overdue || 0) + (data.counts?.today || 0);
      const tuneKey = 'expiryTunePlayed-' + new Date().toDateString();
      if (urgentCount > 0 && !tunePlayedRef.current && !sessionStorage.getItem(tuneKey)) {
        playExpiryTune();
        tunePlayedRef.current = true;
        sessionStorage.setItem(tuneKey, '1');
      }
    } catch (error) {
      toast.error('Failed to load package expiry data');
      console.error('Package expiry error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const sendNow = async () => {
    setSending(true);
    try {
      const res = await API.post('/customers/expiry/notify');
      const result = res.data.data;
      if (result.sent) {
        toast.success(`Email sent! (${result.counts.overdue} overdue, ${result.counts.today} due today, ${result.counts.upcoming} upcoming)`);
      } else {
        toast(result.skippedReason || 'Nothing to send right now.', { icon: 'ℹ️' });
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to send expiry email');
      console.error('Send expiry email error:', error);
    } finally {
      setSending(false);
    }
  };

  const filteredEntries = entries.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'urgent') return e.bucket === 'overdue' || e.bucket === 'today';
    return e.bucket === filter;
  });

  if (loading) {
    return <div className="loading">Loading package expiry data...</div>;
  }

  return (
    <div className="expiry-page">
      <div className="page-header">
        <h2 className="page-title">Package Expiry</h2>
        <div className="header-buttons">
          <RefreshButton onRefresh={() => loadExpiry(true)} refreshing={refreshing} />
          <button className="btn btn-primary" onClick={sendNow} disabled={sending}>
            {sending ? 'Sending...' : '📧 Send Email Notification Now'}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Overdue</div>
          <div className="stat-value value-red">{counts.overdue}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Due Today</div>
          <div className="stat-value value-orange">{counts.today}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Expiring Soon (7 days)</div>
          <div className="stat-value value-blue">{counts.upcoming}</div>
        </div>
      </div>

      <div className="filter-bar">
        <button className={`btn ${filter === 'urgent' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('urgent')}>
          Needs Attention
        </button>
        <button className={`btn ${filter === 'overdue' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('overdue')}>
          Overdue
        </button>
        <button className={`btn ${filter === 'today' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('today')}>
          Due Today
        </button>
        <button className={`btn ${filter === 'upcoming' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('upcoming')}>
          Upcoming
        </button>
        <button className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('all')}>
          All Active
        </button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Customer ID</th>
              <th>Phone</th>
              <th>Monthly Fee</th>
              <th>Billing Day</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 ? (
              <tr><td colSpan="6" className="no-data">No customers in this view</td></tr>
            ) : (
              filteredEntries.map((e) => (
                <tr key={e.customer._id}>
                  <td><strong>{e.customer.name}</strong></td>
                  <td>{e.customer.customerId}</td>
                  <td>{e.customer.phone || '-'}</td>
                  <td>PKR {(e.customer.monthlyFee || 0).toLocaleString()}</td>
                  <td>{e.dueDay}</td>
                  <td>
                    <span className={`status-badge ${BUCKET_LABELS[e.bucket].className}`}>
                      {BUCKET_LABELS[e.bucket].label}
                    </span>
                    <div className="expiry-days-note">{formatDays(e)}</div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PackageExpiry;
