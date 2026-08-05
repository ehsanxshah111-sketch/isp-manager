import React, { useState, useEffect } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { getPageCache, setPageCache } from '../utils/pageCache';
import RefreshButton from '../components/RefreshButton';

const emptyForm = { name: '', price: '', speed: '', description: '' };

const Packages = () => {
  const cached = getPageCache('packages');
  const [packages, setPackages] = useState(cached?.packages || []);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPackages = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setRefreshing(true);
      const res = await API.get('/packages');
      setPackages(res.data.data);
      setPageCache('packages', { packages: res.data.data });
    } catch (error) {
      toast.error('Failed to load packages');
      console.error('Error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const openAddModal = () => {
    setEditingPackage(null);
    setFormData(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (pkg) => {
    setEditingPackage(pkg);
    setFormData({
      name: pkg.name,
      price: pkg.price,
      speed: pkg.speed || '',
      description: pkg.description || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...formData, price: Number(formData.price) };
      if (editingPackage) {
        await API.put(`/packages/${editingPackage._id}`, payload);
        toast.success('Package updated!');
      } else {
        await API.post('/packages', payload);
        toast.success('Package added!');
      }
      setShowModal(false);
      setFormData(emptyForm);
      setEditingPackage(null);
      loadPackages();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save package');
      console.error('Error:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pkg) => {
    if (!window.confirm(`Delete package "${pkg.name}"? This won't change any existing customer's fee - it only removes it from this price list.`)) return;
    try {
      await API.delete(`/packages/${pkg._id}`);
      toast.success('Package deleted');
      loadPackages();
    } catch (error) {
      toast.error('Failed to delete package');
      console.error('Error:', error);
    }
  };

  if (loading) {
    return <div className="loading">Loading packages...</div>;
  }

  return (
    <div className="packages-page">
      <div className="page-header">
        <h2 className="page-title">📦 Packages ({packages.length})</h2>
        <div className="header-buttons">
          <RefreshButton onRefresh={() => loadPackages(true)} refreshing={refreshing} />
          <button className="btn btn-primary" onClick={openAddModal}>
            ➕ Add Package
          </button>
        </div>
      </div>

      <p className="bulk-wa-hint">
        This is just a reusable price list for your internet plans - editing or deleting a package here
        does NOT change the monthly fee already set on any existing customer. It's a reference list, not a live link.
      </p>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Price</th>
              <th>Speed</th>
              <th>Description</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {packages.length === 0 ? (
              <tr><td colSpan="6" className="no-data">No packages added yet</td></tr>
            ) : (
              packages.map((p, index) => (
                <tr key={p._id}>
                  <td>{index + 1}</td>
                  <td><strong>{p.name}</strong></td>
                  <td className="amount-expense">PKR {p.price.toLocaleString()}</td>
                  <td>{p.speed || '—'}</td>
                  <td className="notes-cell">{p.description || '—'}</td>
                  <td>
                    <button className="action-btn edit-btn" onClick={() => openEditModal(p)}>✏️</button>
                    <button className="action-btn delete-btn" onClick={() => handleDelete(p)}>🗑️</button>
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
            <h3>{editingPackage ? '✏️ Edit Package' : '📦 Add Package'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Package Name *</label>
                <input type="text" name="name" value={formData.name} onChange={handleInputChange} required placeholder="e.g., Plan-1500" />
              </div>
              <div className="form-group">
                <label>Price (PKR) *</label>
                <input type="number" name="price" value={formData.price} onChange={handleInputChange} required min="0" />
              </div>
              <div className="form-group">
                <label>Speed</label>
                <input type="text" name="speed" value={formData.speed} onChange={handleInputChange} placeholder="e.g., 10 Mbps (optional)" />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" name="description" value={formData.description} onChange={handleInputChange} placeholder="Optional notes..." />
              </div>
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="save-btn" disabled={saving}>
                  {saving ? 'Saving...' : editingPackage ? '💾 Save Changes' : '➕ Add Package'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Packages;
