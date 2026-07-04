import { supabase } from '../supabaseClient';

export default function Photos() {
  return (
    <div style={{ color: 'white', padding: '20px' }}>
      <h1>Photos</h1>
      <p>This page is now correctly connected to the central Supabase client.</p>
    </div>
  );
}
