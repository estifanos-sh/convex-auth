export const colors = {
  background: {
    brand: "#1e1c1a",
    primary: "#1e1c1a",
    secondary: "#2a2825",
    tertiary: "#3c3a37",
    highlight: "#6d5217",
    success: "#2c5314",
    warning: "#6d5217",
    error: "#6b211f",
  },
  content: {
    primary: "#ffffff",
    secondary: "#b9b1aa",
    tertiary: "#97908a",
    accent: "#63a8f8",
    success: "#b4ec92",
    warning: "#e6e2a8",
    error: "#ffcac1",
  },
  border: {
    transparent: "rgba(163, 156, 148, 0.3)",
    selected: "#e1d7cd",
  },
  brand: {
    red: "#ee342f",
    purple: "#8d2676",
    yellow: "#f3b01c",
  },
  accent: {
    300: "#ffcac1",
    400: "#fd4c41",
    500: "#ee342f",
    600: "#da2b25",
  },
  util: {
    accent: "rgb(63, 82, 149)",
    accentHover: "rgb(56, 73, 132)",
    accentBorder: "rgba(255, 255, 255, 0.3)",
  },
  warm: {
    50: "#1e1c1a",
    100: "#3c3a37",
    200: "rgba(163, 156, 148, 0.3)",
    300: "rgba(163, 156, 148, 0.3)",
    400: "#97908a",
    500: "#b9b1aa",
    600: "#b9b1aa",
    700: "#ffffff",
    800: "#ffffff",
    900: "#ffffff",
  },
  success: "#b4ec92",
  urgent: "#ffcac1",
  white: "#2a2825",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
} as const;

export const fontSize = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  "2xl": 22,
  "3xl": 28,
} as const;

export const lineHeight = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 22,
  xl: 24,
  "2xl": 28,
  "3xl": 34,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  full: 999,
} as const;

export const shadows = {
  sm: { boxShadow: "0 1px 2px rgba(0, 0, 0, 0.22)" },
  md: { boxShadow: "0 12px 32px rgba(0, 0, 0, 0.24)" },
  lg: { boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)" },
  accent: { boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)" },
  segment: { boxShadow: "0 1px 3px rgba(0, 0, 0, 0.28)" },
} as const;

export const priorityColors = {
  none: {
    bg: colors.warm[50],
    text: colors.warm[500],
    border: colors.warm[200],
  },
  urgent: {
    bg: "rgba(238, 52, 47, 0.18)",
    text: colors.content.error,
    border: "rgba(238, 52, 47, 0.48)",
  },
  high: {
    bg: "rgba(238, 52, 47, 0.12)",
    text: colors.content.error,
    border: "rgba(238, 52, 47, 0.38)",
  },
  medium: {
    bg: "rgba(243, 176, 28, 0.12)",
    text: colors.content.warning,
    border: "rgba(243, 176, 28, 0.34)",
  },
  low: {
    bg: colors.warm[100],
    text: colors.warm[600],
    border: colors.warm[300],
  },
} as const;

export const statusColors = {
  in_progress: colors.content.accent,
  todo: colors.warm[500],
  backlog: colors.warm[400],
  done: colors.success,
  cancelled: colors.warm[300],
} as const;

/**
 * Semantic UI recipes mirroring the Convex dashboard design system. Each entry
 * is a plain style object consumable directly by `StyleSheet.create` or inline
 * `style` props. Pressed/active variants replace web focus rings.
 */
export const recipes = {
  buttonAccent: {
    backgroundColor: colors.util.accent,
    borderWidth: 1,
    borderColor: colors.util.accentBorder,
    borderRadius: radius.md,
    borderCurve: "continuous",
  },
  buttonAccentPressed: {
    backgroundColor: colors.util.accentHover,
  },
  buttonAccentLabel: {
    color: colors.content.primary,
    fontWeight: "600",
  },
  buttonNeutral: {
    backgroundColor: "transparent",
    borderRadius: radius.md,
    borderCurve: "continuous",
  },
  buttonNeutralPressed: {
    backgroundColor: colors.background.tertiary,
  },
  buttonNeutralLabel: {
    color: colors.content.primary,
    fontWeight: "600",
  },
  buttonDangerLabel: {
    color: colors.content.error,
    fontWeight: "600",
  },
  buttonDangerPressed: {
    backgroundColor: colors.background.error,
  },
  input: {
    backgroundColor: colors.background.secondary,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.border.transparent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 1,
    color: colors.content.primary,
  },
  inputFocused: {
    borderColor: colors.border.selected,
  },
  card: {
    backgroundColor: colors.background.secondary,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.border.transparent,
  },
  sheet: {
    backgroundColor: colors.background.secondary,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.border.transparent,
    boxShadow: shadows.lg.boxShadow,
  },
  segmentTrack: {
    backgroundColor: colors.background.tertiary,
    borderRadius: radius.full,
    borderCurve: "continuous",
  },
  segmentActive: {
    backgroundColor: colors.background.secondary,
    borderRadius: radius.full,
    boxShadow: shadows.segment.boxShadow,
  },
  rowPressed: {
    backgroundColor: colors.background.tertiary,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border.transparent,
  },
} as const;
