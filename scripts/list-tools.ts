import { TOOL_DEFINITIONS } from "../server/tools";
const names = TOOL_DEFINITIONS.map((t:any) => t.function.name);
console.log("COUNT:" + names.length);
console.log(names.join("\n"));
process.exit(0);
