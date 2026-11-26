import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { createApiHandler } from "@/src/http-api";
import { prisma } from "@/src/prisma";

const dispatch = createApiHandler({
  db: prisma,
  getSession: async () => {
    const session = await auth();
    return session?.user?.id ? { userId: session.user.id } : null;
  },
});

async function handle(request: NextRequest) {
  let body: unknown;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } },
          { status: 400 },
        );
      }
    }
  }

  const result = await dispatch({
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
    body,
  });
  return NextResponse.json(result.body, { status: result.status });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
