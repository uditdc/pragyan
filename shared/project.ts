export type SessionStatus = "run" | "wait" | "block" | "review" | "done";
export type SessionPhase = "assessment" | "work" | "review";
export type DirectiveState = "empty" | "pending" | "active" | "done";
export type SteerStatus = "pending" | "active" | "addressed";

export interface Steer {
  status: SteerStatus;
  text: string;
  note?: string;
}

export interface Session {
  id: string;
  model: string;
  task: string;
  branch: string | null;
  status: SessionStatus;
  phase: SessionPhase | null;
  iter: number;
  last_active: string;
  last_activity: string;
  dir_codes: string[];
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
