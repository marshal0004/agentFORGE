'use client'

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
