import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function AdminSafetyDashboard() {
  const [reports, setReports] = useState([]);

  useEffect(() => {
    fetchReports();
  }, []);

  async function fetchReports() {
    const { data, error } = await supabase.from('reports').select('*');
    if (error) {
      console.error('Fetch error:', error);
    } else {
      setReports(data || []);
    }
  }

  async function updateStatus(userId, newStatus) {
    const { error } = await supabase
      .from('users')
      .update({ account_status: newStatus })
      .eq('id', userId);
    
    if (!error) {
      alert(\User status updated to \\);
      fetchReports();
    } else {
      console.error('Error updating status:', error);
    }
  }

  return (
    <div className="safety-dashboard" style={{ padding: '20px' }}>
      <h2>?? Report & Safety Center</h2>
      {reports.length === 0 ? <p>No active reports.</p> : reports.map(report => (
        <div key={report.id} style={{ border: '1px solid #ff4d4f', margin: '10px 0', padding: '15px', borderRadius: '8px' }}>
          <p><strong>Reported User:</strong> {report.reported_id}</p>
          <p><strong>Reason:</strong> {report.reason}</p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => updateStatus(report.reported_id, 'frozen')}>Freeze</button>
            <button onClick={() => updateStatus(report.reported_id, 'shadow_banned')}>Shadow-Ban</button>
            <button onClick={() => updateStatus(report.reported_id, 'active')}>Clear</button>
          </div>
        </div>
      ))}
    </div>
  );
}
