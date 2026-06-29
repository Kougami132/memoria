import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, ChevronDown, ChevronRight, FileText, Trash2, Upload, Database, FolderOpen, RefreshCw, Unlink, Link } from 'lucide-react'
import * as api from '@/api'

function VaultPanel({ kbId }: { kbId: string }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [vaultType, setVaultType] = useState<'local' | 'webdav'>('local')
  const [localPath, setLocalPath] = useState('')
  const [webdavUrl, setWebdavUrl] = useState('')
  const [webdavUser, setWebdavUser] = useState('')
  const [webdavPass, setWebdavPass] = useState('')

  const { data: vault, isLoading } = useQuery({
    queryKey: ['vault', kbId],
    queryFn: () => api.getVault(kbId).catch(() => null),
  })

  const bindVault = useMutation({
    mutationFn: () => api.createVault(kbId, vaultType === 'local'
      ? { type: 'local', local_path: localPath.trim() }
      : { type: 'webdav', webdav_url: webdavUrl.trim(), webdav_username: webdavUser.trim(), webdav_password: webdavPass }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault', kbId] })
      qc.invalidateQueries({ queryKey: ['docs', kbId] })
      setShowForm(false)
      setLocalPath(''); setWebdavUrl(''); setWebdavUser(''); setWebdavPass('')
    },
  })

  const unbindVault = useMutation({
    mutationFn: () => api.deleteVault(kbId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault', kbId] })
      qc.invalidateQueries({ queryKey: ['docs', kbId] })
    },
  })

  const syncVault = useMutation({
    mutationFn: () => api.syncVault(kbId),
  })

  if (isLoading) return null

  if (vault) {
    return (
      <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/50 dark:border-violet-900/50 dark:bg-violet-950/20 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen className="h-4 w-4 text-violet-500 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-violet-700 dark:text-violet-400">仓库</span>
                <Badge variant="outline" className="text-xs py-0 h-4 text-violet-600 border-violet-300">{vault.type}</Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {vault.type === 'local' ? vault.local_path : vault.webdav_url}
              </p>
              {vault.last_synced_at && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  上次同步: {new Date(vault.last_synced_at).toLocaleString()}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={syncVault.isPending}
              onClick={() => syncVault.mutate()}
            >
              <RefreshCw className={`h-3 w-3 ${syncVault.isPending ? 'animate-spin' : ''}`} />
              {syncVault.isPending ? '同步中…' : '立即同步'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (confirm('解绑仓库将删除所有 vault 来源文档，确认？')) unbindVault.mutate()
              }}
            >
              <Unlink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4">
      {!showForm ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5 text-xs h-8 border-dashed text-muted-foreground"
          onClick={() => setShowForm(true)}
        >
          <Link className="h-3.5 w-3.5" />
          绑定仓库 (本地文件夹 / WebDAV)
        </Button>
      ) : (
        <div className="rounded-lg border p-3 space-y-2.5">
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={vaultType === 'local' ? 'default' : 'outline'}
              className="h-6 text-xs"
              onClick={() => setVaultType('local')}
            >本地文件夹</Button>
            <Button
              size="sm"
              variant={vaultType === 'webdav' ? 'default' : 'outline'}
              className="h-6 text-xs"
              onClick={() => setVaultType('webdav')}
            >WebDAV</Button>
          </div>
          {vaultType === 'local' ? (
            <Input
              placeholder="/path/to/vault"
              value={localPath}
              onChange={e => setLocalPath(e.target.value)}
              className="h-7 text-sm"
            />
          ) : (
            <>
              <Input placeholder="https://dav.example.com" value={webdavUrl} onChange={e => setWebdavUrl(e.target.value)} className="h-7 text-sm" />
              <Input placeholder="用户名" value={webdavUser} onChange={e => setWebdavUser(e.target.value)} className="h-7 text-sm" />
              <Input placeholder="密码" type="password" value={webdavPass} onChange={e => setWebdavPass(e.target.value)} className="h-7 text-sm" />
            </>
          )}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={bindVault.isPending || (vaultType === 'local' ? !localPath.trim() : !webdavUrl.trim())}
              onClick={() => bindVault.mutate()}
            >
              {bindVault.isPending ? '绑定中…' : '绑定'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </div>
      )}
    </div>
  )
}

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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">文档列表</p>
        <label className="cursor-pointer">
          <Button variant="outline" size="sm" asChild className="gap-1.5 text-xs h-7">
            <span>
              <Upload className="h-3 w-3" />
              {upload.isPending ? '上传中…' : '上传文档'}
            </span>
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
      </div>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          暂无文档，请上传 .md 或 .txt 文件
        </p>
      ) : (
        <div className="space-y-1.5">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/60">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-purple-500 shrink-0" />
                <span className="text-sm truncate">{doc.filename}</span>
                {doc.source === 'vault' && (
                  <Badge variant="outline" className="text-xs py-0 h-4 text-violet-600 border-violet-300 shrink-0">vault</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <Badge variant="secondary" className="text-xs font-normal">{doc.chunk_count} 块</Badge>
                {doc.source !== 'vault' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (confirm(`确认删除文档「${doc.filename}」？`)) delDoc.mutate(doc.id)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function KnowledgeBases() {
  const qc = useQueryClient()
  const { data: kbs = [] } = useQuery({ queryKey: ['kbs'], queryFn: api.listKBs })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [showForm, setShowForm] = useState(false)

  const createKB = useMutation({
    mutationFn: () => api.createKB(name.trim(), desc.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kbs'] })
      setName('')
      setDesc('')
      setShowForm(false)
    },
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
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">知识库</h1>
          <p className="text-sm text-muted-foreground mt-1">管理文档集合，为机器人提供知识来源</p>
        </div>
        <Button variant="gradient" onClick={() => setShowForm(v => !v)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          新建知识库
        </Button>
      </div>

      {showForm && (
        <Card className="border-primary/20 shadow-sm">
          <CardContent className="pt-5 space-y-3">
            <Input
              placeholder="知识库名称"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) createKB.mutate() }}
            />
            <Input
              placeholder="描述（可选）"
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                onClick={() => createKB.mutate()}
                disabled={!name.trim() || createKB.isPending}
              >
                {createKB.isPending ? '创建中…' : '创建'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {kbs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-2xl p-5 mb-4 inline-block">
            <Database className="h-10 w-10 text-purple-500" />
          </div>
          <p className="font-medium">暂无知识库</p>
          <p className="text-sm text-muted-foreground mt-1">点击右上角「新建知识库」开始</p>
        </div>
      ) : (
        <div className="space-y-3">
          {kbs.map(kb => (
            <Card key={kb.id} className="overflow-hidden transition-[transform,box-shadow] hover:shadow-md hover:-translate-y-0.5">
              <CardHeader className="py-3 px-4">
                <div className="flex items-center justify-between gap-2">
                  <button
                    className="flex items-center gap-2 text-left min-w-0 hover:text-primary transition-colors"
                    onClick={() => toggle(kb.id)}
                  >
                    {expanded.has(kb.id)
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    }
                    <div className="min-w-0">
                      <span className="font-medium text-sm">{kb.name}</span>
                      {kb.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{kb.description}</p>
                      )}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (confirm(`确认删除知识库「${kb.name}」？此操作同时删除所有文档。`)) deleteKB.mutate(kb.id)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              {expanded.has(kb.id) && (
                <CardContent className="border-t bg-muted/20 pt-4 pb-4">
                  <VaultPanel kbId={kb.id} />
                  <DocList kbId={kb.id} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
