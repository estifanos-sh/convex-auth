import React from "react";
import Svg, { Path } from "react-native-svg";

import { colors } from "@/src/theme";

/** Shared props for all glyph icons. */
export interface IconProps {
  size?: number;
  color?: string;
}

const DEFAULT_SIZE = 16;
const DEFAULT_COLOR = colors.content.primary;

/**
 * Plus glyph. Path sourced from `@radix-ui/react-icons` (PlusIcon), rendered as
 * a crisp 15x15 SVG to match the Convex dashboard iconography.
 */
export function Plus({ size = DEFAULT_SIZE, color = DEFAULT_COLOR }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 15 15" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 2.75C8 2.47386 7.77614 2.25 7.5 2.25C7.22386 2.25 7 2.47386 7 2.75V7H2.75C2.47386 7 2.25 7.22386 2.25 7.5C2.25 7.77614 2.47386 8 2.75 8H7V12.25C7 12.5261 7.22386 12.75 7.5 12.75C7.77614 12.75 8 12.5261 8 12.25V8H12.25C12.5261 8 12.75 7.77614 12.75 7.5C12.75 7.22386 12.5261 7 12.25 7H8V2.75Z"
        fill={color}
      />
    </Svg>
  );
}

/** Right chevron glyph. Path sourced from `@radix-ui/react-icons` (ChevronRightIcon). */
export function ChevronRight({ size = DEFAULT_SIZE, color = DEFAULT_COLOR }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 15 15" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.18194 4.18185C6.35767 4.00611 6.64243 4.00611 6.81816 4.18185L9.81816 7.18185C9.9939 7.35759 9.9939 7.64231 9.81816 7.81805L6.81816 10.8181C6.64243 10.9938 6.35767 10.9938 6.18194 10.8181C6.0062 10.6423 6.0062 10.3576 6.18194 10.1819L8.86374 7.49995L6.18194 4.81815C6.0062 4.64241 6.0062 4.35759 6.18194 4.18185Z"
        fill={color}
      />
    </Svg>
  );
}

/** Check glyph. Path sourced from `@radix-ui/react-icons` (CheckIcon). */
export function Check({ size = DEFAULT_SIZE, color = DEFAULT_COLOR }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 15 15" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.5553 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z"
        fill={color}
      />
    </Svg>
  );
}

/** Trash glyph. Path sourced from `@radix-ui/react-icons` (TrashIcon). */
export function Trash({ size = DEFAULT_SIZE, color = DEFAULT_COLOR }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 15 15" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.5 1C5.22386 1 5 1.22386 5 1.5C5 1.77614 5.22386 2 5.5 2H9.5C9.77614 2 10 1.77614 10 1.5C10 1.22386 9.77614 1 9.5 1H5.5ZM3 3.5C3 3.22386 3.22386 3 3.5 3H5H10H11.5C11.7761 3 12 3.22386 12 3.5C12 3.77614 11.7761 4 11.5 4H11V12C11 12.5523 10.5523 13 10 13H5C4.44772 13 4 12.5523 4 12V4L3.5 4C3.22386 4 3 3.77614 3 3.5ZM5 4H10V12H5V4Z"
        fill={color}
      />
    </Svg>
  );
}

/** Pencil glyph. Path sourced from `@radix-ui/react-icons` (Pencil1Icon). */
export function Pencil({ size = DEFAULT_SIZE, color = DEFAULT_COLOR }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 15 15" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.8536 1.14645C11.6583 0.951184 11.3417 0.951184 11.1465 1.14645L3.71455 8.57836C3.62459 8.66832 3.55263 8.77461 3.50251 8.89155L2.04044 12.303C1.9599 12.491 2.00189 12.709 2.14646 12.8536C2.29103 12.9981 2.50905 13.0401 2.69697 12.9596L6.10847 11.4975C6.2254 11.4474 6.3317 11.3754 6.42166 11.2855L13.8536 3.85355C14.0488 3.65829 14.0488 3.34171 13.8536 3.14645L11.8536 1.14645ZM4.42166 9.28547L11.5 2.20711L12.7929 3.5L5.71455 10.5784L4.21924 11.2192L3.78081 10.7808L4.42166 9.28547Z"
        fill={color}
      />
    </Svg>
  );
}
