import React, { useState, useEffect } from 'react';
import API from '../utils/api';
import toast from 'react-hot-toast';
import { getPageCache, setPageCache } from '../utils/pageCache';
import RefreshButton from '../components/RefreshButton';

const Reports = () => {
  const cachedReports = getPageCache('reports');
  const [customers, setCustomers] = useState(cachedReports?.customers || []);
  const [payments, setPayments] = useState(cachedReports?.payments || []);
  const [loading, setLoading] = useState(!cachedReports);
  const [refreshing, setRefreshing] = useState(false);
  const [reportType, setReportType] = useState('customers');

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setRefreshing(true);
      else if (!cachedReports) setLoading(true);
      const [customersRes, paymentsRes] = await Promise.all([
        API.get('/customers'),
        API.get('/payments'),
      ]);
      setCustomers(customersRes.data.data);
      setPayments(paymentsRes.data.data);
      setPageCache('reports', { customers: customersRes.data.data, payments: paymentsRes.data.data });
    } catch (error) {
      toast.error('Failed to load data');
      console.error('Error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const exportCSV = (data, filename) => {
    if (!data || data.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(','),
      ...data.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Export started!');
  };

  if (loading) {
    return <div className="loading">Loading reports...</div>;
  }

  const customerReportData = customers.map(c => ({
    Name: c.name,
    'Customer ID': c.customerId,
    'Monthly Fee': c.monthlyFee,
    'Pending Dues': c.pendingDues || 0,
    Phone: c.phone || '',
    Status: c.status,
    'Payment Status': c.paymentStatus,
  }));

  const paymentReportData = payments.map(p => ({
    'Receipt #': p.receiptNumber,
    Date: new Date(p.date).toLocaleDateString(),
    'Customer ID': p.customerId,
    'Customer Name': p.customerName,
    Amount: p.amount,
    Month: p.billingMonth,
    Method: p.method,
  }));

  const duesReportData = customers
    .filter(c => c.pendingDues > 0 || c.paymentStatus === 'Unpaid')
    .map(c => ({
      Name: c.name,
      'Customer ID': c.customerId,
      'Monthly Fee': c.monthlyFee,
      'Pending Dues': c.pendingDues || 0,
      'Payment Status': c.paymentStatus,
      Phone: c.phone || '',
    }));

  const reports = [
    { id: 'customers', label: '📋 Customer Report', data: customerReportData },
    { id: 'payments', label: '💰 Payment Report', data: paymentReportData },
    { id: 'dues', label: '⚠️ Dues Report', data: duesReportData },
  ];

  const currentReport = reports.find(r => r.id === reportType);

  return (
    <div className="reports-page">
      <div className="page-header-row">
        <h2 className="page-title">📊 Reports</h2>
        <RefreshButton onRefresh={() => loadData(true)} refreshing={refreshing} />
      </div>

      <div className="report-selector">
        {reports.map((r) => (
          <button
            key={r.id}
            className={`report-btn ${reportType === r.id ? 'active' : ''}`}
            onClick={() => setReportType(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="export-container">
        <button
          className="btn btn-success"
          onClick={() => exportCSV(currentReport?.data || [], reportType)}
          disabled={!currentReport?.data || currentReport.data.length === 0}
        >
          📥 Export CSV
        </button>
        <span className="record-count">{currentReport?.data?.length || 0} records</span>
      </div>

      <div className="table-container">
        {currentReport && currentReport.data.length > 0 ? (
          <table>
            <thead>
              <tr>
                {Object.keys(currentReport.data[0]).map((key) => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentReport.data.map((row, index) => (
                <tr key={index}>
                  {Object.values(row).map((value, i) => (
                    <td key={i}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="no-data">No data available for this report</div>
        )}
      </div>
    </div>
  );
};

export default Reports;