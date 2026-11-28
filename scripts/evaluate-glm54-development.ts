import { runGlm54Trial } from "./lib/glm54-development-trial";

const report = await runGlm54Trial(process.argv.slice(2), process.env);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === "passed" ? 0 : report.status === "not_passed" ? 2 : 1;
