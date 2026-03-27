import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppShell from '@/components/layout/AppShell'
import DashboardPage from '@/pages/DashboardPage'
import PlayersPage from '@/pages/PlayersPage'
import PlayerProfilePage from '@/pages/PlayerProfilePage'
import TeamsPage from '@/pages/TeamsPage'
import TeamProfilePage from '@/pages/TeamProfilePage'
import ComparePage from '@/pages/ComparePage'
import RecordsPage from '@/pages/RecordsPage'
import DreamTeamPage from '@/pages/DreamTeamPage'
import NotFoundPage from '@/pages/NotFoundPage'

function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/players/:playerId" element={<PlayerProfilePage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamId" element={<TeamProfilePage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/dream-team" element={<DreamTeamPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}

export default App
