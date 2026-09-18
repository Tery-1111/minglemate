import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AuthGuard from './components/AuthGuard'
import Landing from './pages/Landing'
import Signup from './pages/Signup'
import Login from './pages/Login'
import ProfileSetup from './pages/ProfileSetup'
import PhotoUpload from './pages/PhotoUpload'
import Interests from './pages/Interests'
import Home from './pages/Home'
import Section1 from './pages/Section1'
import Section2 from './pages/Section2'
import Payment from './pages/Payment'
import Profile from './pages/Profile'
import Chat from './pages/Chat'
import Matches from './pages/Matches'
import Admin from './pages/Admin'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Landing />} />
        <Route path='/signup' element={<Signup />} />
        <Route path='/login' element={<Login />} />
        <Route path='/profile-setup' element={<AuthGuard><ProfileSetup /></AuthGuard>} />
        <Route path='/photo-upload' element={<AuthGuard><PhotoUpload /></AuthGuard>} />
        <Route path='/interests' element={<AuthGuard><Interests /></AuthGuard>} />
        <Route path='/home' element={<AuthGuard><Home /></AuthGuard>} />
        <Route path='/section1' element={<AuthGuard><Section1 /></AuthGuard>} />
        <Route path='/section2' element={<AuthGuard><Section2 /></AuthGuard>} />
        <Route path='/payment' element={<AuthGuard><Payment /></AuthGuard>} />
        <Route path='/profile' element={<AuthGuard><Profile /></AuthGuard>} />
        <Route path='/chat/:matchId' element={<AuthGuard><Chat /></AuthGuard>} />
        <Route path='/matches' element={<AuthGuard><Matches /></AuthGuard>} />
        <Route path='/admin' element={<AuthGuard><Admin /></AuthGuard>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App