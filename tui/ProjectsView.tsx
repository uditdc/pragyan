import { Box, Text } from "ink";
import type {
  Directive,
  DirectiveState,
  Project,
  Session,
  SessionPhase,
  SessionStatus,
  SteerStatus,
} from "../shared/project.ts";
import { P } from "./theme.ts";
import { relativeTime } from "./format.ts";
import { Panel } from "./Panel.tsx";

const RAIL_W = 32;

const SS: Record<SessionStatus, { g: string; c: string; label: string }> = {
  run: { g: "●", c: P.accent, label: "iterating" },
  wait: { g: "◐", c: P.news, label: "awaiting input" },
  block: { g: "✗", c: P.down, label: "blocked" },
  review: { g: "◆", c: P.x, label: "in review" },
  done: { g: "✓", c: P.faint, label: "idle" },
};

const DST: Record<DirectiveState, { g: string; c: string; label: string }> = {
  empty: { g: "○", c: P.faint, label: "no plan" },
  pending: { g: "◔", c: P.news, label: "plan set" },
  active: { g: "◑", c: P.accent, label: "implementing" },
  done: { g: "✓", c: P.up, label: "committed" },
};

const STEER: Record<SteerStatus, { g: string; c: string }> = {
  pending: { g: "○", c: P.news },
  active: { g: "◑", c: P.accent },
  addressed: { g: "✓", c: P.up },
};

const PHASE: Record<SessionPhase, { label: string; c: string }> = {
  assessment: { label: "assess", c: P.news },
  work: { label: "work", c: P.accent },
  review: { label: "review", c: P.x },
};

interface Props {
  projects: Project[];
  projectIdx: number;
  dirIdx: number;
  composing: boolean;
  composeText: string;
  width: number;
  height: number;
  now: number;
  online: boolean;
}

export function ProjectsView({
  projects,
  projectIdx,
  dirIdx,
  composing,
  composeText,
  width,
  height,
  now,
  online,
}: Props) {
  const project = projects.length
    ? projects[Math.min(projectIdx, projects.length - 1)]
    : null;
  const live = projects.reduce(
    (n, p) => n + p.sessions.filter((s) => s.status !== "done").length,
    0,
  );
  const meta = (
    <Text color={P.faint}>
      {projects.length} projects · <Text color={P.accent}>{live}</Text> live
    </Text>
  );

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Panel
        icon="◆"
        iconColor={P.accent}
        title="PROJECTS"
        meta={projects.length ? meta : undefined}
        width={width - 2}
        flexGrow={1}
      >
        {!project ? (
          <Text color={P.faint}>
            {online ? "no projects configured — add to config.json `projects`" : "connecting…"}
          </Text>
        ) : (
          <Box flexDirection="row" flexGrow={1} minHeight={0} overflow="hidden">
            <ProjectRail projects={projects} projectIdx={projectIdx} now={now} />
            <ProjectMain
              project={project}
              dirIdx={dirIdx}
              composing={composing}
              composeText={composeText}
              now={now}
            />
          </Box>
        )}
      </Panel>
    </Box>
  );
}

function countBy(sessions: Session[], status: SessionStatus): number {
  return sessions.filter((s) => s.status === status).length;
}

// ── left rail ───────────────────────────────────────────────────────────────
function ProjectRail({
  projects,
  projectIdx,
  now,
}: {
  projects: Project[];
  projectIdx: number;
  now: number;
}) {
  const run = projects.reduce((n, p) => n + countBy(p.sessions, "run"), 0);
  const wait = projects.reduce((n, p) => n + countBy(p.sessions, "wait"), 0);
  const block = projects.reduce((n, p) => n + countBy(p.sessions, "block"), 0);

  return (
    <Box width={RAIL_W} flexShrink={0} flexDirection="column" overflow="hidden">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {projects.map((p, i) => (
          <ProjectRow key={p.id} project={p} selected={i === projectIdx} now={now} />
        ))}
      </Box>
      <Box flexShrink={0}>
        <Text color={P.faint}>
          <Text color={P.accent}>●</Text> {run} · <Text color={P.news}>◐</Text> {wait} ·{" "}
          <Text color={P.down}>✗</Text> {block}
        </Text>
      </Box>
    </Box>
  );
}

function ProjectRow({
  project,
  selected,
  now,
}: {
  project: Project;
  selected: boolean;
  now: number;
}) {
  const active = countBy(project.sessions, "run");
  const wait = countBy(project.sessions, "wait");
  const block = countBy(project.sessions, "block");
  const last = project.sessions[0]?.last_active;
  const head: SessionStatus = block ? "block" : wait ? "wait" : active ? "run" : "done";

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginBottom={1}
      paddingY={0}
      borderStyle="single"
      borderColor={selected ? P.accent : P.bg}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
    >
      <Box>
        <Text color={SS[head].c}>{SS[head].g} </Text>
        <Box flexGrow={1} minWidth={0}>
          <Text color={selected ? P.white : P.fg} bold={selected} wrap="truncate">
            {project.name}
          </Text>
        </Box>
        <Text color={P.faint}>{last ? relativeTime(last, now) : "—"}</Text>
      </Box>
      <Box paddingLeft={2} marginTop={0}>
        <Text color={P.dim} wrap="truncate">
          {active} active
          {wait ? <Text color={P.news}> · {wait} wait</Text> : null}
          {block ? <Text color={P.down}> · {block} blk</Text> : null}
        </Text>
        <Box flexGrow={1} />
        <SessionDots sessions={project.sessions} />
      </Box>
    </Box>
  );
}

function SessionDots({ sessions }: { sessions: Session[] }) {
  return (
    <Text>
      {sessions.slice(0, 6).map((s, i) => (
        <Text key={i} color={SS[s.status].c}>
          ·
        </Text>
      ))}
    </Text>
  );
}

// ── main pane ────────────────────────────────────────────────────────────────
function ProjectMain({
  project,
  dirIdx,
  composing,
  composeText,
  now,
}: {
  project: Project;
  dirIdx: number;
  composing: boolean;
  composeText: string;
  now: number;
}) {
  return (
    <Box
      flexGrow={1}
      minWidth={0}
      flexDirection="column"
      borderStyle="single"
      borderColor={P.rule}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingX={1}
      overflow="hidden"
    >
      <ProjectHeader project={project} />
      <DirectivesList
        directives={project.directives}
        dirIdx={dirIdx}
        composing={composing}
        composeText={composeText}
        now={now}
      />
    </Box>
  );
}

function ProjectHeader({ project }: { project: Project }) {
  const run = countBy(project.sessions, "run");
  const wait = countBy(project.sessions, "wait");
  const block = countBy(project.sessions, "block");
  return (
    <Box flexShrink={0}>
      <Box flexGrow={1} minWidth={0}>
        <Text wrap="truncate">
          <Text color={P.white} bold>
            {project.name}
          </Text>
          {project.repo ? <Text color={P.faint}> {project.repo}</Text> : null}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        <Text>
          <Text color={P.accent}>●</Text> <Text color={P.fg}>{run}</Text>{" "}
          <Text color={P.news}>◐</Text> <Text color={P.fg}>{wait}</Text>{" "}
          <Text color={P.down}>✗</Text> <Text color={P.fg}>{block}</Text>
          <Text color={P.faint}> · {project.directives.length} directives</Text>
        </Text>
      </Box>
    </Box>
  );
}

// One associated session inside a directive card — compact: status · model ·
// branch · age, with the live last-activity beneath.
function NestedSessionRow({ session, now }: { session: Session; now: number }) {
  const s = SS[session.status];
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box>
        <Box flexShrink={0}>
          <Text color={s.c}>{s.g} </Text>
          <Text color={P.fg}>{session.model}</Text>
          {session.phase ? (
            <Text color={PHASE[session.phase].c}> [{PHASE[session.phase].label}]</Text>
          ) : null}
        </Box>
        <Box flexGrow={1} minWidth={0}>
          {session.branch ? (
            <Text color={P.x} wrap="truncate">
              {"  "}⎇ {session.branch}
            </Text>
          ) : (
            <Text> </Text>
          )}
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text color={P.faint}>{relativeTime(session.last_active, now)}</Text>
        </Box>
      </Box>
      <Box paddingLeft={2}>
        <Text color={P.faint}>↳ </Text>
        <Box flexGrow={1} minWidth={0}>
          <Text color={P.dim} wrap="truncate">
            {session.last_activity}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// ── directives — the top-level work-orders for a project ─────────────────────
function DirectivesList({
  directives,
  dirIdx,
  composing,
  composeText,
  now,
}: {
  directives: Directive[];
  dirIdx: number;
  composing: boolean;
  composeText: string;
  now: number;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <Box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1} overflow="hidden">
        {directives.length === 0 ? (
          <Text color={P.faint}>
            no directives — create one with the <Text color={P.dim}>/create-directive</Text> skill
          </Text>
        ) : (
          directives.map((d, i) => (
            <DirCard key={d.id} directive={d} selected={i === dirIdx} now={now} />
          ))
        )}
      </Box>
      <Composer
        composing={composing}
        composeText={composeText}
        target={directives[dirIdx]?.code}
      />
    </Box>
  );
}

// Full-width work-order card — mirrors the design's DirCardFull: a framed box
// with a left accent border in the lifecycle colour, a state badge, the full
// plan with checked-off steps, and an assignment footer.
function DirCard({
  directive,
  selected,
  now,
}: {
  directive: Directive;
  selected: boolean;
  now: number;
}) {
  const d = DST[directive.state];
  const active = directive.state === "active";
  const steps = directive.steps ?? directive.objectives.length;
  const step = directive.step ?? 0;
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginBottom={1}
      paddingX={1}
      borderStyle="round"
      borderColor={selected ? P.accent : active ? P.accent : P.rule}
    >
      <Box>
        <Text color={d.c}>{d.g} </Text>
        {directive.code ? (
          <Box flexShrink={0}>
            <Text color={P.accent} bold>
              {directive.code}
            </Text>
            <Text color={P.faint}> · </Text>
          </Box>
        ) : null}
        <Box flexGrow={1} minWidth={0}>
          <Text color={P.fg} bold wrap="truncate">
            {directive.title}
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text color={d.c}>[ {d.label} ]</Text>
        </Box>
      </Box>

      {directive.state === "empty" ? (
        <Box paddingLeft={2} marginTop={1}>
          <Text color={P.faint} italic>
            agent is drafting a plan from your direction…
          </Text>
        </Box>
      ) : null}

      {directive.objectives.length > 0 ? (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          <Text color={P.faint} wrap="truncate">
            OBJECTIVES · {steps}{directive.state === "pending" ? " · preview before start" : ""}
          </Text>
          {directive.objectives.map((p, i) => {
            const num = i + 1;
            const done = active && num < step;
            const cur = active && num === step;
            const mark = done ? "✓" : cur ? "▸" : String(num);
            const color = done ? P.up : cur ? P.accent : P.faint;
            return (
              <Box key={i}>
                <Box flexShrink={0} width={2}>
                  <Text color={color}>{mark}</Text>
                </Box>
                <Box flexGrow={1} minWidth={0}>
                  <Text color={cur ? P.fg : done ? P.faint : P.dim} wrap="truncate">
                    {p}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      ) : null}

      {directive.state === "done" && directive.objectives.length === 0 ? (
        <Box paddingLeft={2} marginTop={1}>
          <Text color={P.faint}>
            {steps} objectives{directive.commits ? ` · ${directive.commits}` : ""}
          </Text>
        </Box>
      ) : null}

      {directive.session || directive.branch || directive.age || active ? (
        <Box paddingLeft={2} marginTop={1}>
          <Box flexGrow={1} minWidth={0}>
            <Text wrap="truncate">
              {directive.session ? <Text color={P.x}>{directive.session}  </Text> : null}
              {directive.branch ? <Text color={P.faint}>⎇ {directive.branch}</Text> : null}
              {active ? <Text color={P.accent}>  step {step}/{steps}</Text> : null}
              {directive.state === "done" && directive.commits ? (
                <Text color={P.up}>  {directive.commits}</Text>
              ) : null}
            </Text>
          </Box>
          {directive.age ? (
            <Box flexShrink={0} marginLeft={1}>
              <Text color={P.faint}>{directive.age}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      <Box flexDirection="column" paddingLeft={2} marginTop={1}>
        <Text color={P.faint}>
          SESSIONS{directive.sessions.length ? ` · ${directive.sessions.length}` : ""}
        </Text>
        {directive.sessions.length === 0 ? (
          <Text color={P.faint} italic>
            none yet — spawn a session referencing {directive.code || "this code"}
          </Text>
        ) : (
          directive.sessions.map((s) => (
            <NestedSessionRow key={s.id} session={s} now={now} />
          ))
        )}
      </Box>

      {directive.steers.length > 0 ? (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          <Text color={P.faint}>STEERING · {directive.steers.length}</Text>
          {directive.steers.map((st, i) => (
            <Box key={i} flexDirection="column">
              <Box>
                <Text color={STEER[st.status].c}>{STEER[st.status].g} </Text>
                <Box flexGrow={1} minWidth={0}>
                  <Text color={st.status === "addressed" ? P.dim : P.fg} wrap="truncate">
                    {st.text}
                  </Text>
                </Box>
              </Box>
              {st.note ? (
                <Box paddingLeft={2}>
                  <Text color={P.faint}>↳ </Text>
                  <Box flexGrow={1} minWidth={0}>
                    <Text color={P.dim} wrap="truncate">
                      {st.note}
                    </Text>
                  </Box>
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function Composer({
  composing,
  composeText,
  target,
}: {
  composing: boolean;
  composeText: string;
  target?: string;
}) {
  return (
    <Box
      flexShrink={0}
      paddingTop={1}
      borderStyle="single"
      borderColor={P.rule}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      <Text color={P.accent}>▸ </Text>
      {target ? (
        <Box flexShrink={0}>
          <Text color={P.accent} bold>
            {target}
          </Text>
          <Text color={P.faint}> </Text>
        </Box>
      ) : null}
      <Box flexGrow={1} minWidth={0}>
        {composing ? (
          <Text color={P.fg} wrap="truncate">
            {composeText}
            <Text color={P.accent}>▏</Text>
          </Text>
        ) : (
          <Text color={P.faint}>{target ? "steer this directive…" : "select a directive to steer"}</Text>
        )}
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        <Text color={P.faint} wrap="truncate">
          {composing ? (
            <>
              <Text color={P.dim}>enter</Text> steer · <Text color={P.dim}>esc</Text> cancel
            </>
          ) : (
            <>
              <Text color={P.dim}>i</Text> steer
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
}
