import React from "react";
import { View, Text, StyleSheet } from "react-native";

import { priorityColors, fontSize, spacing } from "@/src/theme";

type IssuePriority = "none" | "low" | "medium" | "high" | "urgent";

const PRIORITY_LABELS = {
  none: "",
  low: "Low",
  medium: "Med",
  high: "High",
  urgent: "Urgent",
} as const satisfies Record<IssuePriority, string>;

export const PriorityChip = React.memo(function PriorityChip({
  priority,
}: {
  priority: IssuePriority;
}) {
  if (priority === "none") return null;
  const c = priorityColors[priority];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[styles.label, { color: c.text }]}>{PRIORITY_LABELS[priority]}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.sm - 1,
    paddingVertical: 2,
    borderRadius: spacing.xs + 2,
    borderWidth: 1,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: "600",
  },
});
