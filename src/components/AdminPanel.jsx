import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AdminPanel() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  
  const MASTER_PASSWORD = 'Teryl#1103';

  const handleLogin = () => {
    console.log("Input provided:", input);
    console.log("Expected:", MASTER_PASSWORD);
    
    if (input === MASTER_PASSWORD) {
        navigate('/admindashboard');
    } else {
        alert('Incorrect Password. Check the console (F12) for details.');
    }
  };

  return (
    <div style={{ padding: '50px', color: 'white', textAlign: 'center' }}>
      <h1>Admin Panel</h1>
      <input type="password" placeholder="Enter Password" onChange={(e) => setInput(e.target.value)} />
      <button onClick={handleLogin}>Login</button>
    </div>
  );
}
