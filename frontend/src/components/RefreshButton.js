import React from 'react';
import './RefreshButton.css';

// A small, consistent "refresh just this page" control. Every data page
// (Dashboard, Customers, Payments, Expenses, Reports, Activity Log) uses
// this instead of the user having to hit the browser's full reload.
const RefreshButton = ({ onRefresh, refreshing }) => (
  <button
    type="button"
    className="refresh-btn"
    onClick={onRefresh}
    disabled={refreshing}
    title="Refresh this page"
  >
    <span className={`refresh-btn-icon${refreshing ? ' spinning' : ''}`}>🔄</span>
    {refreshing ? 'Refreshing...' : 'Refresh'}
  </button>
);

export default RefreshButton;
