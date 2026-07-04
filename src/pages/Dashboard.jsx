import { supabase } from '../supabaseClient';
import { useQuery } from '@tanstack/react-query';

export default function Dashboard() {
  // Now using the shared supabase client instead of calling createClient locally
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard_data'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*');
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div style={{ color: 'white' }}>
      <h1>Dashboard</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

