import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import { applySeo, applySiteJsonLd, applyWebAppJsonLd, ROUTE_SEO } from './seo'
import AuthGuard from './components/AuthGuard'
import Landing from './pages/Landing'
import HowItWorks from './pages/HowItWorks'
import Faq from './pages/Faq'
import Signup from './pages/Signup'
import Login from './pages/Login'

// PERF: route-level code splitting. The landing/marketing routes stay
// eager (fast first paint for visitors); the 12 authenticated app
// routes — admin, chat, payments, questionnaire — are only downloaded
// when actually navigated to. All are small, so a single shared
// fallback suffices.
const ProfileSetup = lazy(() => import('./pages/ProfileSetup'))
const PhotoUpload = lazy(() => import('./pages/PhotoUpload'))
const Interests = lazy(() => import('./pages/Interests'))
const Home = lazy(() => import('./pages/Home'))
const Section1 = lazy(() => import('./pages/Section1'))
const Section2 = lazy(() => import('./pages/Section2'))
const Payment = lazy(() => import('./pages/Payment'))
const Profile = lazy(() => import('./pages/Profile'))
const Chat = lazy(() => import('./pages/Chat'))
const Matches = lazy(() => import('./pages/Matches'))
const Admin = lazy(() => import('./pages/Admin'))
const Photos = lazy(() => import('./pages/Photos'))
const Settings = lazy(() => import('./pages/Settings'))
const Blocked = lazy(() => import('./pages/Blocked'))
const Discover = lazy(() => import('./pages/Discover'))
const Messages = lazy(() => import('./pages/Messages'))
const MatchCelebration = lazy(() => import('./pages/MatchCelebration'))
const MatchDetail = lazy(() => import('./pages/MatchDetail'))
const ForceConnect = lazy(() => import('./pages/ForceConnect'))

function RouteFallback() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0a0a0a', color: '#666',
      fontSize: 14
    }}>
      Loading…
    </div>
  )
}// Route-driven SEO: applies on EVERY navigation so private pages get
// their noindex metadata too (public pages additionally call useSeo
// for copy-coupled JSON-LD).
function SeoManager() {
  const { pathname } = useLocation()
  const base = pathname.startsWith('/chat/') ? '/chat' : pathname

  useEffect(() => {
    applySeo(base)
    const indexable = ROUTE_SEO[base]?.index === true
    applySiteJsonLd(indexable)
    applyWebAppJsonLd(indexable)
  }, [base])

  return null
}

function App() {

  return (
    <BrowserRouter>
      <SeoManager />
      <Routes>
        <Route path='/' element={<Landing />} />
        <Route path='/matches-info' element={<HowItWorks />} />
        <Route path='/faq' element={<Faq />} />
        <Route path='/signup' element={<Signup />} />
        <Route path='/login' element={<Login />} />
        <Route path='/profile-setup' element={<AuthGuard><Suspense fallback={<RouteFallback />}><ProfileSetup /></Suspense></AuthGuard>} />
        <Route path='/photo-upload' element={<AuthGuard><Suspense fallback={<RouteFallback />}><PhotoUpload /></Suspense></AuthGuard>} />
        <Route path='/interests' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Interests /></Suspense></AuthGuard>} />
        <Route path='/home' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Home /></Suspense></AuthGuard>} />
        <Route path='/discover' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Discover /></Suspense></AuthGuard>} />
        <Route path='/messages' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Messages /></Suspense></AuthGuard>} />
        <Route path='/celebration' element={<AuthGuard><Suspense fallback={<RouteFallback />}><MatchCelebration /></Suspense></AuthGuard>} />
        <Route path='/match/:userId' element={<AuthGuard><Suspense fallback={<RouteFallback />}><MatchDetail /></Suspense></AuthGuard>} />
        <Route path='/force-connect/:userId' element={<AuthGuard><Suspense fallback={<RouteFallback />}><ForceConnect /></Suspense></AuthGuard>} />
        <Route path='/section1' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Section1 /></Suspense></AuthGuard>} />
        <Route path='/section2' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Section2 /></Suspense></AuthGuard>} />
        <Route path='/payment' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Payment /></Suspense></AuthGuard>} />
        <Route path='/profile' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Profile /></Suspense></AuthGuard>} />
        <Route path='/chat/:matchId' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Chat /></Suspense></AuthGuard>} />
        <Route path='/matches' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Matches /></Suspense></AuthGuard>} />
        <Route path='/admin' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Admin /></Suspense></AuthGuard>} />
        <Route path='/photos' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Photos /></Suspense></AuthGuard>} />
        <Route path='/settings' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Settings /></Suspense></AuthGuard>} />
        <Route path='/blocked' element={<AuthGuard><Suspense fallback={<RouteFallback />}><Blocked /></Suspense></AuthGuard>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App