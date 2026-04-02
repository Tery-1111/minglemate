import { BrowserRouter, Routes, Route } from 'react-router-dom'
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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Landing />} />
        <Route path='/signup' element={<Signup />} />
        <Route path='/login' element={<Login />} />
        <Route path='/profile-setup' element={<ProfileSetup />} />
        <Route path='/photo-upload' element={<PhotoUpload />} />
        <Route path='/interests' element={<Interests />} />
        <Route path='/home' element={<Home />} />
        <Route path='/section1' element={<Section1 />} />
        <Route path='/section2' element={<Section2 />} />
        <Route path='/payment' element={<Payment />} />
        <Route path='/profile' element={<Profile />} />
        <Route path='/chat/:matchId' element={<Chat />} />
        <Route path='/matches' element={<Matches />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App