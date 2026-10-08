/** Diagnostics are observational; a broken sink must never become a gate. */
export function reportDiagnostic(message: string): boolean {
  try {
    console.warn(message);
    return true;
  } catch {
    return false;
  }
}
