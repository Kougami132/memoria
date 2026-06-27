import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import * as api from '@/api'

function DocList({ kbId }: { kbId: string }) {
  const qc = useQueryClient()
  const { data: docs = [] } = useQuery({ queryKey: ['docs', kbId], queryFn: () => api.listDocs(kbId) })
  const delDoc = useMutation({
    mutationFn: api.deleteDocument,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs', kbId] }),
  })
  const upload = useMutation({
    mutationFn: ({ file }: { file: File }) => api.uploadDocument(kbId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs', kbId] }),
  })

  return (
    <div className="mt-3 space-y-2">
      <label className="cursor-pointer">
        <Button variant="outline" size="sm" asChild>
          <span>Upload Document (.md / .txt)</span>
        </Button>
        <input
          type="file"
          accept=".md,.txt"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) upload.mutate({ file })
            e.target.value = ''
          }}
        />
      </label>
      {docs.map(doc => (
        <div key={doc.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
          <span>{doc.filename}</span>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{doc.chunk_count} chunks</Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { if (confirm(`Delete document "${doc.filename}"?`)) delDoc.mutate(doc.id) }}
            >Delete</Button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function KnowledgeBases() {
  const qc = useQueryClient()
  const { data: kbs = [] } = useQuery({ queryKey: ['kbs'], queryFn: api.listKBs })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  const createKB = useMutation({
    mutationFn: () => api.createKB(name.trim(), desc.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kbs'] }); setName(''); setDesc('') },
  })
  const deleteKB = useMutation({
    mutationFn: api.deleteKB,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kbs'] }),
  })

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Knowledge Bases</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Create Knowledge Base</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
          <Input placeholder="Description (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
          <Button onClick={() => createKB.mutate()} disabled={!name.trim() || createKB.isPending}>Create</Button>
        </CardContent>
      </Card>
      {kbs.map(kb => (
        <Card key={kb.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <button className="text-left font-medium hover:underline" onClick={() => toggle(kb.id)}>
                {kb.name} {expanded.has(kb.id) ? 'hide' : 'show docs'}
              </button>
              <Button
                variant="ghost" size="sm"
                onClick={() => { if (confirm(`Delete KB "${kb.name}"?`)) deleteKB.mutate(kb.id) }}
              >Delete</Button>
            </div>
            {kb.description && <p className="text-sm text-muted-foreground">{kb.description}</p>}
          </CardHeader>
          {expanded.has(kb.id) && (
            <CardContent><DocList kbId={kb.id} /></CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}
