import { api } from "$convex/_generated/api";
import { useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { IssueRow } from "@/src/components/IssueRow";
import { SectionHeader } from "@/src/components/SectionHeader";
import { useDemoAuth } from "@/src/auth";
import { useAppClient } from "@/src/client";
import { useOverlayGuard } from "@/src/overlays";
import { useProjectSelection } from "@/src/selection";
import { colors, spacing, fontSize, lineHeight, radius, shadows, recipes } from "@/src/theme";
import { Plus } from "@/src/icons";
import { type GroupProject, useGroupData } from "@/src/groups";

const STATUS_ORDER = ["in_progress", "todo", "backlog", "done", "cancelled"] as const;

const STATUS_LABELS = {
  in_progress: "In Progress",
  todo: "Todo",
  backlog: "Backlog",
  done: "Done",
  cancelled: "Cancelled",
} as const satisfies Record<(typeof STATUS_ORDER)[number], string>;

export default function IssuesScreen() {
  const client = useAppClient();
  const { signOut } = useDemoAuth();
  const { group, projects } = useGroupData();
  const { selectedProjectId, setSelectedProjectId } = useProjectSelection();
  const { requestOverlay } = useOverlayGuard();
  const [readyForSync, setReadyForSync] = React.useState(false);
  const currentGroup = group?.selectedGroup ?? null;
  const [groupName, setGroupName] = React.useState("");
  const [projectName, setProjectName] = React.useState("");
  const [groupError, setGroupError] = React.useState<string | null>(null);
  const [projectError, setProjectError] = React.useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = React.useState(false);
  const [creatingProject, setCreatingProject] = React.useState(false);

  const fabScale = useSharedValue(0);
  React.useEffect(() => {
    if (readyForSync && currentGroup && selectedProjectId) {
      fabScale.value = withSpring(1, { damping: 12, stiffness: 180 });
    }
  }, [readyForSync, currentGroup, selectedProjectId, fabScale]);
  const fabStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabScale.value }],
  }));

  React.useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setReadyForSync(true);
    });
    return () => task.cancel();
  }, []);

  React.useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0]!._id);
    }
  }, [projects, selectedProjectId, setSelectedProjectId]);

  const selectedProject = React.useMemo<GroupProject | null>(
    () =>
      projects.find((project: GroupProject) => project._id === selectedProjectId) ??
      projects[0] ??
      null,
    [projects, selectedProjectId],
  );

  const issuesData = useQuery(
    api.issues.list,
    readyForSync && selectedProject ? { projectId: selectedProject._id } : "skip",
  );

  const issues = issuesData?.issues ?? [];
  type IssueItem = (typeof issues)[number];
  const sections = STATUS_ORDER.map((status) => ({
    title: STATUS_LABELS[status],
    data: issues.filter((issue: IssueItem) => issue.status === status),
  })).filter((section) => section.data.length > 0);

  const handleCreateIssue = React.useCallback(() => {
    if (!selectedProject) return;
    const title = `Issue ${Date.now().toString().slice(-4)}`;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void (async () => {
      const { issueId } = await client.mutation(api.issues.create, {
        projectId: selectedProject._id,
        title,
      });
      requestOverlay(`issue:${issueId}`, () => {
        router.push(`/issue/${issueId}`);
      });
    })();
  }, [client, requestOverlay, selectedProject]);

  const handleCreateGroup = React.useCallback(() => {
    const nextName = groupName.trim();
    if (nextName.length < 3) {
      setGroupError("Use at least 3 characters.");
      return;
    }
    setCreatingGroup(true);
    setGroupError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void client
      .mutation(api.groups.create, { name: nextName })
      .then(() => {
        setGroupName("");
      })
      .catch((error: unknown) => {
        setGroupError(error instanceof Error ? error.message : "Failed to create group.");
      })
      .finally(() => {
        setCreatingGroup(false);
      });
  }, [client, groupName]);

  const handleCreateProject = React.useCallback(() => {
    if (!currentGroup) return;
    const nextName = projectName.trim();
    if (!nextName) {
      setProjectError("Project name is required.");
      return;
    }
    const identifier =
      nextName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6) || "DEMO";
    setCreatingProject(true);
    setProjectError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void client
      .mutation(api.projects.create, {
        groupId: currentGroup.groupId,
        name: nextName,
        identifier,
        description: "",
      })
      .then(() => {
        setProjectName("");
      })
      .catch((error: unknown) => {
        setProjectError(error instanceof Error ? error.message : "Failed to create project.");
      })
      .finally(() => {
        setCreatingProject(false);
      });
  }, [client, currentGroup, projectName]);

  if (!readyForSync || group === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.util.accent} />
      </View>
    );
  }

  if (!currentGroup) {
    return (
      <View style={styles.emptyState}>
        <Animated.View
          entering={FadeInDown.duration(400).springify()}
          style={styles.emptyStateCard}
        >
          <Text style={styles.emptyStateEyebrow}>Group</Text>
          <Text style={styles.emptyStateTitle}>No group yet</Text>
          <Text style={styles.emptyStateText}>
            Create your first organization to start using the demo.
          </Text>
          <TextInput
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Organization name"
            placeholderTextColor={colors.warm[400]}
            style={styles.input}
          />
          <Pressable
            onPress={handleCreateGroup}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            disabled={creatingGroup}
          >
            {creatingGroup ? (
              <ActivityIndicator color={colors.content.primary} size="small" />
            ) : (
              <Text style={styles.primaryButtonLabel}>Create group</Text>
            )}
          </Pressable>
          {groupError && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{groupError}</Text>
            </View>
          )}
          <Pressable
            onPress={() => void signOut()}
            style={({ pressed }) => [
              styles.secondaryFullButton,
              pressed && styles.secondaryFullButtonPressed,
            ]}
          >
            <Text style={styles.secondaryFullButtonLabel}>Sign out</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  if (!selectedProject) {
    return (
      <View style={styles.emptyState}>
        <Animated.View
          entering={FadeInDown.duration(400).springify()}
          style={styles.emptyStateCard}
        >
          <Text style={styles.emptyStateEyebrow}>Project</Text>
          <Text style={styles.emptyStateTitle}>Create a project</Text>
          <Text style={styles.emptyStateText}>
            Projects organize your issues. Create one to get started.
          </Text>
          <TextInput
            value={projectName}
            onChangeText={setProjectName}
            placeholder="Project name"
            placeholderTextColor={colors.warm[400]}
            style={styles.input}
          />
          <Pressable
            onPress={handleCreateProject}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            disabled={creatingProject}
          >
            {creatingProject ? (
              <ActivityIndicator color={colors.content.primary} size="small" />
            ) : (
              <Text style={styles.primaryButtonLabel}>Create project</Text>
            )}
          </Pressable>
          {projectError && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{projectError}</Text>
            </View>
          )}
        </Animated.View>
      </View>
    );
  }

  if (!issuesData) {
    return (
      <View style={styles.loading}>
        <View style={styles.skeletonList}>
          {[0, 1, 2, 3].map((i) => (
            <Animated.View
              key={i}
              entering={FadeIn.delay(i * 80).duration(300)}
              style={styles.skeletonRow}
            >
              <View style={styles.skeletonDot} />
              <View style={[styles.skeletonBar, { width: 40 }]} />
              <View style={[styles.skeletonBar, { flex: 1 }]} />
            </Animated.View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <IssueRow
            issue={item}
            onPress={() => {
              void Haptics.selectionAsync();
              requestOverlay(`issue:${item._id}`, () => {
                router.push(`/issue/${item._id}`);
              });
            }}
          />
        )}
        renderSectionHeader={({ section }) => (
          <SectionHeader title={section.title} count={section.data.length} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        SectionSeparatorComponent={() => <View style={styles.sectionGap} />}
        stickySectionHeadersEnabled
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <View style={styles.headerRow}>
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle}>{selectedProject.identifier}</Text>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => void signOut()}
                  style={({ pressed }) => [styles.chipButton, pressed && styles.chipButtonPressed]}
                >
                  <Text style={styles.chipButtonLabel}>Sign out</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    requestOverlay("project-picker", () => {
                      router.push({
                        pathname: "/project-picker",
                        params: { project: selectedProject._id },
                      });
                    })
                  }
                  style={({ pressed }) => [styles.chipButton, pressed && styles.chipButtonPressed]}
                >
                  <Text style={styles.chipButtonLabel}>Projects</Text>
                </Pressable>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Animated.View entering={FadeIn.duration(300)} style={styles.emptyCard}>
            <Text style={styles.emptyCardTitle}>No issues yet</Text>
            <Text style={styles.emptyCardText}>Tap the + button to create your first issue.</Text>
          </Animated.View>
        }
      />

      <Animated.View style={[styles.fabWrap, fabStyle]}>
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          onPress={handleCreateIssue}
        >
          <Plus size={24} color={colors.content.primary} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.warm[50] },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.warm[50],
  },

  skeletonList: {
    width: "100%",
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: radius.md,
  },
  skeletonDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.warm[200],
  },
  skeletonBar: {
    height: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.warm[200],
  },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.warm[50],
  },
  emptyStateCard: {
    ...recipes.card,
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing["3xl"],
  },
  emptyStateEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.warm[400],
  },
  emptyStateTitle: {
    fontSize: fontSize["2xl"],
    lineHeight: lineHeight["2xl"],
    color: colors.warm[900],
    fontWeight: "700",
    textAlign: "center",
  },
  emptyStateText: {
    fontSize: fontSize.md,
    lineHeight: lineHeight.lg,
    color: colors.warm[600],
    textAlign: "center",
  },

  input: {
    ...recipes.input,
    width: "100%",
    minHeight: 44,
    fontSize: fontSize.lg,
  },

  primaryButton: {
    ...recipes.buttonAccent,
    minHeight: 44,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  primaryButtonPressed: {
    ...recipes.buttonAccentPressed,
  },
  primaryButtonLabel: {
    ...recipes.buttonAccentLabel,
    fontSize: fontSize.md,
  },
  secondaryFullButton: {
    ...recipes.buttonNeutral,
    minHeight: 40,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  secondaryFullButtonPressed: {
    ...recipes.buttonNeutralPressed,
  },
  secondaryFullButtonLabel: {
    ...recipes.buttonNeutralLabel,
    fontSize: fontSize.md,
  },

  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  errorText: {
    fontSize: fontSize.sm,
    lineHeight: lineHeight.md,
    color: colors.urgent,
  },

  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: 112,
    gap: spacing.sm,
  },
  headerStack: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSize["2xl"],
    lineHeight: lineHeight["2xl"],
    color: colors.warm[900],
    fontWeight: "600",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  chipButton: {
    borderRadius: radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.border.transparent,
    backgroundColor: colors.background.secondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  chipButtonPressed: {
    backgroundColor: colors.background.tertiary,
  },
  chipButtonLabel: {
    fontSize: fontSize.xs,
    color: colors.warm[700],
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  separator: {
    height: 1,
    backgroundColor: colors.warm[200],
    marginLeft: spacing.lg,
  },
  sectionGap: { height: spacing.sm },

  emptyCard: {
    ...recipes.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    alignItems: "center",
    gap: spacing.xs,
  },
  emptyCardTitle: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.warm[700],
  },
  emptyCardText: {
    fontSize: fontSize.sm,
    color: colors.warm[500],
    textAlign: "center",
  },

  fabWrap: {
    position: "absolute",
    bottom: 32,
    right: spacing.xl,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.util.accent,
    borderWidth: 1,
    borderColor: colors.util.accentBorder,
    alignItems: "center",
    justifyContent: "center",
    borderCurve: "continuous",
    boxShadow: shadows.accent.boxShadow,
  },
  fabPressed: { backgroundColor: colors.util.accentHover, transform: [{ scale: 0.92 }] },
});
