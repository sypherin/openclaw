import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  filterBootstrapFilesForSession,
  loadWorkspaceBootstrapFiles,
  resolveDefaultAgentWorkspaceDir,
} from "./workspace.js";

describe("resolveDefaultAgentWorkspaceDir", () => {
  it("uses OPENCLAW_HOME for default workspace resolution", () => {
    const dir = resolveDefaultAgentWorkspaceDir({
      OPENCLAW_HOME: "/srv/openclaw-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv);

    expect(dir).toBe(path.join(path.resolve("/srv/openclaw-home"), ".openclaw", "workspace"));
  });
});

describe("loadWorkspaceBootstrapFiles", () => {
  it("includes MEMORY.md when present", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: "MEMORY.md", content: "memory" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const memoryEntries = files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    );

    expect(memoryEntries).toHaveLength(1);
    expect(memoryEntries[0]?.missing).toBe(false);
    expect(memoryEntries[0]?.content).toBe("memory");
  });

  it("includes memory.md when MEMORY.md is absent", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: "memory.md", content: "alt" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const memoryEntries = files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    );

    expect(memoryEntries).toHaveLength(1);
    expect(memoryEntries[0]?.missing).toBe(false);
    expect(memoryEntries[0]?.content).toBe("alt");
  });

  it("omits memory entries when no memory files exist", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const memoryEntries = files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    );

    expect(memoryEntries).toHaveLength(0);
  });
});

describe("filterBootstrapFilesForSession", () => {
  it("keeps only AGENTS.md and TOOLS.md for subagent sessions", () => {
    const files = [
      { name: DEFAULT_AGENTS_FILENAME, path: "/tmp/AGENTS.md", missing: false, content: "a" },
      { name: DEFAULT_TOOLS_FILENAME, path: "/tmp/TOOLS.md", missing: false, content: "t" },
      { name: DEFAULT_SOUL_FILENAME, path: "/tmp/SOUL.md", missing: false, content: "s" },
    ];
    const filtered = filterBootstrapFilesForSession(files, "agent:main:subagent:abc");
    expect(filtered.map((file) => file.name)).toEqual([
      DEFAULT_AGENTS_FILENAME,
      DEFAULT_TOOLS_FILENAME,
    ]);
  });

  it("keeps only AGENTS.md and TOOLS.md for cron sessions", () => {
    const files = [
      { name: DEFAULT_AGENTS_FILENAME, path: "/tmp/AGENTS.md", missing: false, content: "a" },
      { name: DEFAULT_TOOLS_FILENAME, path: "/tmp/TOOLS.md", missing: false, content: "t" },
      { name: DEFAULT_SOUL_FILENAME, path: "/tmp/SOUL.md", missing: false, content: "s" },
    ];
    const filtered = filterBootstrapFilesForSession(files, "agent:main:cron:job-1");
    expect(filtered.map((file) => file.name)).toEqual([
      DEFAULT_AGENTS_FILENAME,
      DEFAULT_TOOLS_FILENAME,
    ]);
  });

  it("leaves non-subagent/non-cron sessions unchanged", () => {
    const files = [
      { name: DEFAULT_AGENTS_FILENAME, path: "/tmp/AGENTS.md", missing: false, content: "a" },
      { name: DEFAULT_TOOLS_FILENAME, path: "/tmp/TOOLS.md", missing: false, content: "t" },
      { name: DEFAULT_SOUL_FILENAME, path: "/tmp/SOUL.md", missing: false, content: "s" },
    ];
    const filtered = filterBootstrapFilesForSession(files, "agent:main:main");
    expect(filtered.map((file) => file.name)).toEqual([
      DEFAULT_AGENTS_FILENAME,
      DEFAULT_TOOLS_FILENAME,
      DEFAULT_SOUL_FILENAME,
    ]);
  });
});
