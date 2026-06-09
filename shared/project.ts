export type SessionStatus = "run" | "wait" | "block" | "review" | "done";
export type SessionPhase = "assessment" | "work" | "review";
export type DirectiveState = "empty" | "pending" | "active" | "done";
export type SteerStatus = "pending" | "active" | "addressed";

export interface Steer {
  status: SteerStatus;
  text: string;
  note?: string;
}

export interface SubAgent {
  id: string;
  agent_type: string;
  description: string;
  phase: SessionPhase | null;
  codes: string[];
  status: SessionStatus;
  last_active: string;
}

export interface Session {
  id: string;
  model: string;
  task: string;
  branch: string | null;
  status: SessionStatus;
  iter: number;
  last_active: string;
  last_activity: string;
  subagents: SubAgent[];
}

export interface Directive {
  id: string;
  code: string;
  state: DirectiveState;
  title: string;
  objectives: string[];
  step?: number;
  steps?: number;
  session?: string;
  branch?: string;
  commits?: string;
  age?: string;
  // true once the directive is `done` on the main tree (PR merged); while it is
  // `done` only on the branch/worktree it reads as committed-but-not-yet-merged.
  merged: boolean;
  sessions: Session[];
  steers: Steer[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  repo?: string;
  sessions: Session[];
  directives: Directive[];
}

export interface ProjectsResponse {
  projects: Project[];
}

export interface ProjectDef {
  name: string;
  path: string;
  repo?: string;
}
