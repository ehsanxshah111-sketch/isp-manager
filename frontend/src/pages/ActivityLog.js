import React, { useState, useEffect } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { getPageCache, setPageCache } from '../utils/pageCache';
import RefreshButton from '../components/RefreshButton';

// Company-wide audit trail - who changed what, and when. This is the
// general log (every customer, newest first); the 🕘 button on a single
// customer row in the Customers page shows this same data scoped to just
// that one customer.
const ActivityLog = () => {
  const cachedLogs = getPageCache('activityLog');
  const [logs, setLogs] = useState(cachedLogs || []);
  const [loading, setLoading] = useState(!cachedLogs);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('all');

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLogs = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setRefreshing(true);
      else if (!cachedLogs) setLoading(true);
      const res = await API.get('/activity-logs?limit=500');
      setLogs(res.data.data || []);
      setPageCache('activityLog', res.data.data || []);
    } catch (error) {
      toast.error('Failed to load activity log');
      console.error('Error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const actionOptions = ['all', ...new Set(logs.map((l) => l.action))];

  const filteredLogs = logs.filter((l) => {
    const matchesSearch =
      !search ||
      (l.details || '').toLowerCase().includes(search.toLowerCase()) ||
      (l.user || '').toLowerCase().includes(search.toLowerCase()) ||
      (l.action || '').toLowerCase().includes(search.toLowerCase());
    const matchesAction = filterAction === 'all' || l.action === filterAction;
    return matchesSearch && matchesAction;
  });

  if (loading) {
    return <div className="loading">Loading activity log...</div>;
  }

  return (
    <div className="activity-log-page">
      <div className="page-header">
        <h2 className="page-title">🕘 Activity Log ({logs.length})</h2>
        <RefreshButton onRefresh={() => loadLogs(true)} refreshing={refreshing} />
      </div>

      <p className="bulk-wa-hint">
        Every recorded change to a customer's record - who made it, exactly what changed, and when.
        This is kept for record-keeping, including changes to customers that have since been deleted.
      </p>

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search by name, user, or action..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="filter-input"
        />
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="filter-select"
        >
          {actionOptions.map((a) => (
            <option key={a} value={a}>{a === 'all' ? 'All Actions' : a}</option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={loadLogs} type="button">
          ↻ Refresh
        </button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Date &amp; Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr><td colSpan="4" className="no-data">No activity recorded yet</td></tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log._id}>
                  <td className="day-cell">{new Date(log.createdAt).toLocaleString()}</td>
                  <td><strong>{log.user || 'Unknown'}</strong></td>
                  <td>
                    <span className={`status-badge ${(log.action || '').toLowerCase().replace(/\s+/g, '-')}`}>
                      {log.action}
                    </span>
                  </td>
                  <td>{log.details}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ActivityLog;
