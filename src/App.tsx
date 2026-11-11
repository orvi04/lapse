import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Feed from './pages/Feed'
import Promises from './pages/Promises'
import Friends from './pages/Friends'
import You from './pages/You'
import NewPost from './pages/NewPost'

const icons = {
  feed: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="12" r="4"/></svg>,
  promises: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12l4 4 10-10"/></svg>,
  friends: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3 3 0 010 5.5M18 14.5c1.8.7 3 2.5 3 5.5"/></svg>,
  you: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
}

export default function App() {
  const { session, profile, loading } = useAuth()
  if (loading) return <div className="center">Loading…</div>
  if (!session) return <div className="app"><Login /></div>
  if (!profile) return <div className="app"><Onboarding /></div>

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/promises" element={<Promises />} />
        <Route path="/new" element={<NewPost />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/you" element={<You />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>{icons.feed}Feed</NavLink>
        <NavLink to="/promises" className={({ isActive }) => (isActive ? 'active' : '')}>{icons.promises}Promises</NavLink>
        <NavLink to="/new"><span className="plus">+</span></NavLink>
        <NavLink to="/friends" className={({ isActive }) => (isActive ? 'active' : '')}>{icons.friends}Friends</NavLink>
        <NavLink to="/you" className={({ isActive }) => (isActive ? 'active' : '')}>{icons.you}You</NavLink>
      </nav>
    </div>
  )
}
