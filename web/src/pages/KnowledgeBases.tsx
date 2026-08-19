import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, ChevronDown, ChevronRight, FileText, Trash2, Upload, Database, FolderOpen, RefreshCw, Unlink, Pencil, Check, X } from 'lucide-react'
import * as api from '@/api'


interface PathPickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function LocalPathPicker({ value, onChange, placeholder = '/path/to/vault' }: PathPickerProps) {
  const [open, setOpen] = useState(false)
  const [browseResult, setBrowseResult] = useState<api.VaultPathBrowseResult | null>(null)
  const [error, setError] = useState('')

  const browse = useMutation({
    mutationFn: (path?: string) => api.browseLocalVaultPath(path),
    onSuccess: (data) => {
      setBrowseResult(data)
      setError('')
    },
    onError: (e) => {
      setBrowseResult(null)
      setError(e instanceof Error ? e.message : '浏览本地路径失败')
    },
  })

  const load = (path?: string) => browse.mutate(path)

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Input placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} className="h-7 text-sm" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs shrink-0"
          onClick={() => {
            setOpen(v => !v)
            if (!open) load(value.trim() || undefined)
          }}
        >
          <FolderOpen className="h-3 w-3" />
          浏览
        </Button>
      </div>
      {open && (
        <div className="rounded-md border bg-background p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-mono text-muted-foreground">{browseResult?.path || '选择本地文件夹'}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs shrink-0"
              disabled={!browseResult}
              onClick={() => browseResult && onChange(browseResult.path)}
            >
              使用此路径
            </Button>
          </div>
          {browseResult?.parent && (
            <Button type="button" variant="ghost" size="sm" className="h-6 w-full justify-start text-xs" onClick={() => load(browseResult.parent || undefined)}>
              ../
            </Button>
          )}
          <div className="max-h-36 overflow-auto space-y-1">
            {browse.isPending ? (
              <p className="py-3 text-center text-xs text-muted-foreground">加载中…</p>
            ) : browseResult && browseResult.entries.length > 0 ? (
              browseResult.entries.map(entry => (
                <button
                  key={entry.path}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                  onClick={() => load(entry.path)}
                >
                  <FolderOpen className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))
            ) : (
              <p className="py-3 text-center text-xs text-muted-foreground">没有可进入的子文件夹</p>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}

interface WebDAVPathPickerProps extends PathPickerProps {
  webdavUrl: string
  webdavUser: string
  webdavPass: string
}

function WebDAVPathPicker({ value, onChange, webdavUrl, webdavUser, webdavPass }: WebDAVPathPickerProps) {
  const [open, setOpen] = useState(false)
  const [browseResult, setBrowseResult] = useState<api.VaultPathBrowseResult | null>(null)
  const [error, setError] = useState('')

  const browse = useMutation({
    mutationFn: (path?: string) => api.browseWebDAVVaultPath({
      webdav_url: webdavUrl.trim(),
      webdav_username: webdavUser.trim(),
      webdav_password: webdavPass,
      path: path || '/',
    }),
    onSuccess: (data) => {
      setBrowseResult(data)
      setError('')
    },
    onError: (e) => {
      setBrowseResult(null)
      setError(e instanceof Error ? e.message : '浏览 WebDAV 路径失败')
    },
  })

  const load = (path?: string) => {
    if (!webdavUrl.trim()) {
      setBrowseResult(null)
      setError('请先填写 WebDAV 地址')
      return
    }
    browse.mutate(path)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Input placeholder="远程路径，如 / 或 /Documents/Notes" value={value} onChange={e => onChange(e.target.value)} className="h-7 text-sm" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs shrink-0"
          onClick={() => {
            setOpen(v => !v)
            if (!open) load(value.trim() || '/')
          }}
        >
          <FolderOpen className="h-3 w-3" />
          浏览
        </Button>
      </div>
      {open && (
        <div className="rounded-md border bg-background p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-mono text-muted-foreground">{browseResult?.path || '选择 WebDAV 远程路径'}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs shrink-0"
              disabled={!browseResult}
              onClick={() => browseResult && onChange(browseResult.path)}
            >
              使用此路径
            </Button>
          </div>
          {browseResult?.parent && (
            <Button type="button" variant="ghost" size="sm" className="h-6 w-full justify-start text-xs" onClick={() => load(browseResult.parent || '/')}>../</Button>
          )}
          <div className="max-h-36 overflow-auto space-y-1">
            {browse.isPending ? (
              <p className="py-3 text-center text-xs text-muted-foreground">加载中…</p>
            ) : browseResult && browseResult.entries.length > 0 ? (
              browseResult.entries.map(entry => (
                <button
                  key={entry.path}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                  onClick={() => load(entry.path)}
                >
                  <FolderOpen className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))
            ) : (
              <p className="py-3 text-center text-xs text-muted-foreground">没有可进入的子文件夹</p>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}

function WebDAVTestButton({ webdavUrl, webdavPath, webdavUser, webdavPass }: {
  webdavUrl: string
  webdavPath: string
  webdavUser: string
  webdavPass: string
}) {
  const [message, setMessage] = useState('')
  const test = useMutation({
    mutationFn: () => api.testWebDAVVault({
      webdav_url: webdavUrl.trim(),
      webdav_path: webdavPath.trim() || '/',
      webdav_username: webdavUser.trim(),
      webdav_password: webdavPass,
    }),
    onSuccess: (data) => setMessage(`连接成功，当前路径发现 ${data.file_count} 个可同步文件`),
    onError: (e) => setMessage(e instanceof Error ? e.message : 'WebDAV 测试失败'),
  })

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        disabled={test.isPending || !webdavUrl.trim()}
        onClick={() => test.mutate()}
      >
        {test.isPending ? '测试中…' : '测试连接'}
      </Button>
      {message && <span className={`text-xs ${message.startsWith('连接成功') ? 'text-green-600' : 'text-destructive'}`}>{message}</span>}
    </div>
  )
}

function VaultPanel({ kbId }: { kbId: string }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [vaultType, setVaultType] = useState<'local' | 'webdav'>('local')
  const [localPath, setLocalPath] = useState('')
  const [webdavUrl, setWebdavUrl] = useState('')
  const [webdavPath, setWebdavPath] = useState('/')
  const [webdavUser, setWebdavUser] = useState('')
  const [webdavPass, setWebdavPass] = useState('')

  const { data: vault, isLoading, refetch: refetchVault } = useQuery({
    queryKey: ['vault', kbId],
    queryFn: () => api.getVault(kbId).catch(() => null),
    refetchInterval: (query) => (query.state.data?.syncing ? 2000 : 5000),
  })

  const { data: docs = [] } = useQuery({
    queryKey: ['docs', kbId],
    queryFn: () => api.listDocs(kbId),
  })
  const vaultDocCount = docs.filter(d => d.source === 'vault').length

  const bindVault = useMutation({
    mutationFn: () => api.createVault(kbId, vaultType === 'local'
      ? { type: 'local', local_path: localPath.trim() }
      : { type: 'webdav', webdav_url: webdavUrl.trim(), webdav_path: webdavPath.trim() || '/', webdav_username: webdavUser.trim(), webdav_password: webdavPass }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault', kbId] })
      qc.invalidateQueries({ queryKey: ['docs', kbId] })
      setShowForm(false)
      setLocalPath(''); setWebdavUrl(''); setWebdavPath('/'); setWebdavUser(''); setWebdavPass('')
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault', kbId] })
      qc.invalidateQueries({ queryKey: ['docs', kbId] })
    },
  })

  const cancelSync = useMutation({
    mutationFn: () => api.cancelVaultSync(kbId),
    onError: () => alert('停止同步失败，请重试'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vault', kbId] }),
  })

  const toggleAutoSync = useMutation({
    mutationFn: (v: boolean) => api.updateVault(kbId, { auto_sync: v }),
    onError: () => alert('更新自动同步设置失败，请重试'),
    onSuccess: () => refetchVault(),
  })

  if (isLoading) return null

  if (!vault) {
    return (
      <div className="mb-4">
        {!showForm ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5 text-xs h-8 border-dashed text-muted-foreground"
            onClick={() => setShowForm(true)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            连接仓库
          </Button>
        ) : (
          <div className="rounded-lg border p-3 space-y-2.5">
            <div className="flex gap-1.5">
              <Button size="sm" variant={vaultType === 'local' ? 'default' : 'outline'} className="h-6 text-xs" onClick={() => setVaultType('local')}>本地文件夹</Button>
              <Button size="sm" variant={vaultType === 'webdav' ? 'default' : 'outline'} className="h-6 text-xs" onClick={() => setVaultType('webdav')}>WebDAV</Button>
            </div>
            {vaultType === 'local' ? (
              <LocalPathPicker value={localPath} onChange={setLocalPath} />
            ) : (
              <>
                <Input placeholder="https://dav.example.com" value={webdavUrl} onChange={e => setWebdavUrl(e.target.value)} className="h-7 text-sm" />
                <WebDAVPathPicker value={webdavPath} onChange={setWebdavPath} webdavUrl={webdavUrl} webdavUser={webdavUser} webdavPass={webdavPass} />
                <Input placeholder="用户名" value={webdavUser} onChange={e => setWebdavUser(e.target.value)} className="h-7 text-sm" />
                <Input placeholder="密码" type="password" value={webdavPass} onChange={e => setWebdavPass(e.target.value)} className="h-7 text-sm" />
                <WebDAVTestButton webdavUrl={webdavUrl} webdavPath={webdavPath} webdavUser={webdavUser} webdavPass={webdavPass} />
              </>
            )}
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={bindVault.isPending || (vaultType === 'local' ? !localPath.trim() : !webdavUrl.trim())}
                onClick={() => bindVault.mutate()}
              >
                {bindVault.isPending ? '连接中…' : '连接'}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowForm(false)}>取消</Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const isSyncing = vault.syncing || syncVault.isPending
  return (
    <div className="mb-4 rounded-xl border border-border/80 bg-muted/40 px-4 py-3 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
          <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground font-medium">仓库</span>
              <Badge variant="outline" className="text-xs py-0 h-4 text-muted-foreground border-border">{vault.type}</Badge>
              <span className="text-xs text-muted-foreground">{vaultDocCount} 个文档</span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {vault.type === 'local' ? vault.local_path : `${vault.webdav_url}${vault.webdav_path || '/'}`}
            </p>
            {vault.last_synced_at && (
              <p className="text-xs text-muted-foreground mt-0.5">
                上次同步: {new Date(vault.last_synced_at).toLocaleString()}
              </p>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span>自动同步</span>
              <button
                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${vault.auto_sync ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                onClick={() => toggleAutoSync.mutate(!vault.auto_sync)}
              >
                <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${vault.auto_sync ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant={isSyncing ? 'destructive' : 'outline'}
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={cancelSync.isPending || syncVault.isPending}
            onClick={() => isSyncing ? cancelSync.mutate() : syncVault.mutate()}
          >
            <RefreshCw className={`h-3 w-3 ${isSyncing && !cancelSync.isPending ? 'animate-spin' : ''}`} />
            {isSyncing ? '停止同步' : '立即同步'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (confirm('断开连接将删除所有 vault 来源文档，确认？')) unbindVault.mutate()
            }}
          >
            <Unlink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function DocList({ kb }: { kb: api.KB }) {
  const qc = useQueryClient()
  const { data: docs = [] } = useQuery({ queryKey: ['docs', kb.id], queryFn: () => api.listDocs(kb.id) })
  const delDoc = useMutation({
    mutationFn: api.deleteDocument,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs', kb.id] }),
  })
  const upload = useMutation({
    mutationFn: ({ file }: { file: File }) => api.uploadDocument(kb.id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs', kb.id] }),
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">文档列表</p>
        {kb.type === 'upload' && (
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
        )}
      </div>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {kb.type === 'vault' ? '仓库同步后文档将显示在此处' : '暂无文档，请上传 .md 或 .txt 文件'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/60 min-w-0 overflow-hidden">
              <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1 overflow-hidden">
                  <span className="text-sm font-medium text-foreground truncate block" title={doc.filename}>{doc.filename}</span>
                  {doc.source === 'vault' && doc.path && (
                    <div className="text-xs text-muted-foreground/70 font-mono truncate block" title={doc.path}>{doc.path}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <Badge variant="secondary" className="text-xs font-normal">{doc.chunk_count} 块</Badge>
                {kb.type === 'upload' && (
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
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  // create form state
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [kbType, setKbType] = useState<'upload' | 'vault'>('upload')
  const [vaultType, setVaultType] = useState<'local' | 'webdav'>('local')
  const [localPath, setLocalPath] = useState('')
  const [webdavUrl, setWebdavUrl] = useState('')
  const [webdavPath, setWebdavPath] = useState('/')
  const [webdavUser, setWebdavUser] = useState('')
  const [webdavPass, setWebdavPass] = useState('')

  const resetForm = () => {
    setName(''); setDesc(''); setKbType('upload'); setVaultType('local')
    setLocalPath(''); setWebdavUrl(''); setWebdavPath('/'); setWebdavUser(''); setWebdavPass('')
    setShowForm(false)
  }

  const createKB = useMutation({
    mutationFn: () => api.createKB(kbType === 'upload'
      ? { name: name.trim(), description: desc.trim(), type: 'upload' }
      : {
          name: name.trim(), description: desc.trim(), type: 'vault',
          vault_type: vaultType,
          local_path: vaultType === 'local' ? localPath.trim() : undefined,
          webdav_url: vaultType === 'webdav' ? webdavUrl.trim() : undefined,
          webdav_path: vaultType === 'webdav' ? webdavPath.trim() || '/' : undefined,
          webdav_username: vaultType === 'webdav' ? webdavUser.trim() : undefined,
          webdav_password: vaultType === 'webdav' ? webdavPass : undefined,
        }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kbs'] })
      resetForm()
    },
  })

  const deleteKB = useMutation({
    mutationFn: api.deleteKB,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kbs'] }),
  })

  const updateKB = useMutation({
    mutationFn: ({ id, name, description }: { id: string; name: string; description: string }) =>
      api.updateKB(id, { name, description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kbs'] })
      setEditingId(null)
    },
  })

  const startEdit = (kb: api.KB) => {
    setEditingId(kb.id)
    setEditName(kb.name)
    setEditDesc(kb.description)
  }

  const canSubmit = name.trim() && (
    kbType === 'upload' ||
    (vaultType === 'local' ? !!localPath.trim() : !!webdavUrl.trim())
  )

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="p-8 w-[860px] max-w-full mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">知识库</h1>
          <p className="text-sm text-muted-foreground mt-1">管理文档集合，为机器人提供知识来源</p>
        </div>
        <Button variant="default" onClick={() => setShowForm(v => !v)} className="gap-2 shrink-0">
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
            />
            <Input
              placeholder="描述（可选）"
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />
            <div className="flex gap-1.5">
              <Button size="sm" variant={kbType === 'upload' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setKbType('upload')}>上传型</Button>
              <Button size="sm" variant={kbType === 'vault' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setKbType('vault')}>仓库型</Button>
            </div>
            {kbType === 'vault' && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex gap-1.5">
                  <Button size="sm" variant={vaultType === 'local' ? 'default' : 'outline'} className="h-6 text-xs" onClick={() => setVaultType('local')}>本地文件夹</Button>
                  <Button size="sm" variant={vaultType === 'webdav' ? 'default' : 'outline'} className="h-6 text-xs" onClick={() => setVaultType('webdav')}>WebDAV</Button>
                </div>
                {vaultType === 'local' ? (
                  <LocalPathPicker value={localPath} onChange={setLocalPath} />
                ) : (
                  <>
                    <Input placeholder="https://dav.example.com" value={webdavUrl} onChange={e => setWebdavUrl(e.target.value)} className="h-7 text-sm" />
                    <WebDAVPathPicker value={webdavPath} onChange={setWebdavPath} webdavUrl={webdavUrl} webdavUser={webdavUser} webdavPass={webdavPass} />
                    <Input placeholder="用户名" value={webdavUser} onChange={e => setWebdavUser(e.target.value)} className="h-7 text-sm" />
                    <Input placeholder="密码" type="password" value={webdavPass} onChange={e => setWebdavPass(e.target.value)} className="h-7 text-sm" />
                    <WebDAVTestButton webdavUrl={webdavUrl} webdavPath={webdavPath} webdavUser={webdavUser} webdavPass={webdavPass} />
                  </>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => createKB.mutate()} disabled={!canSubmit || createKB.isPending}>
                {createKB.isPending ? '创建中…' : '创建'}
              </Button>
              <Button variant="outline" onClick={resetForm}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {kbs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="bg-gradient-to-br bg-muted rounded-2xl p-5 mb-4 inline-block">
            <Database className="h-10 w-10 text-muted-foreground" />
          </div>
          <p className="font-medium">暂无知识库</p>
          <p className="text-sm text-muted-foreground mt-1">点击右上角「新建知识库」开始</p>
        </div>
      ) : (
        <div className="space-y-3">
          {kbs.map(kb => (
            <Card key={kb.id} className="overflow-hidden rounded-2xl border-border/80 min-w-0">
              <CardHeader className="py-3 px-4">
                <div className="flex items-center justify-between gap-2">
                  {editingId === kb.id ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="flex-1 space-y-1.5 min-w-0">
                        <Input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          className="h-7 text-sm"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter' && editName.trim()) updateKB.mutate({ id: kb.id, name: editName.trim(), description: editDesc })
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                        />
                        <Input
                          value={editDesc}
                          onChange={e => setEditDesc(e.target.value)}
                          placeholder="描述（可选）"
                          className="h-7 text-xs"
                          onKeyDown={e => {
                            if (e.key === 'Enter' && editName.trim()) updateKB.mutate({ id: kb.id, name: editName.trim(), description: editDesc })
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-green-600"
                          disabled={!editName.trim() || updateKB.isPending}
                          onClick={() => updateKB.mutate({ id: kb.id, name: editName.trim(), description: editDesc })}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-2 text-left min-w-0 hover:text-primary transition-colors"
                      onClick={() => toggle(kb.id)}
                    >
                      {expanded.has(kb.id)
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-sm">{kb.name}</span>
                          <Badge variant="outline" className={`text-xs py-0 h-4 ${kb.type === 'vault' ? 'text-muted-foreground border-border' : 'text-muted-foreground border-border'}`}>
                            {kb.type === 'vault' ? '仓库' : '上传'}
                          </Badge>
                        </div>
                        {kb.description && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{kb.description}</p>
                        )}
                      </div>
                    </button>
                  )}
                  {editingId !== kb.id && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => startEdit(kb)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (confirm(`确认删除知识库「${kb.name}」？此操作同时删除所有文档。`)) deleteKB.mutate(kb.id)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              {expanded.has(kb.id) && (
                <CardContent className="border-t border-border/60 bg-muted/15 pt-4 pb-4 px-4 min-w-0 overflow-hidden">
                  {kb.type === 'vault' && <VaultPanel kbId={kb.id} />}
                  <DocList kb={kb} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

