import { registerTools } from "../../registry";
import { instinctLineDomainTools } from "./handlers";

registerTools(instinctLineDomainTools);

export {
  instinctSendMessageDefinition,
  instinctLineDomainDefinitions,
} from "./definitions";

export { instinctLineDomainTools } from "./handlers";