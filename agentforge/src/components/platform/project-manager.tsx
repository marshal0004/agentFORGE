'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAgentStore } from '../../../stores/agent-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Plus,
  Trash2,
  FolderOpen,
  Loader2,
  Clock,
  FileCode2,
  Play,
} from 'lucide-react'

interface Project {
  id: string
  name: string
  description: string
  prompt: string
  status: string
  files: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

const statusColors: Record<string, string> = {
  draft: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  building: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  generated: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

function getFileCount(filesStr: string): number {
  try {
    const parsed = JSON.parse(filesStr)
    return Array.isArray(parsed) ? parsed.filter((f: {path: string}) => f.path !== '__preview.html').length : 0
  } catch {
    return 0
  }
}

interface ProjectCardProps {
  project: Project
  isActive: boolean
  onSelect: (project: Project) => void
  onDelete: (id: string) => void
  onContinue: (project: Project) => void
}

function ProjectCard({ project, isActive, onSelect, onDelete, onContinue }: ProjectCardProps) {
  const fileCount = getFileCount(project.files)
  const statusColor = statusColors[project.status] || statusColors.draft

  return (
    <Card
      className={`cursor-pointer transition-all hover:border-border hover:shadow-sm ${
        isActive ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20' : 'border-border/50 bg-card/50'
      }`}
      onClick={() => onSelect(project)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{project.name}</h3>
              <Badge variant="outline" className={`shrink-0 text-[10px] ${statusColor}`}>
                {project.status}
              </Badge>
            </div>
            {project.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {project.description}
              </p>
            )}
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={(e) => e.stopPropagation()}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Project</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &quot;{project.name}&quot;? This
                  action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(project.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <FileCode2 className="h-3 w-3" />
            {fileCount} file{fileCount !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatDate(project.updatedAt)}
          </span>
          {project.status === 'generated' && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-6 gap-1 text-[10px]"
              onClick={(e) => {
                e.stopPropagation()
                onContinue(project)
              }}
            >
              <Play className="h-3 w-3" />
              Continue
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function ProjectManager() {
  const { currentProject, setProject, setProjectFiles, setActiveFile, setPreviewHtml, addTerminalLine, reset } = useAgentStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newPrompt, setNewPrompt] = useState('')

  // Initial project list load.
  // setState calls happen AFTER `await` (async), not synchronously in the
  // effect body, so this does not violate react-hooks/set-state-in-effect.
  // `cancelled` guard prevents setState after unmount.
  useEffect(() => {
    let cancelled = false

    async function fetchProjects() {
      try {
        const response = await fetch('/api/projects')
        if (response.ok) {
          const data = await response.json()
          if (!cancelled) {
            setProjects(data.projects || [])
          }
        }
      } catch (error) {
        console.error('Failed to load projects:', error)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchProjects()

    return () => {
      cancelled = true
    }
  }, [])

  const handleCreateProject = useCallback(async () => {
    if (!newName.trim()) return

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          description: newDescription,
          prompt: newPrompt,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setProjects((prev) => [data.project, ...prev])
        setProject(data.project.id, data.project.name)
        setNewName('')
        setNewDescription('')
        setNewPrompt('')
        setIsNewDialogOpen(false)
        addTerminalLine(`info Project "${data.project.name}" created`)
      }
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }, [newName, newDescription, newPrompt, setProject, addTerminalLine])

  const handleSelectProject = useCallback(
    async (project: Project) => {
      // Guard: Don't re-load the same project (prevents repeated "Loaded project" logs)
      if (currentProject === project.id) return

      setProject(project.id, project.name)
      addTerminalLine(`info Loaded project "${project.name}"`)

      // Load project files from DB
      try {
        const files = JSON.parse(project.files || '[]')
        if (Array.isArray(files) && files.length > 0) {
          setProjectFiles(files)
          // Load preview HTML if it exists
          const previewFile = files.find((f: { path: string; content: string }) => f.path === '__preview.html')
          if (previewFile) {
            setPreviewHtml(previewFile.content)
          }
          // Set first non-preview file as active
          const firstReal = files.find((f: { path: string }) => f.path !== '__preview.html')
          if (firstReal) {
            setActiveFile(firstReal.path)
          }
        }
      } catch {
        // Files not parseable, continue
      }
    },
    [currentProject, setProject, setProjectFiles, setActiveFile, setPreviewHtml, addTerminalLine]
  )

  const handleContinueProject = useCallback(
    (project: Project) => {
      handleSelectProject(project)
      // Navigate to agent view by dispatching a custom event
      window.dispatchEvent(new CustomEvent('navigate', { detail: 'agent' }))
    },
    [handleSelectProject]
  )

  const handleDeleteProject = useCallback(
    async (id: string) => {
      try {
        const response = await fetch('/api/projects', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })

        if (response.ok) {
          setProjects((prev) => prev.filter((p) => p.id !== id))
          if (currentProject === id) {
            setProject(null)
            reset()
          }
          addTerminalLine(`info Project deleted`)
        }
      } catch (error) {
        console.error('Failed to delete project:', error)
      }
    },
    [currentProject, setProject, reset, addTerminalLine]
  )

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Projects</h2>
          <p className="text-xs text-muted-foreground">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Dialog open={isNewDialogOpen} onOpenChange={setIsNewDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input
                  placeholder="My App"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Input
                  placeholder="A brief description..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Initial Prompt</label>
                <Textarea
                  placeholder="Describe what you want to build..."
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  rows={3}
                />
              </div>
              <Button
                onClick={handleCreateProject}
                disabled={!newName.trim()}
                className="w-full"
              >
                Create Project
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Project List */}
      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
              <FolderOpen className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                No projects yet
              </p>
              <p className="text-xs text-muted-foreground/60">
                Create your first project or start chatting to auto-create one
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                isActive={currentProject === project.id}
                onSelect={handleSelectProject}
                onDelete={handleDeleteProject}
                onContinue={handleContinueProject}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}