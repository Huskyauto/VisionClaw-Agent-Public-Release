import type { ToolDefinition } from "../../types";

export const getDailyNotesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "get_daily_notes",
    description: "Use when reconstructing what happened on a specific day (\"what did we ship Tuesday\"), when picking up after time away, or when auditing agent activity. Returns the activity log + agent notes for the requested date or recent N days. Pair with sessions_history for full transcript content.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date in YYYY-MM-DD format. If omitted, returns last 7 days." },
      },
      required: [],
    },
  },
};

export const listConversationsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_conversations",
    description: "Use when Bob asks \"find the chat where we discussed X\" or when continuing work from a prior session and you need the conversation_id. Returns recent conversations with title, date, model, and message count. Pair with sessions_history for the actual transcript content.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max conversations to return (default 20)" },
      },
      required: [],
    },
  },
};

export const writeDailyNoteDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "write_daily_note",
    description: "Write or append to today's daily notes. Use to log important events, decisions, lessons learned, or anything worth recording during the conversation. Memory rule: if you want to remember it, write it down NOW.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to write — events, decisions, lessons, or notes" },
        section: { type: "string", enum: ["events", "decisions", "lessons", "tomorrow"], description: "Which section to write to (default: events)" },
      },
      required: ["content"],
    },
  },
};