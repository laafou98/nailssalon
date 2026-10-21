import "server-only";
import { RenderError } from "@/lib/render/service";

/**
 * Turns any thrown error into a JSON response, so the browser always gets a readable
 * reason instead of an empty 500. Unexpected errors are logged for the Vercel logs.
 */
export function errorResponse(error: unknown, route: string): Response {
  if (error instanceof RenderError) return Response.json({ error: error.message }, { status: error.httpStatus });
  console.error(`[${route}]`, error);
  return Response.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
}
