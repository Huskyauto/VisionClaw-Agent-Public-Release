import { registerTools } from "../../registry";
import { sparkLineDomainTools } from "./handlers";

registerTools(sparkLineDomainTools);

export {
  sparkSendMessageDefinition,
  sparkLineDomainDefinitions,
} from "./definitions";

export { sparkLineDomainTools } from "./handlers";