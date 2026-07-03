'use client'

import { useState, useCallback } from 'react'
import { useAgentStore } from '../../../stores/agent-store'
import { Button } from '@/components/ui/button'
import {
  RefreshCw,
  Monitor,
  Smartphone,
  Tablet,
  ExternalLink,
  Code2,
  X,
} from 'lucide-react'

type ViewportSize = 'desktop' | 'tablet' | 'mobile'

const viewportWidths: Record<ViewportSize, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
}

interface PreviewPanelProps {
  /** Callback to close the preview and switch to another tab */
  onClose?: () => void
}

export function PreviewPanel({ onClose }: PreviewPanelProps) {
  const { previewHtml, projectFiles } = useAgentStore()
  const [viewport, setViewport] = useState<ViewportSize>('desktop')
  const [iframeKey, setIframeKey] = useState(0)

  const handleRefresh = useCallback(() => {
    setIframeKey((prev) => prev + 1)
  }, [])

  const handleOpenNewTab = useCallback(() => {
    if (previewHtml) {
      const blob = new Blob([previewHtml], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      // Revoke after a delay to allow the tab to load
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }
  }, [previewHtml])

  // FIX: Close preview and switch back to code tab
  const handleClose = useCallback(() => {
    if (onClose) {
      onClose()
    }
  }, [onClose])

  const hasPreview = !!previewHtml
  const fileCount = projectFiles.filter(f => f.path !== '__preview.html').length

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-400">Preview</span>
          {hasPreview && (
            <span className="text-[10px] text-emerald-400">
              {fileCount} file{fileCount !== 1 ? 's' : ''} built
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Viewport Switcher */}
          <div className="flex items-center gap-0.5 rounded-md bg-zinc-800/50 p-0.5">
            {([
              { size: 'desktop' as ViewportSize, icon: Monitor },
              { size: 'tablet' as ViewportSize, icon: Tablet },
              { size: 'mobile' as ViewportSize, icon: Smartphone },
            ]).map(({ size, icon: Icon }) => (
              <button
                key={size}
                onClick={() => setViewport(size)}
                className={`rounded p-1 transition-colors ${
                  viewport === size
                    ? 'bg-zinc-700 text-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>

          <div className="mx-1 h-4 w-px bg-zinc-800" />

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-300"
            onClick={handleRefresh}
            disabled={!hasPreview}
            title="Refresh preview"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-300"
            onClick={handleOpenNewTab}
            disabled={!hasPreview}
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>

          {/* FIX: Close Preview button */}
          <div className="mx-1 h-4 w-px bg-zinc-800" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-red-400"
            onClick={handleClose}
            title="Close preview (switch to code)"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex flex-1 items-center justify-center overflow-hidden bg-zinc-900/30 p-4">
        {hasPreview ? (
          <div
            className="h-full overflow-hidden rounded-lg border border-zinc-700 bg-white shadow-2xl transition-all duration-300"
            style={{
              width: viewportWidths[viewport],
              maxWidth: '100%',
            }}
          >
            <iframe
              key={iframeKey}
              srcDoc={previewHtml}
              className="h-full w-full border-0"
              title="App Preview"
              sandbox="allow-scripts allow-forms allow-popups allow-modals"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-zinc-800/50">
              <Code2 className="h-10 w-10 text-zinc-600" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-medium text-zinc-400">
                Live Preview
              </h3>
              <p className="max-w-xs text-xs text-zinc-600">
                Send a prompt to the agent. When it builds your app, a live interactive preview will appear here.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
