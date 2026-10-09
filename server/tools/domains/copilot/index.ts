import { registerTools } from "../../registry";
import { copilotChatTool } from "./handlers";
registerTools([copilotChatTool]);
export { copilotChatDefinition } from "./definitions";
