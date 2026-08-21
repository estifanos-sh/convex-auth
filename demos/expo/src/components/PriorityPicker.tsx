import React from "react";
import { Text, Pressable, ScrollView } from "react-native";

import { colors, priorityColors, spacing, fontSize, radius } from "@/src/theme";

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
type Priority = (typeof PRIORITIES)[number];
const LABELS = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
} as const satisfies Record<(typeof PRIORITIES)[number], string>;

export const PriorityPicker = React.memo(function PriorityPicker({
  value,
  onSelect,
}: {
  value: Priority | "none";
  onSelect: (priority: Priority) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
      }}
    >
      {PRIORITIES.map((priority) => {
        const active = value === priority;
        const c = priorityColors[priority];
        return (
          <Pressable
            key={priority}
            onPress={() => onSelect(priority)}
            style={({ pressed }) => ({
              paddingHorizontal: spacing.lg - 2,
              paddingVertical: spacing.sm - 1,
              borderRadius: radius.full,
              borderWidth: 1,
              borderCurve: "continuous",
              backgroundColor: active
                ? c.bg
                : pressed
                  ? colors.background.tertiary
                  : colors.background.secondary,
              borderColor: active ? c.border : colors.border.transparent,
            })}
          >
            <Text
              style={{
                fontSize: fontSize.sm + 1,
                color: active ? c.text : colors.warm[600],
                fontWeight: active ? "600" : "400",
              }}
            >
              {LABELS[priority]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});
