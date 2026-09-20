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
        <nav className="landing-nav">
          <Link to="/matches-info">How matching works</Link>
          <Link to="/faq">FAQ</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </nav>
      </div>
    </div>
  )
}
