---
name: artifact-writer
description: "XML artifact format for multi-file bulk writes. PREFERRED for 3+ files. Supports create/update/delete atomically. Used by Claude Code, Z.ai, and emergent.sh."
metadata:
  origin: agentFORGE
  category: file-generation
  version: 1.0.0
---

# Artifact Writer Skill

XML-based multi-file bulk write mechanism. Supports create/update/delete actions atomically in a single `<artifact>` block.

## When to Use
- Creating 3+ files in one response
- Refactoring (delete old + create new)
- Full project scaffolding
- Any bulk file operation

## When NOT to Use
- Single file changes → use `write_file` tool call
- Small edits to existing files → use `edit_file` with search/replace

## Format
```xml
<artifact id="unique-id" title="Description">
  <action filePath="path/to/file.ts" type="create">
file content here
  </action>
  <action filePath="path/to/another.tsx" type="create">
more content
  </action>
  <action filePath="old/file.ts" type="delete" />
</artifact>
```

## Action Types
| Type | Description | Self-closing? |
|------|-------------|---------------|
| `create` | Write new file (overwrites if exists) | No |
| `update` | Replace existing file content | No |
| `delete` | Remove file from project | Yes (`<action ... />`) |

## Rules
- `filePath` is relative to project root (no leading `/`)
- XML-escape special chars in content: `&lt;` `&gt;` `&amp;` `&quot;` `&apos;`
- Multiple `<artifact>` blocks per response are OK
- Path traversal (`../`) is blocked by the executor
- Protected files (`.env`, `package-lock.json`) are blocked by protection manager

## Integration
- **Lib**: `artifactParser.parseArtifacts(text)` + `artifactExecutor.executeArtifacts(projectId, artifacts)` in `src/lib/artifact-writer.ts`
- **Chat Route**: Post-loop parsing — artifacts are extracted from `fullResponse` after the agent loop completes, executed via filesystem.ts, and merged into `trackedFilesMap`
- **System Prompt**: The chat route's system prompt includes `${artifactInstructions}` which tells the LLM when to use this format

## Parser Bug Fix (v1.3)
The original `actionRegex` matched self-closing `<action ... />` tags as opening tags, then greedily consumed the next `</action>` — shadowing any create/update action that followed a self-closing delete. Fixed with negative lookbehind `(?<!\/)` before `>`.

## Related Skills
- `verification-loop` — runs after artifacts are written
- `build-error-resolver` — runs if verification finds build errors
- `code-reviewer` — reviews the written artifact files
