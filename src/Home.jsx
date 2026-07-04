import { useEffect } from 'react';
import { supabase, saveOneSignalPlayerId } from './supabaseClient';
import Matches from './pages/Matches';
import AdminDashboard from './components/AdminDashboard';

export default function Home() {
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await saveOneSignalPlayerId(user.id);
    };
    init();
  }, []);

  return (
    <div className='home-container'>
      <h1>Welcome to MingleMate</h1>
      <AdminDashboard />
      <hr />
      <Matches />
    </div>
  );
}
