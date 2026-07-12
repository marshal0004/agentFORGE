import { describe, it, expect } from 'vitest'
const BASE_URL = 'http://localhost:3000'
async function parseSSE(response: Response): Promise<Array<{ event: string; data: any }>> {
  const text = await response.text()
  const events: Array<{ event: string; data: any }> = []
  const lines = text.split('\n')
  let currentEvent = ''; let currentData = ''
  for (const line of lines) {
    if (line.startsWith('event: ')) currentEvent = line.slice(7)
    else if (line.startsWith('data: ')) currentData = line.slice(6)
    else if (line === '' && currentEvent) {
      try { events.push({ event: currentEvent, data: JSON.parse(currentData) }) } catch { events.push({ event: currentEvent, data: currentData }) }
      currentEvent = ''; currentData = ''
    }
  }
  return events
}
describe('Backend: Agent Chat — Skill Loading', () => {
  it('should respond to "list/skills" with available skills', async () => {
    const response = await fetch(`${BASE_URL}/api/agent/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'list/skills' }] }) })
    expect(response.status).toBe(200)
    const events = await parseSSE(response)
    const contentEvent = events.find(e => e.event === 'content')
    expect(contentEvent).toBeDefined()
    expect(contentEvent.data.text).toContain('Available Skills')
  })
  it('should load fullstack-developer skill successfully', async () => {
    const response = await fetch(`${BASE_URL}/api/agent/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'load/fullstack-developer' }] }) })
    expect(response.status).toBe(200)
    const events = await parseSSE(response)
    const contentEvent = events.find(e => e.event === 'content')
    expect(contentEvent).toBeDefined()
    expect(contentEvent.data.text).toContain('Skill loaded')
  })
})
