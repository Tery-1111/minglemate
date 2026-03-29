import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Signup from './pages/Signup'
import ProfileSetup from './pages/ProfileSetup'
import PhotoUpload from './pages/PhotoUpload'
import Interests from './pages/Interests'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/profile-setup" element={<ProfileSetup />} />
        <Route path="/photo-upload" element={<PhotoUpload />} />
        <Route path="/interests" element={<Interests />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
