import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function AlertCenter() {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    const fetchAlerts = async () => {
      const { data } = await supabase.from('system_alerts').select('*').eq('resolved', false);
      setAlerts(data || []);
    };
    fetchAlerts();
  }, []);

  return (
    <div style={{ backgroundColor: '#fff0f0', padding: '15px', border: '1px solid red' }}>
      <h3>System Alerts</h3>
      {alerts.length === 0 ? <p>System Healthy</p> : alerts.map(a => (
        <div key={a.id} style={{ color: 'red' }}>
          <strong>{a.severity}:</strong> {a.message}
        </div>
      ))}
    </div>
  );
}
