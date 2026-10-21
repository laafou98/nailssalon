import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Minimal server-side client for the YouCam (Perfect Corp) task APIs.
 * Every AI feature follows the same shape: create a task, then poll it until
 * it reaches `success` or `error`. Result URLs expire after 2 hours, so callers
 * must copy results into our own storage straight away.
 */

export const YOUCAM_BASE_URL = "https://yce-api-01.makeupar.com/s2s/v2.0";

/** Task endpoints we use, mapped to their path segment and unit cost. */
export const ENGINES = {
  nail_vto: { path: "nail-vto", units: 1 },
  nail_transfer: { path: "ai-nail", units: 1 },
} as const;

export type Engine = keyof typeof ENGINES;

export type TaskState =
  | { status: "running" }
  | { status: "success"; resultUrl: string }
  | { status: "error"; error: string; message?: string };

export class YouCamError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "YouCamError";
  }
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${serverEnv("YOUCAM_API_KEY")}`,
    "Content-Type": "application/json",
  };
}

/**
 * Local-only stand-in for YouCam, so the whole render flow can be exercised without
 * spending units: tasks "succeed" after 3 s and return the hand photo itself.
 * The colour #000001 makes a task fail with error_no_nail, to exercise failure handling.
 * Enabled with YOUCAM_MOCK=1, and never in production builds.
 */
const mockEnabled = () => process.env.YOUCAM_MOCK === "1" && process.env.NODE_ENV !== "production";
type MockTask = { src: string; at: number; fail: boolean };
const mockTasks: Map<string, MockTask> = ((globalThis as { __youcamMock?: Map<string, MockTask> }).__youcamMock ??= new Map());
export const MOCK_FAIL_COLOR = "#000001";
const MOCK_PREFIX = "mock_";

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new YouCamError(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`, res.status);
  }
}

/** Create a task and return its task_id. Units are only charged if the task succeeds. */
export async function createTask(engine: Engine, body: object): Promise<string> {
  if (mockEnabled()) {
    const id = `${MOCK_PREFIX}${crypto.randomUUID()}`;
    const { src_file_url, effects } = body as { src_file_url?: string; effects?: { color?: string }[] };
    const fail = Boolean(effects?.some((e) => e.color === MOCK_FAIL_COLOR));
    mockTasks.set(id, { src: String(src_file_url ?? ""), at: Date.now(), fail });
    return id;
  }
  const res = await fetch(`${YOUCAM_BASE_URL}/task/${ENGINES[engine].path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  const taskId = (json.data as { task_id?: string } | undefined)?.task_id;

  if (!res.ok || !taskId) {
    throw new YouCamError(
      String(json.error ?? `Task creation failed (${res.status})`),
      res.status,
      json.error_code as string | undefined,
    );
  }
  return taskId;
}

/** Fetch the current state of a task once. */
export async function getTask(engine: Engine, taskId: string): Promise<TaskState> {
  if (taskId.startsWith(MOCK_PREFIX)) {
    const task = mockEnabled() ? mockTasks.get(taskId) : undefined;
    if (!task) return { status: "error", error: "mock_task_not_found" };
    if (Date.now() - task.at < 3000) return { status: "running" };
    return task.fail ? { status: "error", error: "error_no_nail" } : { status: "success", resultUrl: task.src };
  }
  const res = await fetch(
    `${YOUCAM_BASE_URL}/task/${ENGINES[engine].path}/${encodeURIComponent(taskId)}`,
    { headers: headers(), cache: "no-store" },
  );
  const json = await readJson(res);
  if (!res.ok) {
    throw new YouCamError(String(json.error ?? `Task status failed (${res.status})`), res.status);
  }

  const data = json.data as {
    task_status?: string;
    error?: string | null;
    error_message?: string;
    results?: { url?: string } | Array<{ url?: string }>;
  };

  switch (data.task_status) {
    case "success": {
      const results = data.results;
      const url = Array.isArray(results) ? results[0]?.url : results?.url;
      if (!url) return { status: "error", error: "missing_result_url" };
      return { status: "success", resultUrl: url };
    }
    case "error":
      return { status: "error", error: data.error ?? "unknown_error", message: data.error_message };
    default:
      return { status: "running" };
  }
}

/** Poll a task until it finishes or the timeout passes. Observed latency is 7–10 s. */
export async function waitForTask(
  engine: Engine,
  taskId: string,
  { intervalMs = 2000, timeoutMs = 60_000 } = {},
): Promise<Exclude<TaskState, { status: "running" }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const state = await getTask(engine, taskId);
    if (state.status !== "running") return state;
  }
  return { status: "error", error: "timeout" };
}
