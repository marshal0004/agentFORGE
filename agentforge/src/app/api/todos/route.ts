import { NextResponse } from "next/server";
import { getStore } from "@/lib/todo-store";

/** GET /api/todos — return all todos */
export async function GET() {
  const { todos } = getStore();
  return NextResponse.json({ data: todos });
}

/** POST /api/todos — create a new todo */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Todo text is required" } },
        { status: 422 }
      );
    }

    const store = getStore();
    const todo = {
      id: String(store.nextId++),
      text,
      completed: false,
      createdAt: Date.now(),
    };

    store.todos.push(todo);

    return NextResponse.json({ data: todo }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create todo" } },
      { status: 500 }
    );
  }
}
