import { registerTools } from "../../registry";
import { grokLineDomainTools } from "./handlers";

registerTools(grokLineDomainTools);

export {
  grokSendMessageDefinition,
  grokLineDomainDefinitions,
} from "./definitions";

export { grokLineDomainTools } from "./handlers";
