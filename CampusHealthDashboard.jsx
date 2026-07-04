import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function CampusHealthDashboard() {
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    async function fetchMetrics() {
      const { data } = await supabase.from('platform_health_metrics').select('*').single();
      setMetrics(data);
    }
    fetchMetrics();
  }, []);

  if (!metrics) return <div>Loading Analytics...</div>;

  return (
    <div className="analytics-dashboard" style={{ padding: '20px' }}>
      <h2>?? Campus Health Overview</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div className="card"><h3>New Signups (7d)</h3><p>{metrics.new_signups_weekly}</p></div>
        <div className="card"><h3>Total Matches</h3><p>{metrics.total_matches}</p></div>
        <div className="card"><h3>Active Alerts</h3><p style={{ color: 'red' }}>{metrics.active_safety_alerts}</p></div>
        <div className="card"><h3>Msgs/Match</h3><p>{metrics.avg_msgs_per_match?.toFixed(2)}</p></div>
      </div>
    </div>
  );
}
