import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import KnowledgeBases from './pages/KnowledgeBases'
import AgenticChat from './pages/AgenticChat'
import Hosts from './pages/Hosts'
import Settings from './pages/Settings'
import Logs from './pages/Logs'
import About from './pages/About'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/agentic-chat" replace />} />
            <Route path="agentic-chat" element={<AgenticChat />} />
            <Route path="agentic-chat/:sessionId" element={<AgenticChat />} />
            <Route path="knowledge-bases" element={<KnowledgeBases />} />
            <Route path="hosts" element={<Hosts />} />
            <Route path="logs" element={<Logs />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/:tab" element={<Settings />} />
            <Route path="about" element={<About />} />
            <Route path="*" element={<Navigate to="/agentic-chat" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
