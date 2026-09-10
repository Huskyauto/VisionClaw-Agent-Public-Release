type StablePersonaDocRow = {
  id: number;
  name: string;
};

function sortByStableIdentity<T extends StablePersonaDocRow>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => left.id - right.id || left.name.localeCompare(right.name));
}

/**
 * Database row order is not a contract. Normalize inputs that are rendered
 * into persona tools_doc so every sync process writes identical bytes.
 */
export function canonicalizePersonaToolsDocInputs<
  TCustom extends StablePersonaDocRow,
  TSkill extends StablePersonaDocRow,
>(customTools: readonly TCustom[], enabledSkills: readonly TSkill[]): {
  customTools: TCustom[];
  enabledSkills: TSkill[];
} {
  return {
    customTools: sortByStableIdentity(customTools),
    enabledSkills: sortByStableIdentity(enabledSkills),
  };
}