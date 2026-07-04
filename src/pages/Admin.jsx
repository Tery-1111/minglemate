import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Admin() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const MASTER_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

  const handleLogin = () => {
    if (input === MASTER_PASSWORD) {
      navigate('/admin-dashboard');
    } else {
      setError('Incorrect password');
      setInput('');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0a0a0f',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{
        backgroundColor: '#111118',
        border: '1px solid #2a2a3a',
        borderRadius: '16px',
        padding: '48px 40px',
        width: '100%',
        maxWidth: '380px',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: '22px', fontWeight: 700, marginBottom: '4px',
          background: 'linear-gradient(135deg, #7c6aff, #ff6b8a)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          MingleMate
        </div>
        <div style={{ fontSize: '11px', color: '#8888aa', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '36px' }}>
          Command Center
        </div>

        <input
          type="password"
          placeholder="Enter admin password"
          value={input}
          onChange={e => { setInput(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          style={{
            width: '100%',
            padding: '12px 16px',
            backgroundColor: '#1a1a24',
            border: `1px solid ${error ? '#ef4444' : '#2a2a3a'}`,
            borderRadius: '8px',
            color: '#f0f0f8',
            fontSize: '14px',
            outline: 'none',
            boxSizing: 'border-box',
            marginBottom: '8px',
          }}
        />

        {error && (
          <div style={{ fontSize: '12px', color: '#ef4444', marginBottom: '12px' }}>
            {error}
          </div>
        )}

        <button
          onClick={handleLogin}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#7c6aff22',
            border: '1px solid #7c6aff44',
            borderRadius: '8px',
            color: '#7c6aff',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            marginTop: '8px',
          }}
        >
          Enter Command Center
        </button>
      </div>
    </div>
  );
}