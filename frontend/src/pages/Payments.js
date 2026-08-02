import React, { useState, useEffect } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { getPageCache, setPageCache } from '../utils/pageCache';
import RefreshButton from '../components/RefreshButton';

const Payments = () => {
  const cachedPayments = getPageCache('payments');
  const [payments, setPayments] = useState(cachedPayments?.payments || []);
  const [summary, setSummary] = useState(cachedPayments?.summary || null);
  const [loading, setLoading] = useState(!cachedPayments);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [customers, setCustomers] = useState(cachedPayments?.customers || []);
  const [formData, setFormData] = useState({
    customerId: '',
    amount: '',
    billingMonth: '',
    method: 'Cash',
    notes: '',
  });
  const [editFormData, setEditFormData] = useState({
    amount: '',
    billingMonth: '',
    method: 'Cash',
    notes: '',
  });

  useEffect(() => {
    loadPayments();
    loadSummary();
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPayments = async () => {
    try {
      const res = await API.get('/payments');
      setPayments(res.data.data);
      setPageCache('payments', { ...(getPageCache('payments') || {}), payments: res.data.data });
    } catch (error) {
      toast.error('Failed to load payments');
      console.error('Error:', error);
    }
  };

  const loadSummary = async () => {
    try {
      const res = await API.get('/payments/summary');
      setSummary(res.data.data);
      setPageCache('payments', { ...(getPageCache('payments') || {}), summary: res.data.data });
    } catch (error) {
      console.error('Error loading summary:', error);
    }
  };

  const loadCustomers = async () => {
    try {
      const res = await API.get('/customers');
      setCustomers(res.data.data);
      setPageCache('payments', { ...(getPageCache('payments') || {}), customers: res.data.data });
    } catch (error) {
      console.error('Error loading customers:', error);
    } finally {
      setLoading(false);
    }
  };

  // Used by the manual refresh button - re-fetches everything on this page
  // without touching any other page or the whole site.
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadPayments(), loadSummary(), loadCustomers()]);
    setRefreshing(false);
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleEditInputChange = (e) => {
    setEditFormData({ ...editFormData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await API.post('/payments', formData);
      toast.success('Payment recorded successfully!');
      setShowModal(false);
      setFormData({ customerId: '', amount: '', billingMonth: '', method: 'Cash', notes: '' });
      loadPayments();
      loadSummary();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to record payment');
      console.error('Error:', error);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    try {
      await API.put(`/payments/${editingPayment._id}`, editFormData);
      toast.success('Payment updated successfully!');
      setShowEditModal(false);
      setEditingPayment(null);
      loadPayments();
      loadSummary();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update payment');
      console.error('Error:', error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this payment?')) return;
    try {
      await API.delete(`/payments/${id}`);
      toast.success('Payment deleted successfully!');
      loadPayments();
      loadSummary();
    } catch (error) {
      toast.error('Failed to delete payment');
      console.error('Error:', error);
    }
  };

  const openEditModal = (payment) => {
    setEditingPayment(payment);
    setEditFormData({
      amount: payment.amount,
      billingMonth: payment.billingMonth,
      method: payment.method,
      notes: payment.notes || '',
    });
    setShowEditModal(true);
  };

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="payments-page">
      <div className="page-header">
        <h2 className="page-title">Payments</h2>
        <div className="header-buttons">
          <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            ➕ Record Payment
          </button>
        </div>
      </div>

      {summary && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Total Collected</div>
            <div className="stat-value value-green">PKR {summary.totalCollected?.toLocaleString() || 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">This Month</div>
            <div className="stat-value value-blue">PKR {summary.monthlyCollection?.toLocaleString() || 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Transactions</div>
            <div className="stat-value value-purple">{summary.totalTransactions || 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">This Month Transactions</div>
            <div className="stat-value value-orange">{summary.monthlyTransactions || 0}</div>
          </div>
        </div>
      )}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Receipt #</th>
              <th>Date</th>
              <th>Customer ID</th>
              <th>Customer Name</th>
              <th>Amount</th>
              <th>Month</th>
              <th>Method</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan="9" className="no-data">No payments recorded</td></tr>
            ) : (
              payments.map((p) => (
                <tr key={p._id}>
                  <td><strong>{p.receiptNumber}</strong></td>
                  <td>{new Date(p.date).toLocaleDateString()}</td>
                  <td>{p.customerId}</td>
                  <td>{p.customerName}</td>
                  <td className="amount-paid">PKR {p.amount.toLocaleString()}</td>
                  <td>{p.billingMonth} {p.billingYear}</td>
                  <td><span className="badge-method">{p.method}</span></td>
                  <td className="notes-cell">{p.notes || '—'}</td>
                  <td>
                    <button className="action-btn" onClick={() => openEditModal(p)} title="Edit">✏️</button>
                    <button className="action-btn delete-btn" onClick={() => handleDelete(p._id)} title="Delete">🗑️</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Payment Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>💰 Record Payment</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Select Customer *</label>
                <select name="customerId" value={formData.customerId} onChange={handleInputChange} required>
                  <option value="">Select a customer...</option>
                  {customers.map((c) => (
                    <option key={c._id} value={c.customerId}>{c.name} ({c.customerId})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Amount (PKR) *</label>
                <input type="number" name="amount" value={formData.amount} onChange={handleInputChange} required min="1" />
              </div>
              <div className="form-group">
                <label>Billing Month *</label>
                <select name="billingMonth" value={formData.billingMonth} onChange={handleInputChange} required>
                  <option value="">Select month...</option>
                  {months.map((m) => (<option key={m} value={m}>{m}</option>))}
                </select>
              </div>
              <div className="form-group">
                <label>Payment Method</label>
                <select name="method" value={formData.method} onChange={handleInputChange}>
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Easypaisa">Easypaisa</option>
                  <option value="JazzCash">JazzCash</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <input type="text" name="notes" value={formData.notes} onChange={handleInputChange} placeholder="Optional notes..." />
              </div>
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="save-btn">Record Payment</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Payment Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>✏️ Edit Payment</h3>
            <form onSubmit={handleEditSubmit}>
              <div className="form-group">
                <label>Customer</label>
                <input type="text" value={editingPayment?.customerName} disabled style={{ opacity: 0.6 }} />
              </div>
              <div className="form-group">
                <label>Receipt #</label>
                <input type="text" value={editingPayment?.receiptNumber} disabled style={{ opacity: 0.6 }} />
              </div>
              <div className="form-group">
                <label>Amount (PKR) *</label>
                <input type="number" name="amount" value={editFormData.amount} onChange={handleEditInputChange} required min="1" />
              </div>
              <div className="form-group">
                <label>Billing Month *</label>
                <select name="billingMonth" value={editFormData.billingMonth} onChange={handleEditInputChange} required>
                  {months.map((m) => (<option key={m} value={m}>{m}</option>))}
                </select>
              </div>
              <div className="form-group">
                <label>Payment Method</label>
                <select name="method" value={editFormData.method} onChange={handleEditInputChange}>
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Easypaisa">Easypaisa</option>
                  <option value="JazzCash">JazzCash</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <input type="text" name="notes" value={editFormData.notes} onChange={handleEditInputChange} placeholder="Optional notes..." />
              </div>
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="save-btn">Update Payment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Payments;