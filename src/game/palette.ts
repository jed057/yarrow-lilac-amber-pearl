/** Stone, cloth, and sky. One palette for geometry and UI tokens. */
export const PALETTE = {
  cream: "#F3E6D4",
  creamDeep: "#E4D2C0",
  coral: "#E39A8C",
  coralDeep: "#C45C4A",
  teal: "#8FBFC8",
  tealDeep: "#3E8E9A",
  gold: "#C6A15B",
  ink: "#2A211C",
  skin: "#F0D2C4",
  dress: "#F7F1EA",
  sky: "#F6D3C4",
  sun: "#F8E6D2",
  water: "#7EAEB8",
} as const;

export function colorForHeight(y: number): string {
  if (y <= 0) return PALETTE.teal;
  if (y === 1) return PALETTE.cream;
  if (y === 2) return PALETTE.creamDeep;
  if (y === 3) return PALETTE.coral;
  return PALETTE.coralDeep;
}
