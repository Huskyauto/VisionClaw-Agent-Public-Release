export const PROJECT_COMMANDS = [
  "create",
  "get",
  "list",
  "update",
  "get_state",
  "update_state",
  "get_compass",
  "update_compass",
  "add_file",
  "add_note",
  "link_conversation",
  "search",
] as const;

export type ProjectCommand = typeof PROJECT_COMMANDS[number];

type ProjectCommandResolution =
  | { ok: true; command: ProjectCommand }
  | { ok: false; error: string; allowedCommands: ProjectCommand[]; example: { command: "list" } };

export function resolveProjectCommand(params: Record<string, unknown>): ProjectCommandResolution {
  const raw = params.command ?? params.operation ?? params.action;
  if (typeof raw !== "string" || !raw.trim()) {
    return {
      ok: false,
      error: "Project command is required",
      allowedCommands: [...PROJECT_COMMANDS],
      example: { command: "list" },
    };
  }
  const command = raw.trim();
  if (!(PROJECT_COMMANDS as readonly string[]).includes(command)) {
    return {
      ok: false,
      error: `Unknown project command: ${command}`,
      allowedCommands: [...PROJECT_COMMANDS],
      example: { command: "list" },
    };
  }
  return { ok: true, command: command as ProjectCommand };
}