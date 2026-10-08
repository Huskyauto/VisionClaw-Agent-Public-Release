export async function finalizePlanExecution(args: {
  commitTerminalState: () => Promise<void>;
  appendTerminalAdvisory: () => Promise<unknown>;
}): Promise<void> {
  await args.commitTerminalState();
  await args.appendTerminalAdvisory();
}