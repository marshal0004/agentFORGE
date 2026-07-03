import { NextResponse } from "next/server";
import { getStore } from "@/lib/todo-store";

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH /api/todos/:id — update a todo (toggle completed or edit text) */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { todos } = getStore();
    const idx = todos.findIndex((t) => t.id === id);

    if (idx === -1) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Todo not found" } },
        { status: 404 }
      );
    }

    const body = await request.json();

    if (typeof body.completed === "boolean") {
      todos[idx].completed = body.completed;
    }
    if (typeof body.text === "string" && body.text.trim()) {
      todos[idx].text = body.text.trim();
    }

    return NextResponse.json({ data: todos[idx] });
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update todo" } },
      { status: 500 }
    );
  }
}

/** DELETE /api/todos/:id — delete a todo */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { todos } = getStore();
    const idx = todos.findIndex((t) => t.id === id);

    if (idx === -1) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Todo not found" } },
        { status: 404 }
      );
    }

    todos.splice(idx, 1);

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to delete todo" } },
      { status: 500 }
    );
  }
}
