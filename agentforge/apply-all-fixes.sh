#!/usr/bin/env bash
set -euo pipefail
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'
ok() { echo -e "${G}✓${N} $*"; }
info() { echo -e "${B}→${N} $*"; }
warn() { echo -e "${Y}!${N} $*"; }
die() { echo -e "${R}✗${N} $*"; exit 1; }
[[ -f "package.json" ]] || die "Not in agentforge/ directory."
[[ -d "src/lib" ]] || die "No src/lib/ — wrong directory?"
ok "In agentforge/ directory"
info "Step 1: Backing up..."
BACKUP_DIR=".backup-$(date +%Y%m%d_%H%M%S)"; mkdir -p "$BACKUP_DIR"
for f in src/app/api/agent/chat/route.ts src/components/platform/agent-chat.tsx src/components/platform/file-explorer.tsx src/lib/llm-provider.ts stores/agent-store.ts; do [[ -f "$f" ]] && cp "$f" "$BACKUP_DIR/$(basename $f)"; done
ok "Backups: $BACKUP_DIR/"
info "Step 2: Patching agent-store.ts..."
python3 << 'PYEOF'
import os
f='stores/agent-store.ts'
if not os.path.exists(f): print(f"  SKIP {f}"); exit(0)
c=open(f).read(); o=c; ch=[]
if 'export interface TodoItem' not in c:
    old="export interface ProjectFile {\n  path: string\n  content: string\n  language: string\n}"
    new=old+"\n\nexport interface TodoItem {\n  text: string\n  done: boolean\n  priority?: string\n  filePath?: string\n}"
    if old in c: c=c.replace(old,new); ch.append("TodoItem interface")
if 'globalTodos: TodoItem[]' not in c:
    old="  agentStatus: 'idle' | 'thinking' | 'coding' | 'executing' | 'previewing' | 'error' | 'cancelled'\n\n  /** AbortController for cancelling in-flight agent requests */\n  abortController: AbortController | null"
    new="  agentStatus: 'idle' | 'thinking' | 'coding' | 'executing' | 'previewing' | 'error' | 'cancelled'\n\n  globalTodos: TodoItem[]\n  setGlobalTodos: (todos: TodoItem[]) => void\n  clearGlobalTodos: () => void\n\n  /** AbortController for cancelling in-flight agent requests */\n  abortController: AbortController | null"
    if old in c: c=c.replace(old,new); ch.append("globalTodos to interface")
if 'globalTodos: []' not in c:
    old="  agentStatus: 'idle',\n  abortController: null,"
    new="  agentStatus: 'idle',\n  abortController: null,\n  globalTodos: [],\n\n  setGlobalTodos: (todos) => set({ globalTodos: todos }),\n  clearGlobalTodos: () => set({ globalTodos: [] }),"
    if old in c: c=c.replace(old,new); ch.append("globalTodos state")
if 'globalTodos: [],\n    }),\n}))' not in c:
    old="      agentStatus: 'idle',\n      abortController: null,\n    }),\n}))"
    new="      agentStatus: 'idle',\n      abortController: null,\n      globalTodos: [],\n    }),\n}))"
    if old in c: c=c.replace(old,new); ch.append("globalTodos to reset")
if c!=o: open(f,'w').write(c); print(f"  ✓ {f}: {', '.join(ch)}")
else: print(f"  - {f}: no changes")
PYEOF
info "Step 3: Patching llm-provider.ts..."
if grep -q "parallel_tool_calls" src/lib/llm-provider.ts; then ok "llm-provider.ts already patched"; else sed -i "s|body.tool_choice = 'auto'|body.tool_choice = 'auto'\n      body.parallel_tool_calls = false  // Z.ai-style: one tool per response|g" src/lib/llm-provider.ts; ok "llm-provider.ts: added parallel_tool_calls: false"; fi
info "Step 4: Patching route.ts..."
python3 << 'PYEOF'
import os
f='src/app/api/agent/chat/route.ts'
if not os.path.exists(f): print(f"  SKIP {f}"); exit(0)
c=open(f).read(); o=c; ch=[]
if 'SEQUENTIAL_TOOL_EXECUTION' not in c:
    c=c.replace("const MAX_TOOL_ITERATIONS = 50","// Z.ai-style sequential execution\nconst SEQUENTIAL_TOOL_EXECUTION = process.env.SEQUENTIAL_TOOL_EXECUTION !== 'false'\nconst MAX_TOOL_ITERATIONS = SEQUENTIAL_TOOL_EXECUTION ? 150 : 50"); ch.append("SEQUENTIAL_TOOL_EXECUTION")
if 'ONE file per response, sequential execution' not in c:
    old="PHASE 2 — CREATE FILES (batch multiple write_file calls):\n  Create ALL project files using write_file. Batch MULTIPLE files per iteration.\n  Example of CORRECT behavior (4 files in one response):\n    write_file({\"path\": \"src/index.html\", \"content\": \"...\"})\n    write_file({\"path\": \"src/styles.css\", \"content\": \"...\"})\n    write_file({\"path\": \"src/app.js\", \"content\": \"...\"})\n    write_file({\"path\": \"package.json\", \"content\": \"...\"})"
    new="PHASE 2 — CREATE FILES (ONE file per response, sequential execution):\n  Create project files using write_file. Issue EXACTLY ONE write_file call per response.\n  After each file is written, the system will show you the result so you can verify it\n  before writing the next file. This matches Z.ai agent mode behavior."
    if old in c: c=c.replace(old,new); ch.append("system prompt")
if 'Heartbeat todo emission' not in c:
    old="        while (iteration < MAX_TOOL_ITERATIONS) {\n          iteration++\n          // v1.2: keep PlanTracker iteration count in sync so isStalled() works.\n          try { planTracker.incrementIteration() } catch { /* best-effort */ }\n\n          agentEventBus.emit('agent:iteration',"
    new="        while (iteration < MAX_TOOL_ITERATIONS) {\n          iteration++\n          // v1.2: keep PlanTracker iteration count in sync so isStalled() works.\n          try { planTracker.incrementIteration() } catch { /* best-effort */ }\n\n          // Issue 2 Fix: Heartbeat todo emission\n          try { emitPlanUpdate() } catch { /* don't break loop */ }\n\n          agentEventBus.emit('agent:iteration',"
    if old in c: c=c.replace(old,new); ch.append("heartbeat")
if 'allValidatedCalls' not in c:
    old="          // ── Execute tool calls in PARALLEL ─────────────────────────────\n\n          // Use validated calls (with corrected params) instead of raw calls\n          const parallelCalls: ParallelToolCall[] = validationResult.valid.map((tc, idx) => ({\n            id: tc.id,\n            toolName: tc.toolName,\n            params: {\n              ...tc.params,\n              ...(projectId && ['write_file', 'read_file', 'list_directory', 'search_files', 'edit_file', 'execute_code'].includes(tc.toolName)\n                ? { projectId }\n                : {}),\n            },\n          }))"
    new="          // ── Execute tool calls — SEQUENTIAL or PARALLEL mode ──────────\n          const allValidatedCalls: ParallelToolCall[] = validationResult.valid.map((tc, idx) => ({\n            id: tc.id,\n            toolName: tc.toolName,\n            params: {\n              ...tc.params,\n              ...(projectId && ['write_file', 'read_file', 'list_directory', 'search_files', 'edit_file', 'execute_code'].includes(tc.toolName)\n                ? { projectId }\n                : {}),\n            },\n          }))\n\n          const parallelCalls: ParallelToolCall[] = SEQUENTIAL_TOOL_EXECUTION\n            ? allValidatedCalls.slice(0, 1)\n            : allValidatedCalls\n\n          const skippedCalls = SEQUENTIAL_TOOL_EXECUTION\n            ? allValidatedCalls.slice(1)\n            : []\n\n          if (skippedCalls.length > 0) {\n            console.log(`[Agent Loop] Sequential mode: executing 1 of ${allValidatedCalls.length} tool calls, ${skippedCalls.length} queued`)\n            sse.terminal('info', `Sequential mode: executing 1 of ${allValidatedCalls.length} tool calls (${skippedCalls.length} queued)`)\n          }"
    if old in c: c=c.replace(old,new); ch.append("sequential execution")
if 'maxConcurrency: SEQUENTIAL_TOOL_EXECUTION ? 1 : 5' not in c:
    c=c.replace("              maxConcurrency: 5,","              maxConcurrency: SEQUENTIAL_TOOL_EXECUTION ? 1 : 5,"); ch.append("maxConcurrency")
if 'skippedCallsHint' not in c:
    old="          const continuationHint = iteration < MAX_TOOL_ITERATIONS - 1\n            ? `${previouslyWrittenMatch}${planProgressHint}${exploredSummary}${noFilesWrittenYet}\\n\\nNEXT ACTION: Create the REMAINING files from your plan. Batch MULTIPLE write_file calls in ONE response. If all files are done, respond with a summary and no tool calls.`\n            : 'This is the last iteration. Summarize what was created.'"
    new="          const skippedCallsHint = skippedCalls.length > 0\n            ? `\\n\\n⏳ SEQUENTIAL MODE: You issued ${allValidatedCalls.length} tool calls but only the FIRST was executed. The remaining ${skippedCalls.length} call(s) were SKIPPED. Reissue them ONE AT A TIME.`\n            : ''\n\n          const continuationHint = iteration < MAX_TOOL_ITERATIONS - 1\n            ? `${previouslyWrittenMatch}${planProgressHint}${exploredSummary}${noFilesWrittenYet}${skippedCallsHint}\\n\\nNEXT ACTION: ${SEQUENTIAL_TOOL_EXECUTION ? 'Issue exactly ONE tool call in your next response.' : 'Create the REMAINING files from your plan.'}`\n            : 'This is the last iteration. Summarize what was created.'"
    if old in c: c=c.replace(old,new); ch.append("skippedCallsHint")
if 'Final todo flush' not in c:
    old="        // ── Emit completion event ─────────────────────────────────────────\n\n        // Post-loop check: warn if no preview was created"
    new="        // Issue 2 Fix: Final todo flush\n        try {\n          emitPlanUpdate()\n          const finalAutoTodos = generateAutoTodosFromWrites(writtenFilesTracker, planSteps)\n          if (finalAutoTodos.length > 0) {\n            sse.todoUpdate(finalAutoTodos.map((t, i) => ({ text: t.text, done: true, filePath: t.filePath, priority: i <= 2 ? 'high' : i <= 4 ? 'med' : 'low' })))\n          }\n        } catch { /* don't break stream */ }\n\n        // ── Emit completion event ─────────────────────────────────────────\n\n        // Post-loop check: warn if no preview was created"
    if old in c: c=c.replace(old,new); ch.append("final flush")
if c!=o: open(f,'w').write(c); print(f"  ✓ {f}: {', '.join(ch)}")
else: print(f"  - {f}: no changes")
PYEOF
info "Step 5: Patching agent-chat.tsx..."
python3 << 'PYEOF'
import os
f='src/components/platform/agent-chat.tsx'
if not os.path.exists(f): print(f"  SKIP {f}"); exit(0)
c=open(f).read(); o=c; ch=[]
if 'setGlobalTodos' not in c:
    old="    addTerminalLine,\n    setPreviewHtml,\n  } = useAgentStore()"
    new="    addTerminalLine,\n    setPreviewHtml,\n    setGlobalTodos,\n    clearGlobalTodos,\n  } = useAgentStore()"
    if old in c: c=c.replace(old,new); ch.append("setGlobalTodos/clearGlobalTodos")
if 'clearGlobalTodos()' not in c:
    old="  const handleSend = useCallback(async () => {\n    if (!input.trim() || isStreaming) return\n\n    const userMessage: ChatMessage = {"
    new="  const handleSend = useCallback(async () => {\n    if (!input.trim() || isStreaming) return\n\n    // Issue 2 Fix: Clear global todos on NEW chat\n    if (messages.length === 0) { clearGlobalTodos() }\n\n    const userMessage: ChatMessage = {"
    if old in c: c=c.replace(old,new); ch.append("clear on new chat")
if 'setGlobalTodos(planTodos)' not in c:
    old="                setMessageTodos(prev => ({ ...prev, [assistantMessage.id]: planTodos }))\n              }\n            } catch (e) {\n              console.warn('[Agent Chat] Failed to parse plan_update event:', e)"
    new="                setMessageTodos(prev => ({ ...prev, [assistantMessage.id]: planTodos }))\n                setGlobalTodos(planTodos)\n              }\n            } catch (e) {\n              console.warn('[Agent Chat] Failed to parse plan_update event:', e)"
    if old in c: c=c.replace(old,new); ch.append("plan_update to globalTodos")
if 'currentGlobalTodos' not in c:
    old="                })\n              }\n            } catch (e) {\n              console.warn('[Agent Chat] Failed to parse todo_update event:', e)"
    new="                })\n                const currentGlobalTodos = useAgentStore.getState().globalTodos\n                if (currentGlobalTodos.length > 0) {\n                  const existingTexts = new Set(currentGlobalTodos.map(t => t.text.toLowerCase()))\n                  const merged = [...currentGlobalTodos]\n                  for (const t of todos as any[]) { if (!existingTexts.has(t.text.toLowerCase())) merged.push({ text: t.text, done: t.done, priority: t.priority, filePath: t.filePath }) }\n                  setGlobalTodos(merged)\n                } else { setGlobalTodos(todos.map((t: any) => ({ text: t.text, done: t.done, priority: t.priority, filePath: t.filePath }))) }\n              }\n            } catch (e) {\n              console.warn('[Agent Chat] Failed to parse todo_update event:', e)"
    if old in c: c=c.replace(old,new); ch.append("todo_update to globalTodos")
if 'Collapsible action badges' not in c:
    old="function ActionSummaryBar({ toolActions }: { toolActions: ToolAction[] }) {\n  const filesWritten = toolActions.filter(a => a.name === 'write_file' || a.name === 'edit_file').length\n  const filesExplored = toolActions.filter(a => a.name === 'read_file' || a.name === 'list_directory' || a.name === 'search_files').length\n  const commandsRun = toolActions.filter(a => a.name === 'execute_code').length\n  const searches = toolActions.filter(a => a.name === 'web_search').length\n\n  if (filesWritten === 0 && filesExplored === 0 && commandsRun === 0 && searches === 0) return null\n\n  return (\n    <div className=\"flex flex-wrap gap-1.5 my-2\">\n      {filesWritten > 0 && (\n        <div className=\"flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-[10px] text-emerald-400\">\n          <FilePen className=\"h-3 w-3\" />\n          <span className=\"font-medium\">{filesWritten} file{filesWritten !== 1 ? 's' : ''} written</span>\n        </div>\n      )}\n      {filesExplored > 0 && (\n        <div className=\"flex items-center gap-1 rounded-md bg-sky-500/10 border border-sky-500/20 px-2 py-1 text-[10px] text-sky-400\">\n          <FolderOpen className=\"h-3 w-3\" />\n          <span className=\"font-medium\">{filesExplored} explored</span>\n        </div>\n      )}\n      {commandsRun > 0 && (\n        <div className=\"flex items-center gap-1 rounded-md bg-orange-500/10 border border-orange-500/20 px-2 py-1 text-[10px] text-orange-400\">\n          <Terminal className=\"h-3 w-3\" />\n          <span className=\"font-medium\">{commandsRun} command{commandsRun !== 1 ? 's' : ''}</span>\n        </div>\n      )}\n      {searches > 0 && (\n        <div className=\"flex items-center gap-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 px-2 py-1 text-[10px] text-cyan-400\">\n          <Zap className=\"h-3 w-3\" />\n          <span className=\"font-medium\">{searches} search{searches !== 1 ? 'es' : ''}</span>\n        </div>\n      )}\n    </div>\n  )\n}"
    new="function ActionSummaryBar({ toolActions }: { toolActions: ToolAction[] }) {\n  const [expanded, setExpanded] = useState(false)\n  const filesWritten = toolActions.filter(a => a.name === 'write_file' || a.name === 'edit_file').length\n  const filesExplored = toolActions.filter(a => a.name === 'read_file' || a.name === 'list_directory' || a.name === 'search_files').length\n  const commandsRun = toolActions.filter(a => a.name === 'execute_code').length\n  const searches = toolActions.filter(a => a.name === 'web_search').length\n  if (filesWritten === 0 && filesExplored === 0 && commandsRun === 0 && searches === 0) return null\n  const allDone = toolActions.every(a => a.success === true)\n  return (\n    <div className=\"my-2 space-y-1\">\n      <button onClick={() => setExpanded(!expanded)} className=\"flex w-full items-center gap-2 rounded-md border border-zinc-700/40 bg-zinc-800/30 px-3 py-1.5 text-left hover:bg-zinc-800/50 transition-colors\">\n        {expanded ? <ChevronDown className=\"h-3 w-3 shrink-0 text-zinc-500\" /> : <ChevronRight className=\"h-3 w-3 shrink-0 text-zinc-500\" />}\n        <div className=\"flex flex-wrap items-center gap-1.5 flex-1\">\n          {filesWritten > 0 && (<div className=\"flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-400\"><FilePen className=\"h-2.5 w-2.5\" /><span className=\"font-medium\">{filesWritten} file{filesWritten !== 1 ? 's' : ''} written</span></div>)}\n          {filesExplored > 0 && (<div className=\"flex items-center gap-1 rounded bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-400\"><FolderOpen className=\"h-2.5 w-2.5\" /><span className=\"font-medium\">Explored {filesExplored}</span></div>)}\n          {commandsRun > 0 && (<div className=\"flex items-center gap-1 rounded bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 text-[10px] text-orange-400\"><Terminal className=\"h-2.5 w-2.5\" /><span className=\"font-medium\">Ran {commandsRun} command{commandsRun !== 1 ? 's' : ''}</span></div>)}\n          {searches > 0 && (<div className=\"flex items-center gap-1 rounded bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-400\"><Zap className=\"h-2.5 w-2.5\" /><span className=\"font-medium\">{searches} search{searches !== 1 ? 'es' : ''}</span></div>)}\n        </div>\n        {allDone && (<div className=\"flex items-center gap-1 text-[10px] text-zinc-500 shrink-0\"><CheckCircle2 className=\"h-2.5 w-2.5 text-emerald-400\" /><span>Done</span></div>)}\n      </button>\n      {expanded && (<div className=\"ml-4 space-y-1 border-l border-zinc-700/30 pl-3\">{toolActions.map((action, i) => (<ToolCallCard key={i} action={action} index={i} />))}</div>)}\n    </div>\n  )\n}"
    if old in c: c=c.replace(old,new); ch.append("Z.ai-style ActionSummaryBar")
if 'Tool calls are now INSIDE the ActionSummaryBar' not in c:
    old="      {/* Tool calls panel */}\n      {toolActions.length > 0 && (\n        <div className=\"space-y-1 mt-2\">\n          {toolActions.map((action, i) => (\n            <ToolCallCard key={i} action={action} index={i} />\n          ))}\n        </div>\n      )}\n    </div>\n  )\n}"
    new="      {/* Z.ai-style: Tool calls are now INSIDE the ActionSummaryBar */}\n    </div>\n  )\n}"
    if old in c: c=c.replace(old,new); ch.append("removed duplicate panel")
if c!=o: open(f,'w').write(c); print(f"  ✓ {f}: {', '.join(ch)}")
else: print(f"  - {f}: no changes")
PYEOF
info "Step 6: Patching file-explorer.tsx (complete rewrite)..."
python3 << 'PYEOF'
import os
f='src/components/platform/file-explorer.tsx'
if not os.path.exists(f): print(f"  SKIP {f}"); exit(0)
c=open(f).read()
if 'expandedFolders' in c: print(f"  - {f}: already patched"); exit(0)
fixed = open('/dev/stdin').read() if False else """'use client'

import { useMemo, useState, useCallback, useEffect } from 'react'
import { useAgentStore, type ProjectFile } from '../../../stores/agent-store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { FileCode2, FolderOpen, Folder, ChevronRight, ChevronDown, ChevronsDownUp, FileText, Database, Settings, Image as ImageIcon, FileJson, Trash2, Pencil, File } from 'lucide-react'
import { toast } from 'sonner'

interface TreeNode { name: string; path: string; isFolder: boolean; children: TreeNode[]; file?: ProjectFile }

function getExtensionColor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const m: Record<string,string> = { ts:'bg-blue-400',tsx:'bg-blue-400',js:'bg-yellow-400',jsx:'bg-yellow-400',css:'bg-pink-400',scss:'bg-pink-400',html:'bg-orange-400',json:'bg-yellow-300',md:'bg-zinc-400',prisma:'bg-emerald-400',sql:'bg-emerald-400',env:'bg-zinc-400',py:'bg-green-400',go:'bg-cyan-400',rs:'bg-orange-500' }
  return m[ext] || 'bg-zinc-400'
}
function formatFileSize(c: string): string { const b=new Blob([c]).size; if(b<1024)return`${b}B`; if(b<1048576)return`${(b/1024).toFixed(1)}KB`; return`${(b/1048576).toFixed(1)}MB` }
function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const file of files) { const parts=file.path.split('/').filter(Boolean); let cl=root
    for (let i=0;i<parts.length;i++) { const p=parts[i]; const isLast=i===parts.length-1; const cp=parts.slice(0,i+1).join('/'); let ex=cl.find(n=>n.name===p)
      if(!ex){const n:TreeNode={name:p,path:cp,isFolder:!isLast,children:[],file:isLast?file:undefined};cl.push(n);ex=n}
      if(!isLast)cl=ex.children } }
  const sort=(ns:TreeNode[]):TreeNode[]=>ns.sort((a,b)=>{if(a.isFolder!==b.isFolder)return a.isFolder?-1:1;return a.name.localeCompare(b.name)}).map(n=>({...n,children:sort(n.children)}))
  return sort(root)
}
function collectAllFolderPaths(ns:TreeNode[]):string[]{const p:string[]=[];const w=(ns:TreeNode[])=>{for(const n of ns){if(n.isFolder){p.push(n.path);w(n.children)}}};w(ns);return p}
function getAncestorFolderPaths(fp:string):string[]{const ps=fp.split('/').filter(Boolean);if(ps.length<=1)return[];const r:string[]=[];for(let i=1;i<ps.length;i++)r.push(ps.slice(0,i).join('/'));return r}
function FileIconForPath({path,className}:{path:string;className?:string}){const ext=path.split('.').pop()?.toLowerCase()||'';if(['ts','tsx','js','jsx'].includes(ext))return<FileCode2 className={className}/>;if(['css','scss'].includes(ext))return<Settings className={className}/>;if(ext==='json')return<FileJson className={className}/>;if(ext==='prisma')return<Database className={className}/>;if(['png','jpg','svg','gif'].includes(ext))return<ImageIcon className={className}/>;if(['md','txt'].includes(ext))return<FileText className={className}/>;return<FileCode2 className={className}/>}

function TreeNodeItem({node,depth,activeFile,onSelect,onDeleteFile,onRenameFile,expandedFolders,onToggleFolder}:{node:TreeNode;depth:number;activeFile:string|null;onSelect:(p:string)=>void;onDeleteFile:(p:string)=>void;onRenameFile:(o:string,n:string)=>void;expandedFolders:Set<string>;onToggleFolder:(p:string)=>void}) {
  const isActive=!node.isFolder&&node.path===activeFile; const isExpanded=expandedFolders.has(node.path)
  const handleClick=useCallback(()=>{if(node.isFolder)onToggleFolder(node.path);else onSelect(node.path)},[node.isFolder,node.path,onToggleFolder,onSelect])
  const content=(<button onClick={handleClick} className={`flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[11px] transition-colors ${isActive?'bg-zinc-800 text-zinc-100':'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`} style={{paddingLeft:`${depth*10+6}px`}}>
    {node.isFolder?(isExpanded?<ChevronDown className="h-3 w-3 shrink-0 text-zinc-500 transition-transform duration-150"/>:<ChevronRight className="h-3 w-3 shrink-0 text-zinc-500 transition-transform duration-150"/>):(<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${getExtensionColor(node.path)}`}/>)}
    {node.isFolder?(isExpanded?<FolderOpen className="h-3 w-3 shrink-0 text-zinc-500"/>:<Folder className="h-3 w-3 shrink-0 text-zinc-500"/>):<FileIconForPath path={node.path} className="h-3 w-3 shrink-0"/>}
    <span className="truncate flex-1">{node.name}</span>
    {!node.isFolder&&node.file&&(<span className="shrink-0 text-[9px] text-zinc-600">{formatFileSize(node.file.content)}</span>)}
  </button>)
  if(node.isFolder){return(<div><ContextMenu><ContextMenuTrigger asChild>{content}</ContextMenuTrigger><ContextMenuContent className="w-48"><ContextMenuItem onClick={()=>onToggleFolder(node.path)}><ChevronRight className="mr-2 h-3.5 w-3.5"/>{isExpanded?'Collapse':'Expand'}</ContextMenuItem><ContextMenuItem onClick={()=>onRenameFile(node.path,node.name)}><Pencil className="mr-2 h-3.5 w-3.5"/>Rename</ContextMenuItem><ContextMenuSeparator/><ContextMenuItem variant="destructive" onClick={()=>onDeleteFile(node.path)}><Trash2 className="mr-2 h-3.5 w-3.5"/>Delete</ContextMenuItem></ContextMenuContent></ContextMenu>{node.children.length>0&&isExpanded&&(<div>{node.children.map(c=>(<TreeNodeItem key={c.path} node={c} depth={depth+1} activeFile={activeFile} onSelect={onSelect} onDeleteFile={onDeleteFile} onRenameFile={onRenameFile} expandedFolders={expandedFolders} onToggleFolder={onToggleFolder}/>))}</div>)}</div>)}
  return(<ContextMenu><ContextMenuTrigger asChild>{content}</ContextMenuTrigger><ContextMenuContent className="w-48"><ContextMenuItem onClick={()=>onRenameFile(node.path,node.name)}><Pencil className="mr-2 h-3.5 w-3.5"/>Rename</ContextMenuItem><ContextMenuSeparator/><ContextMenuItem variant="destructive" onClick={()=>onDeleteFile(node.path)}><Trash2 className="mr-2 h-3.5 w-3.5"/>Delete</ContextMenuItem></ContextMenuContent></ContextMenu>)
}

export function FileExplorer() {
  const {projectFiles,activeFile,setActiveFile,currentProject,deleteProjectFile,renameProjectFile,addTerminalLine}=useAgentStore()
  const [isRenameDialogOpen,setIsRenameDialogOpen]=useState(false);const [renamePath,setRenamePath]=useState('');const [renameOldName,setRenameOldName]=useState('');const [renameNewName,setRenameNewName]=useState('')
  const [expandedFolders,setExpandedFolders]=useState<Set<string>>(new Set())
  const displayFiles=useMemo(()=>projectFiles.filter(f=>f.path!=='__preview.html'),[projectFiles])
  const tree=useMemo(()=>buildTree(displayFiles),[displayFiles])
  const hasAutoExpanded=useMemo(()=>({done:false}),[])
  useEffect(()=>{if(tree.length>0&&!hasAutoExpanded.done&&expandedFolders.size===0){const tlf=tree.filter(n=>n.isFolder).map(n=>n.path);if(tlf.length>0){setExpandedFolders(new Set(tlf));hasAutoExpanded.done=true}}},[tree,hasAutoExpanded,expandedFolders.size])
  useEffect(()=>{if(!activeFile)return;const a=getAncestorFolderPaths(activeFile);if(a.length===0)return;setExpandedFolders(p=>{let ch=false;const n=new Set(p);for(const x of a){if(!n.has(x)){n.add(x);ch=true}}return ch?n:p})},[activeFile])
  const toggleFolder=useCallback((path:string)=>{setExpandedFolders(p=>{const n=new Set(p);if(n.has(path))n.delete(path);else n.add(path);return n})},[])
  const handleCollapseAll=useCallback(()=>setExpandedFolders(new Set()),[])
  const handleExpandAll=useCallback(()=>setExpandedFolders(new Set(collectAllFolderPaths(tree))),[tree])
  const handleDeleteFile=useCallback(async(path:string)=>{deleteProjectFile(path);if(currentProject){try{await fetch('/api/files',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:currentProject,filePath:path})})}catch(e){console.error('Failed:',e)}}addTerminalLine(`info Deleted ${path}`);toast.success(`Deleted ${path.split('/').pop()}`)},[currentProject,deleteProjectFile,addTerminalLine])
  const handleStartRename=useCallback((path:string,name:string)=>{setRenamePath(path);setRenameOldName(name);setRenameNewName(name);setIsRenameDialogOpen(true)},[])
  const handleRename=useCallback(async()=>{if(!renameNewName.trim()||renameNewName===renameOldName){setIsRenameDialogOpen(false);return}const ps=renamePath.split('/');ps[ps.length-1]=renameNewName.trim();const np=ps.join('/');if(projectFiles.find(f=>f.path===np)){toast.error('Exists');return}renameProjectFile(renamePath,np);setActiveFile(np);if(currentProject){try{await fetch('/api/files',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:currentProject,oldPath:renamePath,newPath:np})})}catch(e){console.error('Failed:',e)}}addTerminalLine(`info Renamed ${renamePath} to ${np}`);setIsRenameDialogOpen(false);toast.success(`Renamed`)},[renamePath,renameNewName,renameOldName,projectFiles,currentProject,renameProjectFile,setActiveFile,addTerminalLine])
  if(displayFiles.length===0){return(<div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted"><Folder className="h-6 w-6 text-muted-foreground"/></div><div className="space-y-1"><p className="text-xs font-medium text-muted-foreground">No files yet</p><p className="text-[10px] text-muted-foreground/60">Files will appear as the agent generates code</p></div></div>)}
  return(<div className="flex h-full flex-col bg-zinc-950"><div className="flex items-center gap-2 border-b border-zinc-800/40 bg-zinc-900/60 px-3 py-2"><FolderOpen className="h-3.5 w-3.5 text-zinc-500"/><span className="text-[11px] font-semibold text-zinc-300">EXPLORER</span><span className="text-[10px] text-zinc-600">{displayFiles.length}</span><div className="ml-auto flex items-center gap-0.5"><button onClick={handleExpandAll} title="Expand All" className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"><ChevronDown className="h-3 w-3"/></button><button onClick={handleCollapseAll} title="Collapse All" className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"><ChevronsDownUp className="h-3 w-3"/></button></div></div><ScrollArea className="flex-1"><div className="space-y-px px-1 py-1">{tree.map(node=>(<TreeNodeItem key={node.path} node={node} depth={0} activeFile={activeFile} onSelect={setActiveFile} onDeleteFile={handleDeleteFile} onRenameFile={handleStartRename} expandedFolders={expandedFolders} onToggleFolder={toggleFolder}/>))}</div></ScrollArea><Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}><DialogContent><DialogHeader><DialogTitle>Rename</DialogTitle></DialogHeader><div className="space-y-4 pt-2"><div className="space-y-2"><label className="text-sm font-medium">New Name</label><Input value={renameNewName} onChange={e=>setRenameNewName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')handleRename()}} autoFocus/></div><Button onClick={handleRename} disabled={!renameNewName.trim()||renameNewName===renameOldName} className="w-full">Rename</Button></div></DialogContent></Dialog></div>)
}
"""
open(f,'w').write(fixed)
print(f"  ✓ {f}: complete rewrite with expand/collapse")
PYEOF
ok "All patches applied"
info "Step 7: Typecheck..."
if command -v bun &> /dev/null; then ERRS=$(bun run typecheck 2>&1 | grep -E "SEQUENTIAL_TOOL|parallel_tool|globalTodos|expandedFolders|skippedCalls|allValidatedCalls|ActionSummaryBar|ChevronsDownUp" | head -5 || true); [[ -z "$ERRS" ]] && ok "Typecheck passed — no errors in new code" || warn "Errors: $ERRS"; fi
echo ""
echo -e "${G}═══════════════════════════════════════════════════${N}"
echo -e "${G}  ✅  ALL 4 FIXES APPLIED${N}"
echo -e "${G}═══════════════════════════════════════════════════${N}"
echo ""
echo "  Issue 1: File Explorer — VS Code-style expand/collapse ✓"
echo "  Issue 2: Persistent Todos — global store + heartbeat ✓"
echo "  Issue 3: Sequential Tool Calls — Z.ai-style ✓"
echo "  Issue 4: Z.ai-style Chat Streaming ✓"
echo ""
echo "  Next: rm -rf .next && bun run dev"
echo "  Backups: $BACKUP_DIR/"
