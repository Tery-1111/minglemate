import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function OperationalMetrics() {
  const [success, setSuccess] = useState({ ghost_rate: 0, interaction_rate: 0 });
  const [pool, setPool] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const { data: s } = await supabase.from('match_success_metrics').select('*').single();
      const { data: p } = await supabase.from('pool_diagnostics').select('*');
      if (s) setSuccess(s);
      if (p) setPool(p);
    };
    fetchData();
  }, []);

  return (
    <div>
      <h3>Match Quality</h3>
      <p>Ghost Rate: {success.ghost_rate}%</p>
      <h3>Pool Imbalance</h3>
      {pool.map(p => (
        <div key={p.campus_name} style={{ color: p.m_f_ratio > 2 ? 'red' : 'green' }}>
          {p.campus_name}: M/F Ratio {p.m_f_ratio}
        </div>
      ))}
    </div>
  );
}
