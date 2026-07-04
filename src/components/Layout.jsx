import { Outlet, Link } from 'react-router-dom';

export default function Layout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#121212', color: 'white' }}>
      {/* Sidebar Navigation */}
      <nav style={{ width: '250px', borderRight: '1px solid #333', padding: '20px' }}>
        <h2>MingleMate</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li><Link to="/dashboard" style={{ color: 'cyan' }}>Dashboard</Link></li>
          <li><Link to="/chat" style={{ color: 'cyan' }}>Chat</Link></li>
          <li><Link to="/profile" style={{ color: 'cyan' }}>Profile</Link></li>
        </ul>
        <h3 style={{ marginTop: '40px' }}>Admin Panel</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li><Link to="/admin" style={{ color: '#ff4444' }}>Admin Dashboard</Link></li>
          <li><Link to="/moderation" style={{ color: '#ff4444' }}>Moderation</Link></li>
          <li><Link to="/metrics" style={{ color: '#ff4444' }}>Metrics</Link></li>
        </ul>
      </nav>
      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '20px' }}>
        <Outlet />
      </main>
    </div>
  );
}
