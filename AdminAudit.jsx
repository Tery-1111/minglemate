import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function AdminAudit() {
  const [ids, setIds] = useState({ userA: '', userB: '' });
  const [analysis, setAnalysis] = useState(null);

  async function runAudit() {
    const { data, error } = await supabase.rpc('get_match_drivers', { 
      user_a_id: ids.userA, 
      user_b_id: ids.userB 
    });
    if (error) console.error(error);
    else setAnalysis(data);
  }

  return (
    <div className="audit-panel" style={{ padding: '20px', border: '1px solid #ccc' }}>
      <h3>Match Explainability Audit</h3>
      <input placeholder="User A ID" onChange={e => setIds({...ids, userA: e.target.value})} />
      <input placeholder="User B ID" onChange={e => setIds({...ids, userB: e.target.value})} />
      <button onClick={runAudit}>Analyze Compatibility</button>
      
      {analysis && analysis.length > 0 && (
        <div className="results" style={{ marginTop: '20px' }}>
          <h4>Compatibility Drivers:</h4>
          {analysis[0].shared_values?.map(v => <p key={v} style={{color: 'green'}}>+ {v}</p>)}
          {analysis[0].conflicts?.map(c => <p key={c} style={{color: 'red'}}>- {c}</p>)}
        </div>
      )}
    </div>
  );
}
