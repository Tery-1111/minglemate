import { HashRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import Home from './pages/Home';
import Matches from './pages/Matches';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Profile from './pages/Profile';
import Landing from './pages/Landing';
import ProfileSetup from './pages/ProfileSetup';
import PhotoUpload from './pages/PhotoUpload';
import Section1 from './pages/Section1';
import Section2Quiz from './pages/Section2Quiz';
import Section2Comparison from './pages/Section2Comparison';
import Payment from './pages/Payment';
import Chat from './pages/Chat';
import Interests from './pages/Interests';
import Admin from './pages/Admin';
import AdminDashboard from './pages/AdminDashboard';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Photos from './pages/Photos';
import MatchProfile from './pages/MatchProfile';

export default function App() {
  return (
    <HashRouter>
      <ErrorBoundary>
        <div className="app-container">
          <Routes>
            <Route path='/' element={<Landing />} />
            <Route path='/home' element={<Home />} />
            <Route path='/login' element={<Login />} />
            <Route path='/signup' element={<Signup />} />
            <Route path='/profile' element={<Profile />} />
            <Route path='/matches' element={<Matches />} />
            <Route path='/profile-setup' element={<ProfileSetup />} />
            <Route path='/photo-upload' element={<PhotoUpload />} />
            <Route path='/photos' element={<Photos />} />
            <Route path='/section1' element={<Section1 />} />
            <Route path='/section2-quiz' element={<Section2Quiz />} />
            <Route path='/section2-comparison/:matchId' element={<Section2Comparison />} />
            <Route path='/payment' element={<Payment />} />
            <Route path='/chat' element={<Chat />} />
            <Route path='/interests' element={<Interests />} />
            <Route path='/onboarding' element={<Onboarding />} />
            <Route path='/dashboard' element={<Dashboard />} />
            <Route path='/admin' element={<Admin />} />
            <Route path='/admin-dashboard' element={<AdminDashboard />} />
            <Route path='/match-profile/:userId' element={<MatchProfile />} />
          </Routes>
        </div>
      </ErrorBoundary>
    </HashRouter>
  );
}