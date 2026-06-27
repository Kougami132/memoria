import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import * as api from '@/api'
import type { SettingsUpdate } from '@/api'

export default function Settings() {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const [form, setForm] = useState<Partial<Record<string, string>>>({})
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (settings) setForm({ ...settings }) }, [settings])

  const update = useMutation({
    mutationFn: () => {
      const payload: SettingsUpdate = {
        openai_base_url: form.openai_base_url,
        embedding_model: form.embedding_model,
        llm_model: form.llm_model,
        top_k: form.top_k ? Number(form.top_k) : undefined,
        chunk_size: form.chunk_size ? Number(form.chunk_size) : undefined,
        chunk_overlap: form.chunk_overlap ? Number(form.chunk_overlap) : undefined,
      }
      // Only send api_key if user has changed it from the loaded value
      if (form.openai_api_key !== settings?.openai_api_key) {
        payload.api_key = form.openai_api_key
      }
      return api.updateSettings(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const field = (key: string, label: string, type = 'text') => (
    <div className="space-y-1">
      <Label htmlFor={key}>{label}</Label>
      {key === 'openai_api_key' ? (
        <div className="flex gap-2">
          <Input
            id={key}
            type={showKey ? 'text' : 'password'}
            value={form[key] ?? ''}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          />
          <Button variant="outline" size="sm" onClick={() => setShowKey(v => !v)}>
            {showKey ? 'Hide' : 'Show'}
          </Button>
        </div>
      ) : (
        <Input
          id={key}
          type={type}
          value={form[key] ?? ''}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        />
      )}
    </div>
  )

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">API Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field('openai_base_url', 'OpenAI Base URL')}
          {field('openai_api_key', 'API Key')}
          {field('embedding_model', 'Embedding Model')}
          {field('llm_model', 'LLM Model')}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">RAG Parameters</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field('top_k', 'Top-K', 'number')}
          {field('chunk_size', 'Chunk Size', 'number')}
          {field('chunk_overlap', 'Chunk Overlap', 'number')}
        </CardContent>
      </Card>
      <div className="flex items-center gap-3">
        <Button onClick={() => update.mutate()} disabled={update.isPending}>Save Settings</Button>
        {saved && <span className="text-sm text-green-600">Settings saved. Pipeline rebuilt.</span>}
      </div>
    </div>
  )
}
