import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function IntelligencePanel() {
  const [risk, setRisk] = useState([]);
  const [weights, setWeights] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: r, error: rErr } = await supabase.from('user_risk_scores').select('*');
        const { data: w, error: wErr } = await supabase.from('question_success_correlation').select('*');
        
        if (rErr || wErr) throw new Error("Data fetch failed");
        
        setRisk(r || []);
        setWeights(w || []);
      } catch (err) {
        setError("Dashboard data is blocked or unreachable. Please disable AdBlocker.");
      }
    };
    fetchData();
  }, []);

  if (error) return <div style={{color: 'white', padding: '20px'}}>{error}</div>;

  return (
    <div>
      <h3>Top Risk Profiles</h3>
      {risk.length > 0 ? risk.slice(0, 5).map(u => <div key={u.user_id}>User {u.user_id}: Score {u.risk_score}</div>) : <p>No risk data.</p>}
      <h3>Adaptive Question Weights</h3>
      {weights.length > 0 ? weights.slice(0, 5).map(q => <div key={q.question_id}>Q: {q.question_id} - Score: {q.effectiveness_score.toFixed(2)}</div>) : <p>No weights data.</p>}
    </div>
  );
}
