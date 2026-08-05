import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import API from '../utils/api';
import toast from 'react-hot-toast';
import VoiceController from './VoiceController';
import HeaderSearch from './HeaderSearch';
import { subscribeBannerText } from '../utils/bannerBus';
import { LOGO_DATA_URI } from '../assets/logoData';
import './Layout.css';

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [profilePicture, setProfilePicture] = useState('');
  const [bannerText, setBannerText] = useState('Welcome AT Muhammad Shah Panel');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editBrandName, setEditBrandName] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved === 'true') {
      setDarkMode(true);
      document.documentElement.classList.add('dark-mode');
      document.body.classList.add('dark-mode');
    }

    if (user) {
      setEditName(user.fullName || user.username || '');
      setEditEmail(user.email || '');
      setEditBrandName(user.brandName || 'ZEEP BROAD BRAND');
      setProfilePicture(user.profilePicture || '');
    }
  }, [user]);

  // Load the sliding header banner text (shared across every device, stored
  // server-side) and keep it live-synced if it's edited on the Settings page
  // while this Layout is already mounted.
  useEffect(() => {
    let cancelled = false;
    API.get('/settings')
      .then((res) => {
        const text = res.data?.data?.bannerText;
        if (!cancelled && text) setBannerText(text);
      })
      .catch(() => {
        // Non-critical - keep the default banner text if this fails.
      });
    const unsubscribe = subscribeBannerText((text) => {
      if (!cancelled) setBannerText(text);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Close sidebar on mobile when route changes
  useEffect(() => {
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, [location.pathname]);

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add('dark-mode');
      document.body.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('darkMode', newMode.toString());
  };

  const handleProfilePictureUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be less than 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result;
      setUploadingPicture(true);
      try {
        const res = await API.put('/auth/profile-picture', {
          profilePicture: base64String
        });
        if (res.data.success) {
          setProfilePicture(base64String);
          setShowUploadModal(false);
          toast.success('Profile picture updated!');
        }
      } catch (error) {
        toast.error(error.response?.data?.message || 'Failed to upload profile picture');
      } finally {
        setUploadingPicture(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const removeProfilePicture = async () => {
    setUploadingPicture(true);
    try {
      const res = await API.delete('/auth/profile-picture');
      if (res.data.success) {
        setProfilePicture('');
        toast.success('Profile picture removed');
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to remove profile picture');
    } finally {
      setUploadingPicture(false);
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();

    if (!editName || editName.trim() === '') {
      toast.error('Name cannot be empty');
      return;
    }
    if (!editBrandName || editBrandName.trim() === '') {
      toast.error('Brand name cannot be empty');
      return;
    }

    setLoading(true);
    try {
      const res = await API.put('/auth/update', {
        fullName: editName.trim(),
        email: editEmail.trim()
      });

      // Separate endpoint on purpose - this is the business's brand name,
      // not the logged-in person's own display name, and only worth an
      // extra request when it actually changed.
      if (editBrandName.trim() !== (user?.brandName || 'ZEEP BROAD BRAND')) {
        await API.put('/auth/brand-name', { brandName: editBrandName.trim() });
      }

      if (res.data.success) {
        toast.success('Profile updated successfully!');
        setShowEditProfileModal(false);
        window.location.reload();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const menuItems = [
    { path: '/dashboard', icon: '📊', label: 'Dashboard' },
    { path: '/customers', icon: '👥', label: 'Customers' },
    { path: '/packages', icon: '📦', label: 'Packages' },
    { path: '/billing', icon: '🧾', label: 'Monthly Bills' },
    { path: '/payments', icon: '💳', label: 'Payments' },
    { path: '/expenses', icon: '💰', label: 'Expenses' },
    { path: '/reports', icon: '📈', label: 'Reports' },
    { path: '/activity-log', icon: '🕘', label: 'Activity Log' },
    { path: '/settings', icon: '⚙️', label: 'Settings' },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getUserInitials = () => {
    if (!user?.username) return 'U';
    return user.username.charAt(0).toUpperCase();
  };

  const getDisplayName = () => {
    if (user?.fullName && user.fullName.trim() !== '') {
      return user.fullName;
    }
    return user?.username || 'Admin';
  };

  // Toggle sidebar function
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className={`layout ${darkMode ? 'dark-mode' : ''}`}>
      {/* Sidebar Overlay - for mobile */}
      <div className={`overlay ${sidebarOpen ? 'active' : ''}`} onClick={toggleSidebar}></div>

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-brand">
          <img src={LOGO_DATA_URI} alt="ISP Logo" className="brand-icon-img" />
          <span className="brand-text">{user?.brandName || 'ZEEP BROAD BRAND'}</span>
        </div>
        <nav className="sidebar-nav">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => {
                if (window.innerWidth <= 768) {
                  setSidebarOpen(false);
                }
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar-container">
              {profilePicture ? (
                <img
                  src={profilePicture}
                  alt="Profile"
                  className="user-avatar-img"
                  onClick={() => setShowUploadModal(true)}
                />
              ) : (
                <span
                  className="user-avatar-initials"
                  onClick={() => setShowUploadModal(true)}
                >
                  {getUserInitials()}
                </span>
              )}
            </div>
            <div>
              <div className="user-name">{getDisplayName()}</div>
              <div className="user-role">{user?.role || 'Staff'}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            🚪 Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="top-bar">
          {/* Desktop toggle button */}
          <button 
            className="toggle-btn"
            onClick={toggleSidebar}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>

          {/* Mobile toggle button (hamburger) */}
          <button 
            className="mobile-toggle"
            onClick={toggleSidebar}
          >
            ☰
          </button>

          <h1>{menuItems.find(item => item.path === location.pathname)?.label || 'Dashboard'}</h1>

          <HeaderSearch />

          <div className="header-banner-wrap">
            <span className="header-banner-icon" aria-hidden="true">🌐</span>
            <div className="header-banner-track">
              <span>{bannerText}</span>
            </div>
          </div>

          <div className="top-bar-actions">
            <button className="theme-toggle-btn" onClick={toggleDarkMode}>
              {darkMode ? '☀️ Light' : '🌙 Dark'}
            </button>

            <div className="top-bar-profile-wrapper" onClick={() => setShowEditProfileModal(true)}>
              <div className="top-bar-profile">
                {profilePicture ? (
                  <img src={profilePicture} alt="Profile" className="top-bar-avatar" />
                ) : (
                  <span className="top-bar-avatar-initials">{getUserInitials()}</span>
                )}
              </div>
              <div className="top-bar-user-info">
                <div className="top-bar-username">{getDisplayName()}</div>
                <div className="top-bar-userrole">{user?.role || 'Administrator'}</div>
              </div>
            </div>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>📸 Upload Profile Picture</h3>
            <div className="upload-preview">
              {profilePicture ? (
                <img src={profilePicture} alt="Current profile" className="upload-preview-img" />
              ) : (
                <div className="upload-preview-placeholder">{getUserInitials()}</div>
              )}
            </div>
            <p style={{ textAlign: 'center', color: '#6b7f99', marginBottom: '16px' }}>
              Current Profile Picture
            </p>
            <div className="form-group">
              <label>Select Image (JPG, PNG, GIF)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleProfilePictureUpload}
                disabled={uploadingPicture}
              />
              <small>Maximum size: 2MB</small>
              {uploadingPicture && <small>Saving...</small>}
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-btn" onClick={() => setShowUploadModal(false)}>
                Cancel
              </button>
              {profilePicture && (
                <button type="button" className="btn btn-danger" onClick={removeProfilePicture} disabled={uploadingPicture}>
                  Remove Picture
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showEditProfileModal && (
        <div className="modal-overlay" onClick={() => setShowEditProfileModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>✏️ Edit Profile</h3>
            <form onSubmit={handleUpdateProfile}>
              <div className="form-group">
                <label>Display Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Enter your display name"
                  required
                />
                <small>This name will appear in the top bar</small>
              </div>
              <div className="form-group">
                <label>Brand Name</label>
                <input
                  type="text"
                  value={editBrandName}
                  onChange={(e) => setEditBrandName(e.target.value)}
                  placeholder="e.g. ZEEP BROAD BRAND"
                  maxLength={40}
                  required
                />
                <small>Shown top-left of the sidebar, next to the logo</small>
              </div>
              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                />
              </div>
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  value={user?.username || ''}
                  disabled
                />
                <small>Username cannot be changed</small>
              </div>
              <div className="form-group">
                <label>Role</label>
                <input
                  type="text"
                  value={user?.role || 'Staff'}
                  disabled
                />
                <small>Role cannot be changed</small>
              </div>
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setShowEditProfileModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="save-btn" disabled={loading}>
                  {loading ? 'Saving...' : '💾 Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Push-to-talk voice controller - only listens while the button is held */}
      <VoiceController />
    </div>
  );
};

export default Layout;
