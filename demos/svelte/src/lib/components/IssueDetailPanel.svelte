<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import type { Attachment } from "svelte/attachments";
  import { api } from "$convex/_generated/api.js";
  import { useQuery } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { errorText } from "$lib/errors";
  import Pencil1 from "svelte-radix/Pencil1.svelte";
  import Trash from "svelte-radix/Trash.svelte";

  let {
    issue,
    permissions,
    members,
    currentUserId,
    client,
    onclose,
  } = $props<{
    issue: {
      _id: string;
      identifier: string;
      number: number;
      title: string;
      status: string;
      priority: string;
      labels: string[];
      assigneeName: string | null;
      assigneeUserId: string | null;
      createdByName: string;
      createdByUserId: string;
    };
    permissions: {
      canEditIssues: boolean;
      canMoveIssues: boolean;
      canAssignIssues: boolean;
      canDeleteIssues: boolean;
      canCreateComments: boolean;
      canDeleteComments: boolean;
    };
    members: Array<{ userId: string; name: string }>;
    currentUserId: string;
    client: ConvexClient;
    onclose: () => void;
  }>();

  const commentsQuery = useQuery(
    api.comments.list,
    () => ({
      issueId: issue._id,
    }),
  );

  const comments = $derived(commentsQuery.data ?? []);

  const isOwnerOrAssignee = $derived(
    issue.createdByUserId === currentUserId || issue.assigneeUserId === currentUserId,
  );
  const canEdit = $derived(
    permissions.canEditIssues && (permissions.canAssignIssues || isOwnerOrAssignee),
  );
  const canMove = $derived(permissions.canMoveIssues);
  const canAssign = $derived(permissions.canAssignIssues);
  const canDelete = $derived(permissions.canDeleteIssues);
  const canComment = $derived(permissions.canCreateComments);
  const canDeleteComments = $derived(permissions.canDeleteComments);

  const isViewer = $derived(!canEdit && !canMove && !canComment);

  let newComment = $state("");
  let isSubmittingComment = $state(false);
  let isEditing = $state(false);
  let editTitle = $state("");

  type IssueStatus = "backlog" | "todo" | "in_progress" | "done" | "cancelled";
  type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

  const statusOptions: Array<{ value: IssueStatus; label: string }> = [
    { value: "backlog", label: "Backlog" },
    { value: "todo", label: "Todo" },
    { value: "in_progress", label: "In progress" },
    { value: "done", label: "Done" },
    { value: "cancelled", label: "Cancelled" },
  ];

  const priorityOptions: Array<{ value: IssuePriority; label: string }> = [
    { value: "urgent", label: "Urgent" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
    { value: "none", label: "None" },
  ];

  function startEditing() {
    if (!canEdit) return;
    editTitle = issue.title;
    isEditing = true;
  }

  const focusOnMount: Attachment<HTMLInputElement> = (node) => {
    node.focus();
    node.select();
  };

  async function saveEdit() {
    const next = editTitle.trim();
    isEditing = false;
    if (next.length === 0 || next === issue.title) return;
    try {
      await client.mutation(api.issues.update, {
        issueId: issue._id,
        patch: { title: next },
      });
    } catch (e: unknown) {
      toast.error(errorText(e));
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!canMove) return;
    try {
      await client.mutation(api.issues.update, {
        issueId: issue._id,
        patch: { status: newStatus },
      });
    } catch (e: unknown) {
      toast.error(errorText(e));
    }
  }

  async function handlePriorityChange(newPriority: string) {
    if (!canEdit) return;
    try {
      await client.mutation(api.issues.update, {
        issueId: issue._id,
        patch: { priority: newPriority },
      });
    } catch (e: unknown) {
      toast.error(errorText(e));
    }
  }

  async function handleAssigneeChange(newAssigneeUserId: string) {
    try {
      await client.mutation(api.issues.update, {
        issueId: issue._id,
        patch: { assigneeUserId: newAssigneeUserId || null },
      });
    } catch (e: unknown) {
      toast.error(errorText(e));
    }
  }

  async function handleAddComment() {
    if (newComment.trim().length === 0 || !canComment) return;
    isSubmittingComment = true;
    try {
      await client.mutation(api.comments.create, {
        issueId: issue._id,
        body: newComment,
      });
      newComment = "";
    } catch (e: unknown) {
      toast.error(errorText(e));
    } finally {
      isSubmittingComment = false;
    }
  }

  async function handleDeleteComment(commentId: string) {
    try {
      await client.mutation(api.comments.remove, {
        commentId,
      });
    } catch (e: unknown) {
      toast.error(errorText(e));
    }
  }

  let confirmingDelete = $state(false);

  async function handleDeleteIssue() {
    if (!confirmingDelete) {
      confirmingDelete = true;
      return;
    }
    try {
      await client.mutation(api.issues.remove, {
        issueId: issue._id,
      });
      onclose();
    } catch (e: unknown) {
      toast.error(errorText(e));
    } finally {
      confirmingDelete = false;
    }
  }

  function clockTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
</script>

<div class="p-4 flex flex-col gap-3">
  <!-- Viewer banner -->
  {#if isViewer}
    <div class="callout callout--hint font-label text-[0.75rem]">
      You're a <strong>Viewer</strong> in this organization — this issue is read-only. Ask an admin to upgrade your role.
    </div>
  {/if}

  <!-- Title -->
  <div class="flex items-start gap-2">
    <div class="flex-1">
      {#if isEditing}
        <input
          bind:value={editTitle}
          {@attach focusOnMount}
          class="input w-full text-base font-semibold"
          type="text"
          maxlength="120"
          onblur={saveEdit}
          onkeydown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === "Escape") { editTitle = issue.title; isEditing = false; }
          }}
        />
      {:else}
        <div class="flex items-center gap-2">
          <h3 class="m-0 font-sans text-base font-semibold text-content-primary leading-tight">{issue.title}</h3>
          {#if canEdit}
            <button class="icon-button h-6 w-6 shrink-0" onclick={startEditing} aria-label="Edit issue title" type="button"><Pencil1 size="14" /></button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Fields: Status, Priority, Assignee -->
  <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1">
    <div class="flex flex-col gap-1">
      <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-content-tertiary">Status</span>
      {#if canMove}
        <select
          class="select select--compact"
          value={issue.status}
          onchange={(e) => handleStatusChange(e.currentTarget.value)}
        >
          {#each statusOptions as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      {:else}
        <span class="font-label text-[0.75rem] text-content-secondary">{statusOptions.find((o) => o.value === issue.status)?.label}</span>
      {/if}
    </div>

    <div class="flex flex-col gap-1">
      <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-content-tertiary">Priority</span>
      {#if canEdit}
        <select
          class="select select--compact"
          value={issue.priority}
          onchange={(e) => handlePriorityChange(e.currentTarget.value)}
        >
          {#each priorityOptions as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      {:else}
        <span class="font-label text-[0.75rem] text-content-secondary">{priorityOptions.find((o) => o.value === issue.priority)?.label ?? "None"}</span>
      {/if}
    </div>

    <div class="flex flex-col gap-1">
      <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-content-tertiary">Assignee</span>
      {#if canAssign}
        <select
          class="select select--compact"
          value={issue.assigneeUserId ?? ""}
          onchange={(e) => handleAssigneeChange(e.currentTarget.value)}
        >
          <option value="">Unassigned</option>
          {#each members as member (member.userId)}
            <option value={member.userId}>{member.name}</option>
          {/each}
        </select>
      {:else if canMove}
        <!-- Members: self-assign only -->
        <select
          class="select select--compact"
          value={issue.assigneeUserId === currentUserId ? currentUserId : issue.assigneeUserId ?? ""}
          onchange={(e) => handleAssigneeChange(e.currentTarget.value)}
        >
          <option value={currentUserId}>Me</option>
          {#if issue.assigneeUserId && issue.assigneeUserId !== currentUserId}
            <option value={issue.assigneeUserId}>{issue.assigneeName}</option>
          {/if}
        </select>
      {:else}
        <span class="font-label text-[0.75rem] text-content-secondary">{issue.assigneeName ?? "Unassigned"}</span>
      {/if}
    </div>
  </div>

  <!-- Labels -->
  {#if issue.labels.length > 0}
    <div class="flex gap-1 flex-wrap">
      {#each issue.labels as label (`${issue._id}-${label}`)}
        <span class="chip chip--grant">{label}</span>
      {/each}
    </div>
  {/if}

  <!-- Comments -->
  <div class="flex flex-col gap-2 mt-1">
    {#if comments.length > 0}
      <div class="flex flex-col gap-1.5">
        {#each comments as comment (comment._id)}
          <div class="flex items-start gap-2 py-1.5 border-b border-border-transparent">
            <div class="flex-1">
              <span class="font-label text-[0.6875rem] font-semibold text-content-primary">{comment.authorName}</span>
              <span class="font-label text-[0.6rem] text-content-tertiary ml-1">{clockTime(comment.createdAt)}</span>
              <p class="m-0 mt-0.5 text-[0.8125rem] text-content-secondary">{comment.body}</p>
            </div>
            {#if canDeleteComments || comment.authorUserId === currentUserId}
              <button
                class="icon-button h-7 w-7 text-content-tertiary hover:text-content-error"
                onclick={() => handleDeleteComment(comment._id)}
              >
                <Trash size="14" />
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if canComment}
      <form class="flex gap-1.5 items-start" onsubmit={(e) => { e.preventDefault(); handleAddComment(); }}>
        <input
          bind:value={newComment}
          class="input input--compact flex-1"
          maxlength="500"
          placeholder="Add a comment..."
          type="text"
        />
        <button
          class="button button--secondary button--compact"
          disabled={isSubmittingComment || newComment.trim().length === 0}
          type="submit"
        >
          {isSubmittingComment ? "Posting..." : "Post"}
        </button>
      </form>
    {/if}
  </div>

  <!-- Delete (admin only) -->
  {#if canDelete}
    <div class="mt-2 pt-2 border-t border-border-transparent">
      <button
        class="button button--danger button--compact font-label text-[0.72rem] {confirmingDelete ? 'bg-background-error-secondary text-content-error' : ''}"
        onclick={handleDeleteIssue}
      >
        {confirmingDelete ? "Confirm delete" : "Delete issue"}
      </button>
      {#if confirmingDelete}
        <button class="button button--ghost ml-2" onclick={() => { confirmingDelete = false; }}>cancel</button>
      {/if}
    </div>
  {/if}
</div>
