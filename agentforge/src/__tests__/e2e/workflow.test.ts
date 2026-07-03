import { describe, it, expect, afterAll } from 'vitest'
import { GET as getProjects, POST as postProjects, PUT as putProjects, DELETE as deleteProjects } from '@/app/api/projects/route'
import { GET as getSkills, POST as postSkills, PUT as putSkills } from '@/app/api/skills/route'
import { GET as getMcp, POST as postMcp, PUT as putMcp, DELETE as deleteMcp } from '@/app/api/mcp/route'
import { GET as getFiles, POST as postFiles, PUT as putFiles, DELETE as deleteFiles } from '@/app/api/files/route'
import { POST as postTerminal } from '@/app/api/terminal/route'
import { createJsonRequest, createRequest, parseResponse } from '../helpers/api-helpers'
import { db } from '@/lib/db'
import { deleteProjectWorkspace } from '@/lib/filesystem'

/**
 * E2E-style workflow tests that combine multiple API calls
 * to test complete user workflows.
 */
describe('E2E Workflows', () => {
  const createdProjectIds: string[] = []
  const createdSkillIds: string[] = []
  const createdMcpIds: string[] = []

  afterAll(async () => {
    // Clean up projects
    for (const id of createdProjectIds) {
      try {
        await db.message.deleteMany({ where: { projectId: id } })
        await db.project.delete({ where: { id } })
      } catch {
        // Ignore
      }
    }
    // Clean up skills
    for (const id of createdSkillIds) {
      try {
        await db.skill.delete({ where: { id } })
      } catch {
        // Ignore
      }
    }
    // Clean up MCP servers
    for (const id of createdMcpIds) {
      try {
        await db.mCPServer.delete({ where: { id } })
      } catch {
        // Ignore
      }
    }
    // Clean up test workspaces
    for (const id of createdProjectIds) {
      try {
        await deleteProjectWorkspace(id)
      } catch {
        // Ignore
      }
    }
  })

  describe('Full project creation workflow', () => {
    it('creates a project, retrieves it, updates status, and verifies', async () => {
      // Step 1: Create project
      const createReq = createJsonRequest('/api/projects', {
        name: 'E2E Workflow Project',
        description: 'Testing full workflow',
      })
      const createRes = await postProjects(createReq)
      const { data: createData, status: createStatus } = await parseResponse(createRes)

      expect(createStatus).toBe(201)
      const project = (createData as Record<string, unknown>).project as Record<string, unknown>
      const projectId = project.id as string
      createdProjectIds.push(projectId)

      expect(project.name).toBe('E2E Workflow Project')
      expect(project.status).toBe('draft')

      // Step 2: Get project (verify it's in the list)
      const getRes = await getProjects()
      const { data: getData } = await parseResponse(getRes)
      const projects = (getData as Record<string, unknown>).projects as Record<string, unknown>[]
      const found = projects.find((p) => p.id === projectId)
      expect(found).toBeDefined()
      expect(found!.name).toBe('E2E Workflow Project')

      // Step 3: Update project status
      const updateReq = createJsonRequest('/api/projects', {
        id: projectId,
        status: 'active',
      }, 'PUT')
      const updateRes = await putProjects(updateReq)
      const { data: updateData } = await parseResponse(updateRes)
      const updatedProject = (updateData as Record<string, unknown>).project as Record<string, unknown>
      expect(updatedProject.status).toBe('active')

      // Step 4: Verify update persisted
      const getRes2 = await getProjects()
      const { data: getData2 } = await parseResponse(getRes2)
      const projects2 = (getData2 as Record<string, unknown>).projects as Record<string, unknown>[]
      const found2 = projects2.find((p) => p.id === projectId)
      expect(found2).toBeDefined()
      expect(found2!.status).toBe('active')
    })
  })

  describe('Skill management workflow', () => {
    it('gets skills, installs a skill, toggles it, and verifies', async () => {
      // Step 1: Get skills (triggers seeding)
      const getRes = await getSkills()
      const { data: getData } = await parseResponse(getRes)
      const skills = (getData as Record<string, unknown>).skills as Record<string, unknown>[]
      expect(skills.length).toBeGreaterThan(0)

      // Step 2: Find a not-installed skill
      let targetSkill = skills.find((s) => s.installed === false)
      if (!targetSkill) {
        // Create one if all are installed
        const createReq = createJsonRequest('/api/skills', {
          name: 'E2E Workflow Skill',
          description: 'For workflow testing',
          category: 'test',
          installed: false,
          enabled: false,
        })
        const createRes = await postSkills(createReq)
        const { data: createData } = await parseResponse(createRes)
        targetSkill = (createData as Record<string, unknown>).skill as Record<string, unknown>
        createdSkillIds.push(targetSkill.id as string)
      } else {
        createdSkillIds.push(targetSkill.id as string)
      }

      // Step 3: Install the skill
      const installReq = createJsonRequest('/api/skills', {
        id: targetSkill.id,
        action: 'install',
      }, 'PUT')
      const installRes = await putSkills(installReq)
      const { data: installData } = await parseResponse(installRes)
      const installedSkill = (installData as Record<string, unknown>).skill as Record<string, unknown>
      expect(installedSkill.installed).toBe(true)
      expect(installedSkill.enabled).toBe(true)

      // Step 4: Toggle the skill (disable it)
      const toggleReq = createJsonRequest('/api/skills', {
        id: targetSkill.id,
        action: 'toggle',
      }, 'PUT')
      const toggleRes = await putSkills(toggleReq)
      const { data: toggleData } = await parseResponse(toggleRes)
      const toggledSkill = (toggleData as Record<string, unknown>).skill as Record<string, unknown>
      expect(toggledSkill.enabled).toBe(false)
    })
  })

  describe('MCP server workflow', () => {
    it('gets servers, attempts connect (handles failure), toggles, disconnects, and verifies', async () => {
      // Step 1: Get servers (triggers seeding)
      const getRes = await getMcp()
      const { data: getData } = await parseResponse(getRes)
      const servers = (getData as Record<string, unknown>).servers as Record<string, unknown>[]
      expect(servers.length).toBeGreaterThan(0)

      // Step 2: Create a test server for the workflow
      const createReq = createJsonRequest('/api/mcp', {
        name: 'E2E Workflow MCP Server',
        description: 'For workflow testing',
        command: 'cat',
        args: [],
        category: 'test',
        enabled: false,
        connected: false,
      })
      const createRes = await postMcp(createReq)
      const { data: createData } = await parseResponse(createRes)
      const server = (createData as Record<string, unknown>).server as Record<string, unknown>
      createdMcpIds.push(server.id as string)

      // Step 3: Attempt to connect — cat won't complete MCP handshake so expect 502
      const connectReq = createJsonRequest('/api/mcp', {
        id: server.id,
        action: 'connect',
      }, 'PUT')
      const connectRes = await putMcp(connectReq)
      const { data: connectData, status: connectStatus } = await parseResponse(connectRes)
      // Connection may fail (502) because cat doesn't implement MCP protocol
      // This is expected behavior — the real MCP server process must implement the protocol
      expect([200, 502]).toContain(connectStatus)

      // Step 4: Toggle the server (disable)
      const toggleReq = createJsonRequest('/api/mcp', {
        id: server.id,
        action: 'toggle',
      }, 'PUT')
      const toggleRes = await putMcp(toggleReq)
      const { data: toggleData } = await parseResponse(toggleRes)
      const toggledServer = (toggleData as Record<string, unknown>).server as Record<string, unknown>
      expect(toggledServer.enabled).toBe(false)
      // When disabling via toggle, connected should also become false
      expect(toggledServer.connected).toBe(false)

      // Step 5: Re-enable and then disconnect
      const toggleReq2 = createJsonRequest('/api/mcp', {
        id: server.id,
        action: 'toggle',
      }, 'PUT')
      const toggleRes2 = await putMcp(toggleReq2)
      const { data: toggleData2 } = await parseResponse(toggleRes2)
      const reenabledServer = (toggleData2 as Record<string, unknown>).server as Record<string, unknown>
      expect(reenabledServer.enabled).toBe(true)

      // Disconnect should work even if not connected
      const disconnectReq = createJsonRequest('/api/mcp', {
        id: server.id,
        action: 'disconnect',
      }, 'PUT')
      const disconnectRes = await putMcp(disconnectReq)
      const { data: disconnectData } = await parseResponse(disconnectRes)
      const disconnectedServer = (disconnectData as Record<string, unknown>).server as Record<string, unknown>
      expect(disconnectedServer.connected).toBe(false)
    })
  })

  describe('File generation workflow', () => {
    const FILE_PROJECT_ID = '__e2e_file_workflow__'

    afterAll(async () => {
      try {
        await deleteProjectWorkspace(FILE_PROJECT_ID)
      } catch {
        // Ignore
      }
    })

    it('creates project, writes files, reads files, lists files, deletes, and verifies', async () => {
      // Step 1: Create a project in DB
      const createProjectReq = createJsonRequest('/api/projects', {
        name: 'E2E File Workflow Project',
      })
      const createProjectRes = await postProjects(createProjectReq)
      const { data: projectData } = await parseResponse(createProjectRes)
      const project = (projectData as Record<string, unknown>).project as Record<string, unknown>
      createdProjectIds.push(project.id as string)

      // Step 2: Write multiple files
      const files = [
        { filePath: 'index.html', content: '<html><body>Hello</body></html>' },
        { filePath: 'style.css', content: 'body { color: red; }' },
        { filePath: 'src/app.ts', content: 'console.log("hello")' },
      ]

      for (const file of files) {
        const writeReq = createJsonRequest('/api/files', {
          projectId: FILE_PROJECT_ID,
          filePath: file.filePath,
          content: file.content,
        })
        const writeRes = await postFiles(writeReq)
        const { status } = await parseResponse(writeRes)
        expect(status).toBe(201)
      }

      // Step 3: Read a file
      const readReq = createRequest(`/api/files?projectId=${FILE_PROJECT_ID}&filePath=src/app.ts`)
      const readRes = await getFiles(readReq)
      const { data: readData } = await parseResponse(readRes)
      expect((readData as Record<string, unknown>).content).toBe('console.log("hello")')

      // Step 4: List files
      const listReq = createRequest(`/api/files?projectId=${FILE_PROJECT_ID}`)
      const listRes = await getFiles(listReq)
      const { data: listData } = await parseResponse(listRes)
      expect((listData as Record<string, unknown>).fileCount).toBe(3)
      const fileList = (listData as Record<string, unknown>).files as string[]
      expect(fileList).toContain('index.html')
      expect(fileList).toContain('style.css')
      expect(fileList).toContain('src/app.ts')

      // Step 5: Delete a specific file
      const deleteFileReq = createJsonRequest('/api/files', {
        projectId: FILE_PROJECT_ID,
        filePath: 'style.css',
      }, 'DELETE')
      const deleteFileRes = await deleteFiles(deleteFileReq)
      const { data: deleteData } = await parseResponse(deleteFileRes)
      expect((deleteData as Record<string, unknown>).success).toBe(true)

      // Verify file was deleted
      const listReq2 = createRequest(`/api/files?projectId=${FILE_PROJECT_ID}`)
      const listRes2 = await getFiles(listReq2)
      const { data: listData2 } = await parseResponse(listRes2)
      expect((listData2 as Record<string, unknown>).fileCount).toBe(2)

      // Step 6: Delete entire workspace
      const deleteWsReq = createJsonRequest('/api/files', {
        projectId: FILE_PROJECT_ID,
      }, 'DELETE')
      const deleteWsRes = await deleteFiles(deleteWsReq)
      const { data: deleteWsData } = await parseResponse(deleteWsRes)
      expect((deleteWsData as Record<string, unknown>).success).toBe(true)
    })
  })

  describe('Terminal execution workflow', () => {
    it('creates project, executes command in project dir, verifies output', async () => {
      const TERM_PROJECT_ID = '__e2e_terminal_workflow__'

      // Step 1: Create project workspace by writing a file
      const writeReq = createJsonRequest('/api/files', {
        projectId: TERM_PROJECT_ID,
        filePath: 'hello.txt',
        content: 'Hello from project',
      })
      await postFiles(writeReq)

      // Step 2: Execute command in project directory
      const termReq = createJsonRequest('/api/terminal', {
        command: 'cat hello.txt',
        projectId: TERM_PROJECT_ID,
      })
      const termRes = await postTerminal(termReq)
      const { data: termData } = await parseResponse(termRes)

      expect((termData as Record<string, unknown>).stdout).toContain('Hello from project')
      expect((termData as Record<string, unknown>).exitCode).toBe(0)

      // Step 3: Execute a command that creates a new file
      const termReq2 = createJsonRequest('/api/terminal', {
        command: 'echo "created by terminal" > terminal-created.txt',
        projectId: TERM_PROJECT_ID,
      })
      const termRes2 = await postTerminal(termReq2)
      const { data: termData2 } = await parseResponse(termRes2)
      expect((termData2 as Record<string, unknown>).exitCode).toBe(0)

      // Step 4: Verify the file was created
      const readReq = createRequest(`/api/files?projectId=${TERM_PROJECT_ID}&filePath=terminal-created.txt`)
      const readRes = await getFiles(readReq)
      const { data: readData } = await parseResponse(readRes)
      expect((readData as Record<string, unknown>).content).toContain('created by terminal')

      // Clean up
      try {
        await deleteProjectWorkspace(TERM_PROJECT_ID)
      } catch {
        // Ignore
      }
    })
  })
})
