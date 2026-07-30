import React, { useState, useEffect } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';

const Expenses = () => {
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    amount: '',
    category: 'Other',
    date: new Date().toISOString().split('T')[0],
    description: '',
  });

  useEffect(() => {
    loadExpenses();
    loadSummary();
  }, []);

  const loadExpenses = async () => {
    try {
      const res = await API.get('/expenses');
      setExpenses(res.data.data);
    } catch (error) {
      toast.error('Failed to load expenses');
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const res = await API.get('/expenses/summary');
      setSummary(res.data.data);
    } catch (error) {
      console.error('Error loading summary:', error);
    }
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await API.post('/expenses', formData);
      toast.success('Expense added successfully!');
      setShowModal(false);
      setFormData({ title: '', amount: '', category: 'Other', date: new Date().toISOString().split('T')[0], description: '' });
      loadExpenses();
      loadSummary();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to add expense');
      console.error('Error:', error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this expense?')) return;
    try {
      await API.delete(`/expenses/${id}`);
      toast.success('Expense deleted successfully!');
      loadExpenses();
      loadSummary();
    } catch (error) {
      toast.error('Failed to delete expense');
      console.error('Error:', error);
    }
  };

  if (loading) {
    return <div className="loading">Loading expenses...</div>;
  }

  return (
    <div className="expenses-page">
      <div className="page-header">
        <h2 className="page-title">Expenses</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ➕ Add Expense
        </button>
      </div>

      {summary && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Total Expenses</div>
            <div className="stat-value value-red">PKR {summary.totalExpenses?.toLocaleString() || 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">This Month</div>
            <div className="stat-value value-orange">PKR {summary.monthlyExpenses?.toLocaleString() || 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Transactions</div>
            <div className="stat-value value-purple">{summary.totalTransactions || 0}</div>
          </div>
          {summary.categories && Object.keys(summary.categories).length > 0 && (
            <div className="stat-card">
              <div className="stat-label">Top Category</div>
              <div className="stat-value value-blue">
                {Object.keys(summary.categories).reduce((a, b) => summary.categories[a] > summary.categories[b] ? a : b)}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Category</th>
              <th>Amount</th>
              <th>Date</th>
              <th>Description</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr><td colSpan="7" className="no-data">No expenses recorded</td></tr>
            ) : (
              expenses.map((e, index) => (
                <tr key={e._id}>
                  <td>{index + 1}</td>
                  <td><strong>{e.title}</strong></td>
                  <td><span className="badge-category">{e.category}</span></td>
                  <td className="amount-expense">PKR {e.amount.toLocaleString()}</td>
                  <td>{new Date(e.date).toLocaleDateString()}</td>
                  <td className="notes-cell">{e.description || '—'}</td>
                  <td>
                    <button className="action-btn delete-btn" onClick={() => handleDelete(e._id)}>🗑️</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>💰 Add Expense</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Title *</label>
                <input type="text" name="title" value={formData.title} onChange={handleInputChange} required placeholder="e.g., Internet Bill" />
              </div>
              <div className="form-group">
                <label>Amount (PKR) *</label>
                <input type="number" name="amount" value={formData.amount} onChange={handleInputChange} required min="1" />
              </div>
              <div className="form-group">
                <label>Category</label>
                <select name="category" value={formData.category} onChange={handleInputChange}>
                  <option value="Utilities">Utilities</option>
                  <option value="Salaries">Salaries</option>
                  <option value="Equipment">Equipment</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Office">Office</option>
                  <option value="Internet">Internet</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Date</label>
                <input type="date" name="date" value={formData.date} onChange={handleInputChange} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" name="description" value={formData.description} onChange={handleInputChange} placeholder="Optional description..." />
              </div>
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="save-btn">Add Expense</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Expenses;