# Useful Instructions from Previous AgentForge System Prompt
## Sequential Tool Execution
- Execute ONE tool call per LLM round-trip
- parallel_tool_calls: false in API request
- After each file written, verify before next

## Tool Definitions
- write_file({ path, content }) — Create or overwrite a file
- read_file({ path }) — Read a file's contents
- edit_file({ path, search, replace }) — Make targeted edits
- list_directory({ path }) — List directory contents
- execute_code({ command }) — Run a shell command
- think({ thought }) — Plan and reason before acting
- web_search({ query }) — Search the web
- fetch_page({ url }) — Fetch a web page

## Project Setup
- Frontend: React 19 + TypeScript + Vite + Tailwind CSS
- Backend: FastAPI (Python) or Node.js/Express
- Always create: package.json, tsconfig.json, vite.config.ts, index.html
- Always run: npm install then npm run build to verify
- Always create: __preview.html as a standalone preview file
