import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function ModerationPanel() {
  const [users, setUsers] = useState([]);

  const updateStatus = async (userId, newStatus) => {
    await supabase.from('users').update({ status: newStatus }).eq('id', userId);
    alert(`User ${userId} is now ${newStatus}`);
    fetchUsers();
  };

  const fetchUsers = async () => {
    const { data } = await supabase.from('users').select('id, status').limit(10);
    setUsers(data || []);
  };

  useEffect(() => { fetchUsers(); }, []);

  return (
    <div>
      <h3>User Moderation</h3>
      {users.map(u => (
        <div key={u.id} style={{ marginBottom: '10px' }}>
          User: {u.id} | Status: <b>{u.status}</b>
          <button onClick={() => updateStatus(u.id, 'frozen') }>Freeze</button>
          <button onClick={() => updateStatus(u.id, 'banned') }>Ban</button>
        </div>
      ))}
    </div>
  );
}
