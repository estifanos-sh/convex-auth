<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { api } from "$convex/_generated/api.js";
  import { useQuery } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { errorText } from "$lib/errors";
  import IssueDetailPanel from "./IssueDetailPanel.svelte";

  let { project, permissions, members, currentUserId, client } = $props<{
    project: {
      projectId: string;
      name: string;
      identifier: string;
      slug: string;
      description: string;
    };
    permissions: {
      canCreateIssues: boolean;
      canMoveIssues: boolean;
      canEditIssues: boolean;
      canAssignIssues: boolean;
      canDeleteIssues: boolean;
      canCreateComments: boolean;
      canDeleteComments: boolean;
    };
    members: Array<{ userId: string; name: string }>;
    currentUserId: string;
    client: ConvexClient;
  }>();

  const issuesQuery = useQuery(
    api.issues.list,
    () => ({
      projectId: project.projectId,
    }),
  );

  const issues = $derived(issuesQuery.data?.issues ?? []);
  const issuesError = $derived(issuesQuery.error);

  $effect(() => {
    if (issuesError) {
      toast.error(errorText(issuesError, "Failed to load issues."));
    }
  });

  const statusOrder = ["in_progress", "todo", "backlog", "done", "cancelled"] as const;

  const statusLabels: Record<string, string> = {
    backlog: "Backlog",
    todo: "Todo",
    in_progress: "In progress",
    done: "Done",
    cancelled: "Cancelled",
  };

  const statusColors: Record<string, string> = {
    backlog: "text-content-tertiary",
    todo: "text-content-secondary",
    in_progress: "text-content-accent",
    done: "text-content-success",
    cancelled: "text-border-transparent",
  };

  const priorityWeight: Record<string, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
    none: 4,
  };

  const priorityLabels: Record<string, string> = {
    urgent: "Urgent",
    high: "High",
    medium: "Med",
    low: "Low",
    none: "",
  };

  type IssueType = (typeof issues)[number];
  type StatusGroup = { status: string; label: string; issues: IssueType[] };

  const groupedIssues = $derived.by(() => {
    const groups: StatusGroup[] = [];
    for (const status of statusOrder) {
      const grouped = issues
        .filter((issue: IssueType) => issue.status === status)
        .sort(
          (a: IssueType, b: IssueType) =>
            (priorityWeight[a.priority] ?? 4) - (priorityWeight[b.priority] ?? 4),
        );
      if (grouped.length > 0) {
        groups.push({ status, label: statusLabels[status], issues: grouped });
      }
    }
    return groups;
  });

  let expandedIssueId = $state<string | null>(null);
  let isCreating = $state(false);
  let newTitle = $state("");

  function toggleIssue(issueId: string) {
    expandedIssueId = expandedIssueId === issueId ? null : issueId;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      expandedIssueId = null;
    }
  }

  async function handleCreateIssue() {
    if (newTitle.trim().length === 0) return;
    isCreating = true;
    try {
      const result = await client.mutation(api.issues.create, {
        projectId: project.projectId,
        title: newTitle,
      });
      if ("ok" in result && !result.ok && "message" in result) {
        toast.error(typeof result.message === "string" ? result.message : "Failed to create issue");
      } else {
        newTitle = "";
      }
    } catch (e: unknown) {
      toast.error(errorText(e, "Failed to create issue"));
    } finally {
      isCreating = false;
    }
  }

</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col gap-3">
  <!-- Header -->
  <div class="flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch flex-wrap">
    <div class="flex flex-col">
      <h2 class="section-header" style="border:0;margin:0;padding:0">
        <span class="text-content-tertiary">{project.identifier}</span>
        <span class="ml-1">{project.name}</span>
      </h2>
    </div>
    {#if permissions.canCreateIssues}
      <form class="flex gap-1.5 items-center" onsubmit={(e) => { e.preventDefault(); handleCreateIssue(); }}>
        <input
          bind:value={newTitle}
          class="input input--compact flex-1"
          maxlength="120"
          placeholder="New issue title"
          type="text"
        />
        <button
          class="button button--accent button--compact"
          disabled={isCreating || newTitle.trim().length === 0}
          type="submit"
        >
          {isCreating ? "Adding..." : "Add"}
        </button>
      </form>
    {/if}
  </div>

  <!-- Issue list grouped by status -->
  {#if issues.length === 0}
    <p class="muted">No issues yet.</p>
  {:else}
    <div class="panel flex flex-col overflow-hidden">
      {#each groupedIssues as group (group.status)}
        <!-- Status group header -->
        <div class="flex items-center gap-2 px-3 py-1.5 bg-background-tertiary border-b border-border-transparent">
          <span class="inline-block w-2 h-2 rounded-full {statusColors[group.status]} {group.status === 'done' ? 'bg-content-success' : group.status === 'in_progress' ? 'bg-content-accent/70' : group.status === 'cancelled' ? 'bg-border-transparent' : 'bg-current'}"></span>
          <span class="font-label text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-content-tertiary">{group.label}</span>
          <span class="font-label text-[0.6rem] text-content-tertiary">{group.issues.length}</span>
        </div>

        {#each group.issues as issue (issue._id)}
          <!-- Issue row -->
          <div
            class="row cursor-pointer text-left w-full {expandedIssueId === issue._id ? 'row--active' : ''}"
            onclick={() => toggleIssue(issue._id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleIssue(issue._id); } }}
            role="button"
            tabindex="0"
          >
            <!-- Identifier -->
            <span class="font-label text-[0.6875rem] font-semibold text-content-tertiary shrink-0 w-16">{issue.identifier}</span>

            <!-- Title -->
            <span class="font-sans text-[0.8125rem] font-medium text-content-primary flex-1 truncate">{issue.title}</span>

            <!-- Priority -->
            {#if issue.priority !== "none"}
              <span class={`chip chip--${issue.priority === "urgent" ? "high" : issue.priority} shrink-0`}>{priorityLabels[issue.priority]}</span>
            {/if}

            <!-- Labels -->
            {#each issue.labels.slice(0, 2) as label (`${issue._id}-${label}`)}
              <span class="chip chip--grant shrink-0">{label}</span>
            {/each}

            <!-- Assignee -->
            <span class="font-label text-[0.6875rem] text-content-secondary shrink-0 w-20 text-right truncate">
              {issue.assigneeName ?? "—"}
            </span>
          </div>

          <!-- Inline expand -->
          {#if expandedIssueId === issue._id}
            <div class="border-b border-border-transparent bg-background-primary">
              <IssueDetailPanel
                {issue}
                {permissions}
                {members}
                {currentUserId}
                {client}
                onclose={() => { expandedIssueId = null; }}
              />
            </div>
          {/if}
        {/each}
      {/each}
    </div>
  {/if}
</div>
