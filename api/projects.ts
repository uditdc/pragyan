import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  Directive,
  DirectiveState,
  Project,
  ProjectDef,
  Session,
  SessionPhase,
  SessionStatus,
  Steer,
  SteerStatus,
} from "../shared/project.ts";
import type { Config } from "./config.ts";

const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");
const ACTIVE_MS = 3 * 60_000;
const MAX_SESSIONS = 10;

// Claude Code encodes a project's cwd into a directory name by replacing every
// non-alphanumeric character with a dash (verified against on-disk dir names).
function encodeClaudeDir(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

function shortenModel(model: string | undefined): string {
  if (!model) return "agent";
  const m = model.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/);
  return m ? `${m[1]}-${m[2]}.${m[3]}` : model;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "directive";
}

function relAge(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

interface JsonlLine {
  type?: string;
  timestamp?: string;
  gitBranch?: string;
  isMeta?: boolean;
  message?: { role?: string; model?: string; content?: unknown };
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function basename(p: unknown): string {
  return typeof p === "string" ? p.split("/").pop() ?? p : "";
}

function describeTool(name: string, input: Record<string, unknown> = {}): string {
  switch (name) {
    case "Edit":
    case "Write":
    case "Read":
    case "NotebookEdit":
      return `${name.toLowerCase()} ${basename(input.file_path ?? input.notebook_path)}`;
    case "Bash":
      return `bash ${String(input.command ?? "").replace(/\s+/g, " ").slice(0, 40)}`;
    case "Grep":
      return `grep ${String(input.pattern ?? "")}`;
    case "Glob":
      return `glob ${String(input.pattern ?? "")}`;
    case "Task":
      return `task ${String(input.description ?? "")}`;
    case "WebFetch":
      return `fetch ${String(input.url ?? "")}`;
    default:
      return name;
  }
}

// A short human label for the most recent thing the agent did in a turn.
function assistantActivity(content: unknown): string | null {
  if (typeof content === "string") {
    const line = content.trim().split("\n")[0];
    return line ? line.slice(0, 56) : null;
  }
  if (!Array.isArray(content)) return null;
  const blocks = content as ContentBlock[];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === "tool_use" && b.name) return describeTool(b.name, b.input);
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === "text" && b.text?.trim()) return b.text.trim().split("\n")[0].slice(0, 56);
  }
  return null;
}

// A user line counts as the session's "task" only if it carries real human text —
// not a slash-command echo, local-command caveat, or tool result.
function userText(line: JsonlLine): string | null {
  if (line.type !== "user" || line.isMeta) return null;
  const content = line.message?.content;
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  if (!trimmed || trimmed.startsWith("<")) return null;
  return trimmed.split("\n")[0].slice(0, 96);
}

// Orchestrator-spawned phase sessions open with `[assessment|work|review] DIR-NNN — …`.
// Pull the phase tag and strip it (and the code) so the task reads cleanly.
function splitPhase(task: string): { phase: SessionPhase | null; task: string } {
  const m = task.match(/^\[(assessment|work|review)\]\s*/i);
  if (!m) return { phase: null, task: task.slice(0, 64) };
  const rest = task.slice(m[0].length).replace(/^DIR-\d+\s*[—–-]+\s*/i, "");
  return { phase: m[1].toLowerCase() as SessionPhase, task: rest.slice(0, 64) };
}

function parseSession(filePath: string, id: string): Session | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const mtime = statSync(filePath).mtimeMs;

  let model: string | undefined;
  let branch: string | null = null;
  let task = "";
  let iter = 0;
  let lastTs: string | undefined;
  let lastRole: string | undefined;
  let lastActivity = "";

  for (const raw_line of raw.split("\n")) {
    if (!raw_line) continue;
    let line: JsonlLine;
    try {
      line = JSON.parse(raw_line) as JsonlLine;
    } catch {
      continue;
    }
    if (line.gitBranch) branch = line.gitBranch;
    if (line.timestamp) lastTs = line.timestamp;
    if (line.type === "assistant") {
      iter++;
      if (line.message?.model) model = line.message.model;
      lastRole = "assistant";
      const act = assistantActivity(line.message?.content);
      if (act) lastActivity = act;
    } else if (line.type === "user" && !line.isMeta) {
      lastRole = "user";
      if (!task) {
        const t = userText(line);
        if (t) task = t;
      }
    }
  }

  const ageMs = Date.now() - mtime;
  const status: SessionStatus =
    ageMs < ACTIVE_MS ? (lastRole === "user" ? "wait" : "run") : "done";
  const { phase, task: cleanTask } = splitPhase(task);

  return {
    id,
    model: shortenModel(model),
    task: cleanTask || "session",
    branch,
    status,
    phase,
    iter,
    last_active: lastTs ?? new Date(mtime).toISOString(),
    last_activity: lastActivity || "—",
    dir_codes: [...new Set(raw.match(/\bDIR-\d{3,}\b/g) ?? [])],
  };
}

// A directive is worked on its own git worktree, so its phase sessions live under
// the worktree's encoded path — not the project's. Discover across both: the main
// checkout plus every linked worktree.
function sessionRoots(projectPath: string): string[] {
  const roots = new Set<string>([projectPath]);
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: projectPath,
      encoding: "utf8",
    });
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) roots.add(line.slice("worktree ".length).trim());
    }
  } catch {
    /* not a git repo, or git unavailable — main checkout only */
  }
  return [...roots];
}

function listSessions(projectPath: string): Session[] {
  const candidates: { path: string; m: number }[] = [];
  for (const root of sessionRoots(projectPath)) {
    const dir = join(CLAUDE_PROJECTS, encodeClaudeDir(root));
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".jsonl")) {
          const path = join(dir, f);
          candidates.push({ path, m: statSync(path).mtimeMs });
        }
      }
    } catch {
      /* no sessions for this root */
    }
  }
  return candidates
    .sort((a, b) => b.m - a.m)
    .slice(0, MAX_SESSIONS)
    .map(({ path }) => parseSession(path, path.split("/").pop()!.replace(/\.jsonl$/, "")))
    .filter((s): s is Session => s !== null);
}

// ── directives — markdown work-orders in <project>/.agents/directives ────────
// Each directive is a top-level work-order with a stable DIR-NNN code. Sessions
// spawned for it reference that code in their transcript and are matched back.
const DIRECTIVE_STATES: DirectiveState[] = ["empty", "pending", "active", "done"];

function directivesDir(projectPath: string): string {
  return join(projectPath, ".agents", "directives");
}

// Directives are authored by the `create-directive` skill (which writes the
// markdown directly) following <project>/.agents/directives/_template.md.
function codeOf(fm: Record<string, string | string[]>, file: string): string {
  const fromFm = typeof fm.code === "string" ? fm.code.trim() : "";
  if (/^DIR-\d+$/.test(fromFm)) return fromFm;
  const fromName = file.match(/^(DIR-\d+)/);
  return fromName ? fromName[1] : "";
}

// Minimal frontmatter reader: scalar `key: value` plus an `objectives:` list of
// `- item` lines. Enough for our fixed directive schema without a YAML dep.
function parseFrontmatter(raw: string): Record<string, string | string[]> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of match[1].split("\n")) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (listKey && item) {
      (out[listKey] as string[]).push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === "") {
      listKey = key;
      out[key] = [];
    } else {
      listKey = null;
      out[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const STEER_STATES: SteerStatus[] = ["pending", "active", "addressed"];

// Parse the `## Steering` section into ordered steers. HTML comments (the
// template's usage note) are stripped first so their examples aren't read as
// real entries. A `↳ <note>` line attaches the agent's memory to the steer above.
function parseSteers(raw: string): Steer[] {
  const body = raw.replace(/^---\n[\s\S]*?\n---/, "").replace(/<!--[\s\S]*?-->/g, "");
  const section = body.split(/^##\s+Steering\s*$/m)[1];
  if (!section) return [];
  const steers: Steer[] = [];
  for (const line of section.split("\n")) {
    const entry = line.match(/^-\s*\[(\w+)\]\s*(.*)$/);
    if (entry) {
      const status = (STEER_STATES as string[]).includes(entry[1])
        ? (entry[1] as SteerStatus)
        : "pending";
      steers.push({ status, text: entry[2].trim() });
      continue;
    }
    const note = line.match(/^\s+↳\s*(.*)$/);
    if (note && steers.length) {
      const last = steers[steers.length - 1];
      last.note = last.note ? `${last.note} ${note[1].trim()}` : note[1].trim();
    }
  }
  return steers;
}

function readDirectives(projectPath: string): Directive[] {
  const dir = directivesDir(projectPath);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      const filePath = join(dir, f);
      const raw = readFileSync(filePath, "utf8");
      const fm = parseFrontmatter(raw);
      const str = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : undefined);
      const state = DIRECTIVE_STATES.includes(str("state") as DirectiveState)
        ? (str("state") as DirectiveState)
        : "empty";
      const num = (k: string) => {
        const v = str(k);
        return v != null && v !== "" ? Number(v) : undefined;
      };
      return {
        id: f.replace(/\.md$/, ""),
        code: codeOf(fm, f),
        state,
        title: str("title") ?? f.replace(/\.md$/, "").replace(/-/g, " "),
        objectives: Array.isArray(fm.objectives) ? (fm.objectives as string[]) : [],
        step: num("step"),
        steps: num("steps"),
        session: str("session"),
        branch: str("branch"),
        commits: str("commits"),
        age: str("age") ?? relAge(Date.now() - statSync(filePath).mtimeMs),
        sessions: [] as Session[],
        steers: parseSteers(raw),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

function findDirectiveFile(projectPath: string, code: string): string | null {
  const dir = directivesDir(projectPath);
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md") || f.startsWith("_")) continue;
      const fm = parseFrontmatter(readFileSync(join(dir, f), "utf8"));
      if (codeOf(fm, f) === code) return join(dir, f);
    }
  } catch {
    /* no directives dir */
  }
  return null;
}

// Append a user steer to a directive's `## Steering` section as `- [pending]`.
// The agentic loop later flips it to [addressed] and adds its note (see template).
export function appendSteer(projectPath: string, code: string, text: string): Steer | null {
  const filePath = findDirectiveFile(projectPath, code);
  if (!filePath) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  let raw = readFileSync(filePath, "utf8");
  if (!/^##\s+Steering\s*$/m.test(raw)) raw = `${raw.replace(/\s*$/, "")}\n\n## Steering\n`;
  writeFileSync(filePath, `${raw.replace(/\s*$/, "")}\n- [pending] ${clean}\n`, "utf8");
  return { status: "pending", text: clean };
}

function buildProject(def: ProjectDef): Project {
  const sessions = listSessions(def.path);
  const directives = readDirectives(def.path);
  for (const d of directives) {
    d.sessions = d.code ? sessions.filter((s) => s.dir_codes.includes(d.code)) : [];
  }
  return {
    id: slugify(def.name),
    name: def.name,
    path: def.path,
    repo: def.repo,
    sessions,
    directives,
  };
}

export function getProjects(config: Config): Project[] {
  return (config.projects ?? []).map(buildProject);
}

export function findProject(config: Config, id: string): ProjectDef | undefined {
  return (config.projects ?? []).find((p) => slugify(p.name) === id);
}
