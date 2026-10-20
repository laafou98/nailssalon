import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouCamError, createTask, getTask, waitForTask } from "./client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("YouCam client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv("YOUCAM_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("creates a task with bearer auth and returns the task id", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 200, data: { task_id: "abc" } }));

    await expect(createTask("nail_vto", { version: "1.0" })).resolves.toBe("abc");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://yce-api-01.makeupar.com/s2s/v2.0/task/nail-vto");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("maps nail_transfer to the ai-nail endpoint", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 200, data: { task_id: "t" } }));
    await createTask("nail_transfer", {});
    expect(fetchMock.mock.calls[0][0]).toBe("https://yce-api-01.makeupar.com/s2s/v2.0/task/ai-nail");
  });

  it("throws YouCamError with the error code when creation fails", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ status: 400, error: "Insufficient units", error_code: "CreditInsufficiency" }, 400),
    );

    const error = await createTask("nail_vto", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(YouCamError);
    expect(error).toMatchObject({ httpStatus: 400, code: "CreditInsufficiency" });
  });

  it("parses success, error and running states", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: { task_status: "success", results: { url: "https://r/1.jpg" } } }))
      .mockResolvedValueOnce(json({ data: { task_status: "error", error: "no_hand_detected" } }))
      .mockResolvedValueOnce(json({ data: { task_status: "running" } }));

    await expect(getTask("nail_vto", "x")).resolves.toEqual({ status: "success", resultUrl: "https://r/1.jpg" });
    await expect(getTask("nail_vto", "x")).resolves.toMatchObject({ status: "error", error: "no_hand_detected" });
    await expect(getTask("nail_vto", "x")).resolves.toEqual({ status: "running" });
  });

  it("polls until the task finishes", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(json({ data: { task_status: "running" } }))
      .mockResolvedValueOnce(json({ data: { task_status: "success", results: { url: "https://r/2.jpg" } } }));

    const pending = waitForTask("nail_transfer", "x", { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toEqual({ status: "success", resultUrl: "https://r/2.jpg" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("times out instead of polling forever", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => json({ data: { task_status: "running" } }));

    const pending = waitForTask("nail_vto", "x", { intervalMs: 100, timeoutMs: 300 });
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toEqual({ status: "error", error: "timeout" });
  });
});
