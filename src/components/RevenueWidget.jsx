import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function RevenueWidget() {
  const [stats, setStats] = useState({ total_prompts: 0, total_purchases: 0, conversion_rate: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      const { data } = await supabase.from('revenue_funnel_metrics').select('*').single();
      if (data) setStats(data);
    };
    fetchStats();
  }, []);

  return (
    <div style={{ border: '1px solid #ccc', padding: '15px', marginTop: '20px' }}>
      <h3>Revenue Funnel Intelligence</h3>
      <p>Paywall Views: {stats.total_prompts}</p>
      <p>Successful Conversions: {stats.total_purchases}</p>
      <h2 style={{ color: stats.conversion_rate < 2 ? 'red' : 'green' }}>
        Conversion Rate: {stats.conversion_rate}%
      </h2>
    </div>
  );
}
