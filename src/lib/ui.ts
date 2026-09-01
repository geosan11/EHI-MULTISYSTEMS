// Shared UI scale constants.
//
// The codebase currently passes ~25 distinct `size={N}` values to lucide icons
// (8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32, 36, 40, 44, ...).
// New/refactored code should pick from this 5-step scale instead so icon sizing
// reads as one system. Values are px (lucide's `size` prop unit).
//
//   xs  12  — dense inline chips, table-cell affordances, tag rows
//   sm  14  — default inline icon next to a label
//   md  16  — buttons, list-item leading icons, modal close controls
//   lg  20  — section headers, empty-state glyphs at small size
//   xl  24  — page headers, prominent status / hero glyphs
export const ICON = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

export type IconSize = (typeof ICON)[keyof typeof ICON];
