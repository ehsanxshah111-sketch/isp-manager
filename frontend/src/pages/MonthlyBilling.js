import React, { useState, useEffect } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import RefreshButton from '../components/RefreshButton';

// "2026-08" -> "August 2026"
const monthKeyToLabel = (key) => {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const currentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const getColorClass = (color) =>
  ({ blue: 'value-blue', green: 'value-green', red: 'value-red', orange: 'value-orange', gray: 'value-gray' }[color] || '');

// Generate the bill for whichever month is due (August, October, whatever
// you pick) - it locks that month's Total Recovery / Total Collected in
// forever. Pick any earlier month from the list below to reopen exactly
// what it looked like the day it was closed.
const MonthlyBilling = () => {
  const [selectedKey, setSelectedKey] = useState(currentMonthKey());
  const [pastBills, setPastBills] = useState([]);
  const [viewBill, setViewBill] = useState(null);  // a locked-in past bill for selectedKey, if one exists
  const [preview, setPreview] = useState(null);    // live numbers, only relevant when no bill exists yet
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editStats, setEditStats] = useState(null);   // draft copy of the aggregate stat numbers while editing
  const [editCustomers, setEditCustomers] = useState(null); // draft copy of the per-customer rows while editing
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPastBills();
  }, []);

  useEffect(() => {
    loadSelectedMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const loadPastBills = async () => {
    try {
      const res = await API.get('/billing');
      setPastBills(res.data.data || []);
    } catch (error) {
      console.error('Error loading billing history:', error);
    }
  };

  const loadSelectedMonth = async () => {
    setLoading(true);
    setViewBill(null);
    setPreview(null);
    setEditing(false);
    setEditStats(null);
    setEditCustomers(null);
    try {
      const res = await API.get(`/billing/${selectedKey}`);
      setViewBill(res.data.data);
    } catch (error) {
      if (error.response?.status === 404) {
        // Not generated yet - show live, still-moving numbers instead.
        try {
          const previewRes = await API.get('/billing-preview/now');
          setPreview(previewRes.data.data);
        } catch (e2) {
          toast.error('Failed to load current numbers');
          console.error(e2);
        }
      } else {
        toast.error('Failed to load that month');
        console.error(error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    const label = monthKeyToLabel(selectedKey);
    const ok = window.confirm(
      `Generate the bill for ${label}?\n\n` +
      `This locks in the current Total Recovery and Total Collected numbers for ${label}, adds every still-unpaid ` +
      `active customer's monthly fee to their pending dues, and starts a fresh Unpaid cycle for the next month.\n\n` +
      `This can't be undone - continue?`
    );
    if (!ok) return;
    setGenerating(true);
    try {
      const res = await API.post('/billing/generate', { monthKey: selectedKey, monthLabel: label });
      setViewBill(res.data.data);
      setPreview(null);
      toast.success(`Bill generated for ${label}`);
      loadPastBills();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to generate bill');
      console.error('Error:', error);
    } finally {
      setGenerating(false);
    }
  };

  const refresh = () => {
    setRefreshing(true);
    Promise.all([loadPastBills(), loadSelectedMonth()]).finally(() => setRefreshing(false));
  };

  // ---- Editing a locked month (fixing a mistake after the fact) ----
  const startEdit = () => {
    if (!viewBill) return;
    setEditStats({
      totalCustomers: viewBill.totalCustomers,
      activeCustomers: viewBill.activeCustomers,
      paidCount: viewBill.paidCount,
      unpaidCount: viewBill.unpaidCount,
      totalRevenue: viewBill.totalRevenue,
      totalDues: viewBill.totalDues,
      totalRecovery: viewBill.totalRecovery,
      totalCollected: viewBill.totalCollected,
      rolledOverCount: viewBill.rolledOverCount,
    });
    setEditCustomers((viewBill.customers || []).map((c) => ({ ...c })));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditStats(null);
    setEditCustomers(null);
  };

  const updateEditStat = (field, value) => {
    setEditStats((prev) => ({ ...prev, [field]: value }));
  };

  const updateEditCustomerRow = (index, field, value) => {
    setEditCustomers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const res = await API.put(`/billing/${selectedKey}`, {
        ...editStats,
        customers: editCustomers,
      });
      setViewBill(res.data.data);
      setEditing(false);
      setEditStats(null);
      setEditCustomers(null);
      toast.success(`${monthKeyToLabel(selectedKey)} updated`);
      loadPastBills();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save changes');
      console.error('Error:', error);
    } finally {
      setSaving(false);
    }
  };

  const data = viewBill || preview;
  const isLocked = !!viewBill;
  const displayStats = editing ? editStats : data;
  const displayCustomers = editing ? editCustomers : (data ? data.customers || [] : []);

  const statCards = displayStats ? [
    { label: 'Total Customers', field: 'totalCustomers', value: displayStats.totalCustomers, color: 'blue' },
    { label: 'Active', field: 'activeCustomers', value: displayStats.activeCustomers, color: 'green' },
    { label: 'Paid', field: 'paidCount', value: displayStats.paidCount, color: 'green' },
    { label: 'Unpaid', field: 'unpaidCount', value: displayStats.unpaidCount, color: 'red' },
    { label: 'Total Revenue (Active Only)', field: 'totalRevenue', value: displayStats.totalRevenue, color: 'blue', money: true },
    { label: 'Total Dues', field: 'totalDues', value: displayStats.totalDues, color: 'red', money: true },
    { label: 'Total Recovery', field: 'totalRecovery', value: displayStats.totalRecovery, color: 'orange', money: true },
    { label: 'Total Collection', field: 'totalCollected', value: displayStats.totalCollected, color: 'green', money: true },
  ] : [];

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <h2 className="page-title">🧾 Monthly Bills</h2>
        <RefreshButton onRefresh={refresh} refreshing={refreshing} />
      </div>

      <p className="bulk-wa-hint">
        Pick any month below. A month that's already been generated opens its numbers exactly as they were the
        day it was closed. The current month (not generated yet) shows live numbers with a Generate button.
      </p>

      <div className="filter-bar">
        <input
          type="month"
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="filter-input"
          style={{ maxWidth: 200 }}
        />
        <span style={{ alignSelf: 'center', fontWeight: 600 }}>{monthKeyToLabel(selectedKey)}</span>
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : !data ? (
        <p className="no-data">Nothing to show for this month.</p>
      ) : (
        <>
          <p className="bulk-wa-hint" style={{ marginTop: 8 }}>
            {isLocked
              ? <>🔒 Locked — generated by <strong>{viewBill.generatedBy}</strong> on {new Date(viewBill.periodEnd).toLocaleString()}
                  {viewBill.editedAt && (
                    <> · ✏️ last corrected by <strong>{viewBill.editedBy}</strong> on {new Date(viewBill.editedAt).toLocaleString()}</>
                  )}
                </>
              : <>🟢 Live — {monthKeyToLabel(selectedKey)} hasn't been generated yet, these numbers are still moving.</>}
          </p>

          <p className="bulk-wa-hint">
            💾 Every generated month and every customer's record here is saved permanently in the database — this
            isn't kept in your browser, so it's still there after you refresh, close the tab, or come back next month.
          </p>

          <div className="stats-grid">
            {statCards.map((card, index) => (
              <div key={index} className="stat-card">
                <div className="stat-label">{card.label}</div>
                {editing ? (
                  <input
                    type="number"
                    className="filter-input"
                    value={card.value}
                    onChange={(e) => updateEditStat(card.field, e.target.value === '' ? '' : Number(e.target.value))}
                    style={{ marginTop: 6, fontWeight: 700 }}
                  />
                ) : (
                  <div className={`stat-value ${getColorClass(card.color)}`}>
                    {card.money ? `PKR ${(card.value || 0).toLocaleString()}` : card.value}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!isLocked && (
            <button
              type="button"
              className="save-btn"
              onClick={handleGenerate}
              disabled={generating}
              style={{ marginTop: 16 }}
            >
              {generating ? 'Generating…' : `📌 Generate Bill for ${monthKeyToLabel(selectedKey)}`}
            </button>
          )}

          {isLocked && (
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              {editing ? (
                <>
                  <button type="button" className="save-btn" onClick={saveEdit} disabled={saving}>
                    {saving ? 'Saving…' : '💾 Save Corrections'}
                  </button>
                  <button type="button" className="cancel-btn" onClick={cancelEdit} disabled={saving}>
                    ✖ Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="cancel-btn" onClick={startEdit}>
                  ✏️ Edit This Month
                </button>
              )}
            </div>
          )}

          <div className="chart-section" style={{ marginTop: 24 }}>
            <h3>
              All Customers {monthKeyToLabel(selectedKey)}
              {displayCustomers && ` (${displayCustomers.length})`}
            </h3>
            {!displayCustomers || displayCustomers.length === 0 ? (
              <p className="no-data">No customers in this snapshot.</p>
            ) : (
              <div className="table-container" style={{ maxHeight: 480, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Package</th>
                      <th>Monthly Fee</th>
                      <th>Status</th>
                      <th>Pending Dues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayCustomers.map((c, index) => (
                      <tr key={c.customerId || index}>
                        <td>{c.name}</td>
                        <td>{c.package}</td>
                        <td>
                          {editing ? (
                            <input
                              type="number"
                              className="filter-input"
                              value={c.monthlyFee}
                              onChange={(e) => updateEditCustomerRow(index, 'monthlyFee', Number(e.target.value))}
                              style={{ maxWidth: 100 }}
                            />
                          ) : (
                            `PKR ${(c.monthlyFee || 0).toLocaleString()}`
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <select
                              className="filter-input"
                              value={c.paymentStatus}
                              onChange={(e) => updateEditCustomerRow(index, 'paymentStatus', e.target.value)}
                              style={{ maxWidth: 140 }}
                            >
                              <option value="Paid">Paid</option>
                              <option value="Unpaid">Unpaid</option>
                              <option value="1 YEAR ADVANCED">1 YEAR ADVANCED</option>
                              <option value="FREE">FREE</option>
                            </select>
                          ) : (
                            <span className={`status-badge ${(c.paymentStatus || '').toLowerCase().replace(' ', '-')}`}>
                              {c.paymentStatus}
                            </span>
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <input
                              type="number"
                              className="filter-input"
                              value={c.pendingDues}
                              onChange={(e) => updateEditCustomerRow(index, 'pendingDues', Number(e.target.value))}
                              style={{ maxWidth: 100 }}
                            />
                          ) : (
                            `PKR ${(c.pendingDues || 0).toLocaleString()}`
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div className="chart-section" style={{ marginTop: 24 }}>
        <h3>Past Generated Months</h3>
        {pastBills.length === 0 ? (
          <p className="no-data">No months generated yet.</p>
        ) : (
          <div className="bulk-wa-list">
            {pastBills.map((b) => (
              <div
                key={b._id}
                className="bulk-wa-row"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedKey(b.monthKey)}
                title="View this month"
              >
                <div className="bulk-wa-row-main">
                  <span className="bulk-wa-row-name">{b.monthLabel}</span>
                  <span className="bulk-wa-row-detail">
                    Recovery: PKR {b.totalRecovery.toLocaleString()} · Collected: PKR {b.totalCollected.toLocaleString()}
                  </span>
                </div>
                <span className="day-cell">{new Date(b.periodEnd).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MonthlyBilling;
