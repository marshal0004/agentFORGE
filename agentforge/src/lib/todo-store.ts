/**
 * In-memory todo store shared across API routes.
 * In a real app, this would be replaced with a database (Prisma, etc.)
 */

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

const seedTodos: Todo[] = [
  { id: "1", text: "Buy groceries", completed: false, createdAt: Date.now() - 3000 },
  { id: "2", text: "Read a book", completed: true, createdAt: Date.now() - 2000 },
  { id: "3", text: "Walk the dog", completed: false, createdAt: Date.now() - 1000 },
];

function getStore(): { todos: Todo[]; nextId: number } {
  if (!globalThis.__todoStore) {
    globalThis.__todoStore = { todos: [...seedTodos], nextId: 4 };
  }
  return globalThis.__todoStore;
}

declare global {
  // eslint-disable-next-line no-var
  var __todoStore:
    | { todos: Todo[]; nextId: number }
    | undefined;
}

export { getStore };
