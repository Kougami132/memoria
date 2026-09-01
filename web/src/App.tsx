import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import KnowledgeBases from './pages/KnowledgeBases'
import Bots from './pages/Bots'
import Chat from './pages/Chat'
import AgenticChat from './pages/AgenticChat'
import Hosts from './pages/Hosts'
import Settings from './pages/Settings'
import Logs from './pages/Logs'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/knowledge-bases" replace />} />
            <Route path="knowledge-bases" element={<KnowledgeBases />} />
            <Route path="hosts" element={<Hosts />} />
            <Route path="bots" element={<Bots />} />
            <Route path="chat" element={<Chat />} />
            <Route path="agentic-chat" element={<AgenticChat />} />
            <Route path="logs" element={<Logs />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
