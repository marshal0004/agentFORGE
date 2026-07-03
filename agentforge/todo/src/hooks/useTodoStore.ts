import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

type Filter = 'all' | 'active' | 'completed';

interface TodoState {
  todos: Todo[];
  filter: Filter;
  addTodo: (text: string) => void;
  toggleTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  editTodo: (id: string, text: string) => void;
  setFilter: (filter: Filter) => void;
  clearCompleted: () => void;
  filteredTodos: () => Todo[];
  activeCount: () => number;
  completedCount: () => number;
}

export const useTodoStore = create<TodoState>()(
  persist(
    (set, get) => ({
      todos: [],
      filter: 'all',

      addTodo: (text: string) => {
        const todo: Todo = {
          id: crypto.randomUUID(),
          text: text.trim(),
          completed: false,
          createdAt: Date.now(),
        };
        set((state) => ({ todos: [todo, ...state.todos] }));
      },

      toggleTodo: (id: string) => {
        set((state) => ({
          todos: state.todos.map((todo) =>
            todo.id === id ? { ...todo, completed: !todo.completed } : todo
          ),
        }));
      },

      deleteTodo: (id: string) => {
        set((state) => ({
          todos: state.todos.filter((todo) => todo.id !== id),
        }));
      },

      editTodo: (id: string, text: string) => {
        set((state) => ({
          todos: state.todos.map((todo) =>
            todo.id === id ? { ...todo, text: text.trim() } : todo
          ),
        }));
      },

      setFilter: (filter: Filter) => set({ filter }),

      clearCompleted: () => {
        set((state) => ({
          todos: state.todos.filter((todo) => !todo.completed),
        }));
      },

      filteredTodos: () => {
        const { todos, filter } = get();
        switch (filter) {
          case 'active':
            return todos.filter((t) => !t.completed);
          case 'completed':
            return todos.filter((t) => t.completed);
          default:
            return todos;
        }
      },

      activeCount: () => get().todos.filter((t) => !t.completed).length,

      completedCount: () => get().todos.filter((t) => t.completed).length,
    }),
    { name: 'todo-storage' }
  )
);
