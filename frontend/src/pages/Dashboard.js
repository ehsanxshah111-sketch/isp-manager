import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { getPageCache, setPageCache } from '../utils/pageCache';
import RefreshButton from '../components/RefreshButton';

const Dashboard = () => {
  const cached = getPageCache('dashboard');
  const navigate = useNavigate();
  const [stats, setStats] = useState(cached?.stats || null);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [dailyData, setDailyData] = useState(cached?.dailyData || []);
  const [recentCustomers, setRecentCustomers] = useState(cached?.recentCustomers || []);

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDashboard = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setRefreshing(true);
      else if (!cached) setLoading(true);
      const res = await API.get('/dashboard');
      const data = res.data.data;
      setStats(data.stats);
      setDailyData(data.dailyData || []);
      setRecentCustomers(data.recentCustomers || []);
      setPageCache('dashboard', data);
    } catch (error) {
      toast.error('Failed to load dashboard data');
      console.error('Dashboard error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  if (!stats) {
    return <div className="loading">No data available</div>;
  }

  const statCards = [
    { label: 'Total Customers', value: stats.totalCustomers, color: 'blue' },
    { label: 'Active', value: stats.active, color: 'green' },
    { label: 'Cut Off', value: stats.cutOff || 0, color: 'red' },
    { label: 'Disable', value: stats.disable || 0, color: 'gray' },
    { label: 'Paid', value: stats.paid, color: 'green' },
    { label: 'Unpaid', value: stats.unpaid, color: 'red' },
    { label: 'Total Revenue (Active Only)', value: `PKR ${stats.totalRevenue.toLocaleString()}`, color: 'blue' },
    { label: 'Total Dues (All Customers)', value: `PKR ${stats.totalDues.toLocaleString()}`, color: 'red' },
    { label: 'Total Recovery (All Customers)', value: `PKR ${(stats.totalRecovery ?? stats.totalDues).toLocaleString()}`, color: 'orange' },
    { label: 'Collected', value: `PKR ${stats.collected.toLocaleString()}`, color: 'green' },
    { label: 'Pending Collection', value: `PKR ${stats.pendingCollection.toLocaleString()}`, color: 'orange' },
    { label: 'Total Expenses', value: `PKR ${stats.totalExpenses.toLocaleString()}`, color: 'red' },
    { label: 'Net Profit', value: `PKR ${stats.netProfit.toLocaleString()}`, color: stats.netProfit >= 0 ? 'green' : 'red' },
  ];

  const maxRevenue = Math.max(...dailyData.map(d => d.revenue), 1);
  const maxCount = Math.max(...dailyData.map(d => d.count), 1);
  const hasData = dailyData.some(d => d.count > 0 || d.revenue > 0);

  const getColorClass = (color) => {
    const classes = {
      blue: 'value-blue',
      green: 'value-green',
      red: 'value-red',
      orange: 'value-orange',
      gray: 'value-gray'
    };
    return classes[color] || '';
  };

  return (
    <div className="dashboard-page">
      <div className="page-header-row">
        <h2 className="page-title">Dashboard Overview</h2>
        <RefreshButton onRefresh={() => loadDashboard(true)} refreshing={refreshing} />
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        {statCards.map((card, index) => (
          <div key={index} className="stat-card">
            <div className="stat-label">{card.label}</div>
            <div className={`stat-value ${getColorClass(card.color)}`}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="quick-actions-section">
        <h3>Quick Actions</h3>
        <div className="quick-actions-row">
          <button
            className="quick-action-btn"
            onClick={() => navigate('/customers', { state: { openAdd: true } })}
          >
            ➕ Add New Customer
          </button>
          <button
            className="quick-action-btn"
            onClick={() => navigate('/billing')}
          >
            🧾 Generate Monthly Bills
          </button>
        </div>
      </div>

      {/* Daily Revenue Chart */}
      <div className="chart-section">
        <h3>Daily Revenue (by Due Date)</h3>
        {hasData ? (
          <div className="chart-container">
            {dailyData.map((item) => (
              <div key={item.day} className="chart-bar-wrapper">
                <div className="chart-bar">
                  <div
                    className="bar-revenue"
                    style={{ height: `${Math.max((item.revenue / maxRevenue) * 140, 4)}px` }}
                  />
                </div>
                <div className="chart-label">{item.day}</div>
                <div className="chart-value">{item.revenue > 0 ? `${(item.revenue/1000).toFixed(1)}k` : ''}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="no-data">No revenue data available yet</p>
        )}
        <div className="chart-legend">📊 Revenue by Day of Month (1-31)</div>
      </div>

      {/* Daily Customers Chart */}
      <div className="chart-section">
        <h3>Customers by Due Date</h3>
        {hasData ? (
          <div className="chart-container">
            {dailyData.map((item) => (
              <div key={item.day} className="chart-bar-wrapper">
                <div className="chart-bar">
                  <div
                    className="bar-customers"
                    style={{ height: `${Math.max((item.count / maxCount) * 140, 4)}px` }}
                  />
                </div>
                <div className="chart-label">{item.day}</div>
                <div className="chart-value">{item.count > 0 ? item.count : ''}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="no-data">No customer data available yet</p>
        )}
        <div className="chart-legend">👥 Customers by Day of Month (1-31)</div>
      </div>

      {/* Recent Customers */}
      <div className="recent-section">
        <h3>Recent Customers</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Customer ID</th>
                <th>Monthly Fee</th>
                <th>Status</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {recentCustomers.length === 0 ? (
                <tr><td colSpan="5" className="no-data">No customers found</td></tr>
              ) : (
                recentCustomers.map((c) => (
                  <tr key={c._id}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.customerId}</td>
                    <td>PKR {c.monthlyFee.toLocaleString()}</td>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;