import { useNavigate } from 'react-router-dom'
import './Landing.css'

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="landing-container">
      <div className="landing-content">
        <h1 className="landing-title">MingleMate</h1>
        <p className="landing-tagline">Weekly matches. Real campus connections.</p>
        <div className="landing-buttons">
          <button 
            className="btn-primary"
            onClick={() => navigate('/signup')}
          >
            Sign Up
          </button>
          <button 
            className="btn-secondary"
            onClick={() => navigate('/login')}
          >
            Log In
          </button>
        </div>
      </div>
    </div>
  )
}
