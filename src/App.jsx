import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Signup from './pages/Signup'
import ProfileSetup from './pages/ProfileSetup'
import PhotoUpload from './pages/PhotoUpload'
import Interests from './pages/Interests'
import Home from './pages/Home'
import Section1 from './pages/Section1'
import Section2 from './pages/Section2'
import Payment from './pages/Payment'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Landing />} />
        <Route path='/signup' element={<Signup />} />
        <Route path='/profile-setup' element={<ProfileSetup />} />
        <Route path='/photo-upload' element={<PhotoUpload />} />
        <Route path='/interests' element={<Interests />} />
        <Route path='/home' element={<Home />} />
        <Route path='/section1' element={<Section1 />} />
        <Route path='/section2' element={<Section2 />} />
        <Route path='/payment' element={<Payment />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App