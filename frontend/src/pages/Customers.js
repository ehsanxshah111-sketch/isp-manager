import React, { useState, useEffect } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { consumePendingCustomerTarget } from '../utils/voiceBus';

const Customers = () => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPayment, setFilterPayment] = useState('all');
  const [sendingWhatsApp, setSendingWhatsApp] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    customerId: '',
    monthlyFee: '',
    pendingDues: '0',
    connectionDate: '',
    phone: '',
    status: 'Active',
    paymentStatus: 'Unpaid',
  });

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const res = await API.get('/customers?limit=1000');
      const list = res.data.data;
      setCustomers(list);

      // If a voice command navigated here wanting a specific customer opened
      // (e.g. "open John's profile"), do that now that we have the list.
      const pending = consumePendingCustomerTarget();
      if (pending) {
        const found = list.find(
          (c) =>
            (pending.target.mongoId && c._id === pending.target.mongoId) ||
            (pending.target.customerId && c.customerId === pending.target.customerId)
        );
        if (found) openEditModal(found);
      }
    } catch (error) {
      toast.error('Failed to load customers');
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const resetForm = () => {
    setFormData({
      name: '',
      customerId: '',
      monthlyFee: '',
      pendingDues: '0',
      connectionDate: '',
      phone: '',
      status: 'Active',
      paymentStatus: 'Unpaid',
    });
    setEditingCustomer(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      customerId: customer.customerId,
      monthlyFee: customer.monthlyFee,
      pendingDues: customer.pendingDues || 0,
      connectionDate: customer.connectionDate || '',
      phone: customer.phone || '',
      status: customer.status,
      paymentStatus: customer.paymentStatus,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingCustomer) {
        await API.put(`/customers/${editingCustomer._id}`, formData);
        toast.success('Customer updated successfully!');
      } else {
        await API.post('/customers', formData);
        toast.success('Customer added successfully!');
      }
      setShowModal(false);
      resetForm();
      loadCustomers();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Operation failed');
      console.error('Error:', error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this customer?')) return;
    try {
      await API.delete(`/customers/${id}`);
      toast.success('Customer deleted successfully!');
      loadCustomers();
    } catch (error) {
      toast.error('Failed to delete customer');
      console.error('Error:', error);
    }
  };

  const sendWhatsAppReminder = async (customer) => {
    if (!customer.phone || customer.phone.trim() === '') {
      toast.error('No phone number available for this customer!');
      return;
    }

    setSendingWhatsApp(customer._id);
    try {
      const res = await API.post('/whatsapp/send', {
        customerId: customer.customerId
      });

      if (res.data.success) {
        window.open(res.data.data.whatsappUrl, '_blank');
        toast.success(`WhatsApp opened for ${customer.name}!`);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to send reminder');
      console.error('Error:', error);
    } finally {
      setSendingWhatsApp(null);
    }
  };

  const sendBulkWhatsApp = async () => {
    const unpaid = customers.filter(c => c.paymentStatus === 'Unpaid' && c.phone);
    if (unpaid.length === 0) {
      toast.error('No unpaid customers with phone numbers found!');
      return;
    }

    if (!window.confirm(`Send WhatsApp reminders to ${unpaid.length} unpaid customers?`)) return;

    try {
      const res = await API.post('/whatsapp/bulk');
      if (res.data.success) {
        const links = res.data.data || [];
        links.slice(0, 5).forEach(item => {
          window.open(item.whatsappUrl, '_blank');
        });
        toast.success(`Opened WhatsApp for ${links.length} customers!`);
      }
    } catch (error) {
      toast.error('Failed to send bulk reminders');
      console.error('Error:', error);
    }
  };

  const filteredCustomers = customers.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
                          c.customerId.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
    const matchesPayment = filterPayment === 'all' || c.paymentStatus === filterPayment;
    return matchesSearch && matchesStatus && matchesPayment;
  });

  if (loading) {
    return <div className="loading">Loading customers...</div>;
  }

  return (
    <div className="customers-page">
      <div className="page-header">
        <h2 className="page-title">Customers ({customers.length})</h2>
        <div className="header-buttons">
          <button className="btn btn-whatsapp" onClick={sendBulkWhatsApp}>
            📱 Bulk WhatsApp
          </button>
          <button className="btn btn-primary" onClick={openAddModal}>
            ➕ Add Customer
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search by name or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="filter-input"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Status</option>
          <option value="Active">Active</option>
          <option value="Cut Off">Cut Off</option>
          <option value="Disable">Disable</option>
        </select>
        <select
          value={filterPayment}
          onChange={(e) => setFilterPayment(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Payment</option>
          <option value="Unpaid">Unpaid</option>
          <option value="Paid">Paid</option>
          <option value="1 YEAR ADVANCED">Advanced</option>
          <option value="FREE">FREE</option>
        </select>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Customer ID</th>
              <th>Monthly Fee</th>
              <th>Pending Dues</th>
              <th>Day</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.length === 0 ? (
              <tr><td colSpan="10" className="no-data">No customers found</td></tr>
            ) : (
              filteredCustomers.map((c, index) => (
                <tr key={c._id}>
                  <td>{index + 1}</td>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.customerId}</td>
                  <td>PKR {c.monthlyFee.toLocaleString()}</td>
                  <td className={c.pendingDues > 0 ? 'dues-positive' : 'dues-zero'}>
                    {c.pendingDues > 0 ? `PKR ${c.pendingDues.toLocaleString()}` : '—'}
                  </td>
                  <td className="day-cell">{c.connectionDate || '—'}</td>
                  <td>
                    {c.phone ? (
                      <span className="phone-display">
                        {c.phone}
                        <button
                          className="btn-whatsapp-small"
                          onClick={() => sendWhatsAppReminder(c)}
                          disabled={sendingWhatsApp === c._id}
                          title="Send WhatsApp reminder"
                        >
                          {sendingWhatsApp === c._id ? '⏳' : '📱'}
                        </button>
                      </span>
                    ) : (
                      <span className="no-phone">No phone</span>
                    )}
                  </td>
                  <td>
                    <span className={`status-badge ${c.status.toLowerCase().replace(' ', '-')}`}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${c.paymentStatus.toLowerCase().replace(' ', '-')}`}>
                      {c.paymentStatus}
                    </span>
                  </td>
                  <td>
                    <button className="action-btn" onClick={() => openEditModal(c)}>✏️</button>
                    <button className="action-btn delete-btn" onClick={() => handleDelete(c._id)}>🗑️</button>
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
            <h3>{editingCustomer ? '✏️ Edit Customer' : '➕ Add New Customer'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="modal-grid">
                <div className="form-group">
                  <label>Name *</label>
                  <input type="text" name="name" value={formData.name} onChange={handleInputChange} required />
                </div>
                <div className="form-group">
                  <label>Customer ID *</label>
                  <input type="text" name="customerId" value={formData.customerId} onChange={handleInputChange} required />
                </div>
                <div className="form-group">
                  <label>Monthly Fee (PKR) *</label>
                  <input type="number" name="monthlyFee" value={formData.monthlyFee} onChange={handleInputChange} required />
                </div>
                <div className="form-group">
                  <label>Pending Dues</label>
                  <input type="number" name="pendingDues" value={formData.pendingDues} onChange={handleInputChange} />
                </div>
                <div className="form-group">
                  <label>Day (1-31)</label>
                  <input type="text" name="connectionDate" value={formData.connectionDate} onChange={handleInputChange} placeholder="e.g., 15" />
                </div>
                <div className="form-group">
                  <label>Phone Number</label>
                  <input type="text" name="phone" value={formData.phone} onChange={handleInputChange} placeholder="e.g., 0300-1234567" />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select name="status" value={formData.status} onChange={handleInputChange}>
                    <option value="Active">Active</option>
                    <option value="Cut Off">Cut Off</option>
                    <option value="Disable">Disable</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Payment Status</label>
                  <select name="paymentStatus" value={formData.paymentStatus} onChange={handleInputChange}>
                    <option value="Unpaid">Unpaid</option>
                    <option value="Paid">Paid</option>
                    <option value="1 YEAR ADVANCED">1 YEAR ADVANCED</option>
                    <option value="FREE">FREE</option>
                  </select>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="save-btn">{editingCustomer ? 'Update' : 'Add'} Customer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;