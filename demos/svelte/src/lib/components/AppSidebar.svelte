<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { api } from "$convex/_generated/api.js";
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { errorText } from "$lib/errors";
  import { fly, fade } from "svelte/transition";
  import HamburgerMenu from "svelte-radix/HamburgerMenu.svelte";
  import Cross2 from "svelte-radix/Cross2.svelte";

  let {
    groups,
    selectedGroup,
    projects,
    permissions,
    activeTab = $bindable("issues"),
    selectedProjectSlug = $bindable(null),
    client,
    groupId,
  } = $props<{
    groups: Array<{ groupId: string; name: string }>;
    selectedGroup: { groupId: string; name: string };
    projects: Array<{
      projectId: string;
      name: string;
      identifier: string;
      slug: string;
      openIssueCount: number;
    }>;
    permissions: {
      canCreateProjects: boolean;
    };
    activeTab: "issues" | "settings";
    selectedProjectSlug: string | null;
    client: ConvexClient;
    groupId: string;
  }>();

  let mobileOpen = $state(false);

  let showNewProject = $state(false);
  let newProjectName = $state("");
  let isCreatingProject = $state(false);

  function switchGroup(id: string) {
    mobileOpen = false;
    void goto(`${base}/${id}`);
  }

  function selectProject(slug: string) {
    selectedProjectSlug = slug;
    activeTab = "issues";
    mobileOpen = false;
  }

  function openNewProject() {
    showNewProject = true;
    newProjectName = "";
  }

  async function handleCreateProject() {
    if (!newProjectName.trim()) return;
    isCreatingProject = true;
    try {
      const result = await client.mutation(api.projects.create, {
        groupId: groupId,
        name: newProjectName.trim(),
        description: "",
      });
      if ("ok" in result && !result.ok && "message" in result) {
        toast.error(typeof result.message === "string" ? result.message : "Failed to create project");
      } else {
        showNewProject = false;
      }
    } catch (e: unknown) {
      toast.error(errorText(e));
    } finally {
      isCreatingProject = false;
    }
  }

  function goToSettings() {
    activeTab = "settings";
    mobileOpen = false;
  }
</script>

<!-- Mobile: hamburger bar -->
<header class="hidden max-md:flex items-center gap-3 px-4 py-2.5 border-b border-border-transparent bg-background-secondary shrink-0">
  <button
    class="icon-button h-7 w-7"
    onclick={() => { mobileOpen = true; }}
    aria-label="Open menu"
  >
    <HamburgerMenu size="18" />
  </button>
  <span class="font-label text-[0.75rem] font-semibold text-content-primary truncate">{selectedGroup.name}</span>
</header>

<!-- Mobile: slide-out sheet -->
{#if mobileOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/30 z-40 md:hidden"
    transition:fade={{ duration: 100 }}
    onclick={() => { mobileOpen = false; }}
  ></div>

  <aside
    class="fixed inset-y-0 left-0 w-64 z-50 py-4 bg-background-secondary flex flex-col overflow-y-auto shadow-[0_24px_80px_rgb(0_0_0_/_0.35)] md:hidden"
    transition:fly={{ x: -300, duration: 200 }}
  >
    <div class="px-3 flex items-center justify-between h-6">
      <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-content-tertiary leading-none">convex-auth</span>
      <button
        class="icon-button h-7 w-7"
        onclick={() => { mobileOpen = false; }}
        aria-label="Close menu"
      >
        <Cross2 size="16" />
      </button>
    </div>

    {@render sidebarContent()}
  </aside>
{/if}

<!-- Desktop: static sidebar -->
<aside class="sticky top-0 h-dvh py-4 border-r border-border-transparent bg-background-secondary flex flex-col overflow-y-auto max-md:hidden">
  <div class="px-3 flex flex-col gap-1.5">
    <p class="label">convex-auth</p>
  </div>

  {@render sidebarContent()}
</aside>

{#snippet sidebarContent()}
  <div class="px-3 mt-1">
    <select
      class="select select--compact w-full"
      value={selectedGroup.groupId}
      onchange={(e) => switchGroup(e.currentTarget.value)}
    >
      {#each groups as workspace (workspace.groupId)}
        <option value={workspace.groupId}>{workspace.name}</option>
      {/each}
    </select>
  </div>

  <nav class="mt-3 pt-3 border-t border-border-transparent flex flex-col gap-0.5 flex-1 overflow-y-auto">
    <div class="flex items-center justify-between px-3 mb-1">
      <p class="font-label text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-content-tertiary m-0">Projects</p>
      {#if permissions.canCreateProjects}
        <button
          class="font-label text-[0.65rem] font-semibold text-content-accent hover:text-content-primary bg-transparent border-0 cursor-pointer p-0"
          onclick={openNewProject}
        >+ New</button>
      {/if}
    </div>

    {#if showNewProject}
      <form class="px-3 pb-2 flex flex-col gap-1.5 border-b border-border-transparent mb-1" onsubmit={(e) => { e.preventDefault(); handleCreateProject(); }}>
        <input class="input input--compact w-full" bind:value={newProjectName} placeholder="Project name" maxlength="50" type="text" />
        <div class="flex gap-1">
          <button class="button button--accent button--compact flex-1" type="submit" disabled={isCreatingProject || !newProjectName.trim()}>
            {isCreatingProject ? "..." : "Create"}
          </button>
          <button class="button button--secondary button--compact" type="button" onclick={() => { showNewProject = false; }}>Cancel</button>
        </div>
      </form>
    {/if}

    {#each projects as project (project.projectId)}
      <button
        class="mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-[0.3rem] text-left font-label text-[0.75rem] font-medium text-content-secondary transition-colors hover:bg-background-primary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-util-accent {selectedProjectSlug === project.slug && activeTab === 'issues' ? 'bg-background-tertiary font-semibold !text-content-primary' : ''}"
        onclick={() => selectProject(project.slug)}
      >
        <span class="font-semibold text-content-tertiary">{project.identifier}</span>
        <span class="ml-1">{project.name}</span>
        {#if project.openIssueCount > 0}
          <span class="ml-1 text-[0.625rem] text-content-tertiary">{project.openIssueCount}</span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="mt-auto pt-3 px-3 border-t border-border-transparent">
    <button
      class="flex w-full items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-[0.3rem] text-left font-label text-[0.75rem] font-medium text-content-secondary transition-colors hover:bg-background-primary hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-util-accent {activeTab === 'settings' ? 'bg-background-tertiary font-semibold !text-content-primary' : ''}"
      onclick={goToSettings}
    >Settings</button>
  </div>
{/snippet}
