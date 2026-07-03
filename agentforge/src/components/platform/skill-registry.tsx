'use client'

import { useEffect, useCallback } from 'react'
import { useSkillStore, type Skill } from '../../../stores/skill-store'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Code,
  Palette,
  Brain,
  Wrench,
  Shield,
  CheckCircle,
  Loader2,
  Zap,
} from 'lucide-react'

const categoryIcons: Record<string, React.ElementType> = {
  development: Code,
  design: Palette,
  security: Shield,
  infrastructure: Brain,
  ai: Brain,
  quality: CheckCircle,
  general: Wrench,
}

const categoryColors: Record<string, string> = {
  development: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  design: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  security: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  infrastructure: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  ai: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  quality: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  general: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
}

const priorityColors: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  high: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  normal: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
}

// --- Main Skill Registry ---
export function SkillRegistry() {
  const {
    skills,
    isLoadingSkills,
    setSkills,
    setLoadingSkills,
  } = useSkillStore()

  // Load skills from API on mount
  useEffect(() => {
    const loadSkills = async () => {
      setLoadingSkills(true)
      try {
        const response = await fetch('/api/skills')
        if (response.ok) {
          const data = await response.json()
          const mappedSkills: Skill[] = (data.skills || []).map(
            (s: Record<string, unknown>) => ({
              id: s.id as string,
              name: s.name as string,
              description: s.description as string,
              category: s.category as string,
              version: s.version as string,
              author: s.author as string,
              source: (s.source as string) === 'custom' ? 'custom' : 'built-in',
              config: (s.config as Record<string, unknown>) || {},
              installed: s.installed as boolean,
              enabled: s.enabled as boolean,
            })
          )
          setSkills(mappedSkills)
        }
      } catch (error) {
        console.error('Failed to load skills:', error)
      } finally {
        setLoadingSkills(false)
      }
    }
    loadSkills()
  }, [setSkills, setLoadingSkills])

  const activeCount = skills.filter(s => s.installed && s.enabled).length

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Skill Registry</h2>
            <p className="text-xs text-muted-foreground">
              {activeCount} of {skills.length} active
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              <span className="text-sky-400">All built-in</span>
            </p>
          </div>
        </div>
      </div>

      {/* Skills List */}
      <ScrollArea className="flex-1 p-4">
        {isLoadingSkills ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : skills.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <Zap className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No skills loaded</p>
            <p className="text-xs text-muted-foreground/60">
              Skills are loaded automatically at startup
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => {
              const CategoryIcon = categoryIcons[skill.category] || Code
              const categoryColor = categoryColors[skill.category] || 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
              const priority = (skill.config as Record<string, unknown>)?.priority as string || 'normal'
              const sourceDetail = (skill.config as Record<string, unknown>)?.sourceDetail as string || 'embedded'

              return (
                <div
                  key={skill.id}
                  className="group relative overflow-hidden rounded-lg border border-border/50 bg-card/50 p-3 transition-all hover:border-border hover:bg-card"
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${categoryColor.split(' ')[0]}`}>
                      <CategoryIcon className={`h-4 w-4 ${categoryColor.split(' ')[1]}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="truncate text-sm font-semibold">{skill.name}</h3>
                        <Badge variant="outline" className="shrink-0 border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-400">
                          Active
                        </Badge>
                        <Badge variant="outline" className={`shrink-0 text-[10px] ${priorityColors[priority] || priorityColors.normal}`}>
                          {priority}
                        </Badge>
                        <Badge variant="outline" className="shrink-0 border-sky-500/20 bg-sky-500/10 text-[10px] text-sky-400">
                          {sourceDetail === 'disk' ? 'From Disk' : 'Embedded'}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {skill.description}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
