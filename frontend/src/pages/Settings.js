import React, { useState, useEffect, useCallback } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';

const Settings = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const [usernameForm, setUsernameForm] = useState({
    currentUsername: '',
    newUsername: '',
    confirmUsername: ''
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [usernameSuccess, setUsernameSuccess] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // ===== LOAD USER FUNCTION =====
  const loadUser = useCallback(async () => {
    try {
      setLoading(true);
      const res = await API.get('/auth/me');
      setUser(res.data.user);
      setUsernameForm(prev => ({
        ...prev,
        currentUsername: res.data.user.username || ''
      }));
    } catch (error) {
      toast.error('Failed to load user data');
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // ===== CHANGE USERNAME =====
  const handleUsernameSubmit = async (e) => {
    e.preventDefault();
    setUsernameSuccess('');

    if (!usernameForm.newUsername || !usernameForm.confirmUsername) {
      toast.error('Please fill in all username fields');
      return;
    }

    if (usernameForm.newUsername !== usernameForm.confirmUsername) {
      toast.error('New usernames do not match');
      return;
    }

    if (usernameForm.newUsername === usernameForm.currentUsername) {
      toast.error('New username is the same as current');
      return;
    }

    if (usernameForm.newUsername.length < 3) {
      toast.error('Username must be at least 3 characters');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(usernameForm.newUsername)) {
      toast.error('Username can only contain letters, numbers, and underscore');
      return;
    }

    setUpdating(true);
    try {
      const res = await API.put('/auth/change-username', {
        newUsername: usernameForm.newUsername.trim()
      });

      if (res.data.success) {
        toast.success('Username updated successfully!');
        setUsernameSuccess('✅ Username updated to: ' + res.data.user.username);

        localStorage.setItem('token', res.data.token);
        setUsernameForm({
          currentUsername: res.data.user.username,
          newUsername: '',
          confirmUsername: ''
        });
        await loadUser();
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update username');
    } finally {
      setUpdating(false);
    }
  };

  // ===== CHANGE PASSWORD =====
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordSuccess('');

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (passwordForm.newPassword === passwordForm.currentPassword) {
      toast.error('New password is the same as current password');
      return;
    }

    setUpdating(true);
    try {
      const res = await API.put('/auth/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });

      if (res.data.success) {
        toast.success('Password changed successfully!');
        setPasswordSuccess('✅ Password changed successfully!');
        setPasswordForm({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        });
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to change password');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading settings...</div>;
  }

  return (
    <div className="settings-page">
      <h2 className="page-title">⚙️ Settings</h2>

      <div className="settings-grid">
        {/* CHANGE USERNAME */}
        <div className="settings-card">
          <div className="settings-card-header">
            <span className="settings-icon">👤</span>
            <div>
              <h3>Change Username</h3>
              <p>Update your login username</p>
            </div>
          </div>

          {usernameSuccess && (
            <div className="success-message">{usernameSuccess}</div>
          )}

          <form onSubmit={handleUsernameSubmit}>
            <div className="form-group">
              <label>Current Username</label>
              <input
                type="text"
                value={usernameForm.currentUsername}
                disabled
                className="disabled-input"
              />
            </div>
            <div className="form-group">
              <label>New Username</label>
              <input
                type="text"
                value={usernameForm.newUsername}
                onChange={(e) => setUsernameForm({ ...usernameForm, newUsername: e.target.value })}
                placeholder="Enter new username"
                required
              />
              <small>Only letters, numbers, and underscore (_)</small>
            </div>
            <div className="form-group">
              <label>Confirm New Username</label>
              <input
                type="text"
                value={usernameForm.confirmUsername}
                onChange={(e) => setUsernameForm({ ...usernameForm, confirmUsername: e.target.value })}
                placeholder="Confirm new username"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={updating}>
              {updating ? 'Updating...' : '👤 Change Username'}
            </button>
          </form>
        </div>

        {/* CHANGE PASSWORD */}
        <div className="settings-card">
          <div className="settings-card-header">
            <span className="settings-icon">🔒</span>
            <div>
              <h3>Change Password</h3>
              <p>Update your account password</p>
            </div>
          </div>

          {passwordSuccess && (
            <div className="success-message">{passwordSuccess}</div>
          )}

          <form onSubmit={handlePasswordSubmit}>
            <div className="form-group">
              <label>Current Password</label>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                placeholder="Enter current password"
                required
              />
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                placeholder="Enter new password (min 6 characters)"
                required
              />
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                placeholder="Confirm new password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={updating}>
              {updating ? 'Updating...' : '🔒 Change Password'}
            </button>
          </form>
        </div>

        {/* ACCOUNT INFO */}
        <div className="settings-card full-width">
          <div className="settings-card-header">
            <span className="settings-icon">📋</span>
            <div>
              <h3>Account Information</h3>
              <p>Your account details</p>
            </div>
          </div>

          <div className="account-info-grid">
            <div className="account-info-item">
              <span className="account-label">Username</span>
              <span className="account-value">{user?.username}</span>
            </div>
            <div className="account-info-item">
              <span className="account-label">Email</span>
              <span className="account-value">{user?.email}</span>
            </div>
            <div className="account-info-item">
              <span className="account-label">Full Name</span>
              <span className="account-value">{user?.fullName || 'Not set'}</span>
            </div>
            <div className="account-info-item">
              <span className="account-label">Role</span>
              <span className="account-value" style={{ textTransform: 'capitalize' }}>{user?.role}</span>
            </div>
            <div className="account-info-item">
              <span className="account-label">Account Status</span>
              <span className="account-value" style={{ color: '#28a745' }}>✅ Active</span>
            </div>
            <div className="account-info-item">
              <span className="account-label">Last Login</span>
              <span className="account-value">{user?.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'N/A'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
