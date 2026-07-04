import { supabase } from '../supabaseClient';

export default function ReportButton({ reportedUserId, reporterId }) {
  const handleReport = async () => {
    const reason = prompt("Why are you reporting this user?");
    if (!reason) return;

    const { error } = await supabase
      .from('reports')
      .insert([{ 
        reporter_id: reporterId, 
        reported_user_id: reportedUserId, 
        reason: reason,
        status: 'pending' 
      }]);

    if (error) alert("Error submitting report.");
    else alert("Report submitted. We will review this.");
  };

  return (
    <button onClick={handleReport} style={{ color: 'red', border: '1px solid red' }}>
      Report User
    </button>
  );
}
