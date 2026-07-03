"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Trash2, ListTodo, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

type Filter = "all" | "active" | "completed";

export function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodo, setNewTodo] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch("/api/todos");
      const json = await res.json();
      setTodos(json.data ?? []);
    } catch {
      // silently fail — keep existing state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const addTodo = async () => {
    const text = newTodo.trim();
    if (!text) return;

    const tempId = `temp-${Date.now()}`;
    const optimistic: Todo = { id: tempId, text, completed: false, createdAt: Date.now() };
    setTodos((prev) => [...prev, optimistic]);
    setNewTodo("");

    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (res.ok) {
        setTodos((prev) => prev.map((t) => (t.id === tempId ? json.data : t)));
      } else {
        setTodos((prev) => prev.filter((t) => t.id !== tempId));
      }
    } catch {
      setTodos((prev) => prev.filter((t) => t.id !== tempId));
    }

    inputRef.current?.focus();
  };

  const toggleTodo = async (id: string, completed: boolean) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !completed } : t))
    );

    try {
      await fetch(`/api/todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !completed }),
      });
    } catch {
      setTodos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, completed } : t))
      );
    }
  };

  const deleteTodo = async (id: string) => {
    const snapshot = todos;
    setTodos((prev) => prev.filter((t) => t.id !== id));

    try {
      await fetch(`/api/todos/${id}`, { method: "DELETE" });
    } catch {
      setTodos(snapshot);
    }
  };

  const clearCompleted = async () => {
    const completedTodos = todos.filter((t) => t.completed);
    setTodos((prev) => prev.filter((t) => !t.completed));

    try {
      await Promise.all(
        completedTodos.map((t) =>
          fetch(`/api/todos/${t.id}`, { method: "DELETE" })
        )
      );
    } catch {
      fetchTodos();
    }
  };

  const filtered = todos.filter((t) => {
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground">
          <ListTodo className="w-5 h-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Todo</h1>
      </div>

      {/* Add Todo */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addTodo();
        }}
        className="flex gap-2 mb-6"
      >
        <Input
          ref={inputRef}
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          placeholder="What needs to be done?"
          className="h-11 flex-1"
        />
        <Button type="submit" size="default" className="h-11 px-5 gap-2 shrink-0">
          <Plus className="w-4 h-4" />
          Add
        </Button>
      </form>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-4 rounded-lg bg-muted p-1">
        {(["all", "active", "completed"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
              filter === f
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Todo List */}
      <div className="space-y-1 min-h-[200px]">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Check className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">
              {filter === "completed"
                ? "No completed todos yet"
                : filter === "active"
                ? "All done! 🎉"
                : "No todos yet — add one above!"}
            </p>
          </div>
        ) : (
          filtered.map((todo) => (
            <div
              key={todo.id}
              className={cn(
                "group flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
                "bg-card hover:bg-accent/50",
                todo.completed && "opacity-60"
              )}
            >
              <Checkbox
                checked={todo.completed}
                onCheckedChange={() => toggleTodo(todo.id, todo.completed)}
                aria-label={`Mark "${todo.text}" as ${todo.completed ? "incomplete" : "complete"}`}
                className="shrink-0"
              />
              <span
                className={cn(
                  "flex-1 text-sm leading-tight break-words",
                  todo.completed && "line-through text-muted-foreground"
                )}
              >
                {todo.text}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteTodo(todo.id)}
                aria-label={`Delete "${todo.text}"`}
                className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {todos.length > 0 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t text-xs text-muted-foreground">
          <span>
            {activeCount} {activeCount === 1 ? "item" : "items"} left
          </span>
          {completedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearCompleted}
              className="h-auto py-0 px-2 text-xs text-muted-foreground hover:text-destructive"
            >
              Clear completed
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
