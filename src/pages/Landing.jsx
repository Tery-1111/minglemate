import { useNavigate, Link } from 'react-router-dom'
import './Landing.css'

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="landing-container">
      <div className="landing-content">
        <h1 className="landing-title">MingleMate</h1>
        <div className="landing-buttons">
          <button className="btn-primary" onClick={() => navigate('/signup')}>
            Sign Up
          </button>
          <button className="btn-secondary" onClick={() => navigate('/login')}>
            Log In
          </button>
        </div>
        <nav
          style={{
            marginTop: 48,
            display: 'flex',
            gap: 24,
            justifyContent: 'center',
            fontSize: 14,
          }}
        >
          <Link to="/matches-info" style={{ color: '#b9b3c6', textDecoration: 'none' }}>
            How matching works
          </Link>
          <Link to="/faq" style={{ color: '#b9b3c6', textDecoration: 'none' }}>
            FAQ
          </Link>
          <Link to="/terms" style={{ color: '#b9b3c6', textDecoration: 'none' }}>
            Terms
          </Link>
        </nav>
      </div>
    </div>
  )
}
