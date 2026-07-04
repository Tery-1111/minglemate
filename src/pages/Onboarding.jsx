import { supabase } from '../supabaseClient';
import { useState } from 'react';

export default function Onboarding() {
  // Now using the shared supabase client imported above
  return (
    <div style={{ color: 'white', padding: '20px' }}>
      <h1>Onboarding</h1>
      <p>System is stable and connected to the central Supabase client.</p>
    </div>
  );
}
