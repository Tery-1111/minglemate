import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function QuestionEfficiency() {
  const [data, setData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      // Pointing to the new, safe view
      const { data } = await supabase.from('question_performance_metrics').select('*');
      setData(data || []);
    };
    fetchData();
  }, []);

  return (
    // ... rest of your UI code
  );
}
