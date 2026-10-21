/**
 * Assigns the concrete editor column for a chat that was opened with
 * `ViewColumn.Beside` once exactly one terminal tab appears.
 */
export function columnForUnplacedTerminal(
  openedTerminalColumns: readonly number[],
  unplacedCount: number,
  besideColumn: number,
): number | undefined {
  if (unplacedCount !== 1) {
    return undefined;
  }
  const concrete = openedTerminalColumns.filter(
    (column) => column !== besideColumn,
  );
  return concrete.length === 1 ? concrete[0] : undefined;
}
