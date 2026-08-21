<script lang="ts">
  import { getConvexClient, useQuery } from "convex-svelte";
  import type { GenericId } from "convex/values";
  import { api } from "$convex/_generated/api.js";
  import ConnectionListItem from "$lib/components/sso/ConnectionListItem.svelte";
  import PolicySection from "$lib/components/sso/PolicySection.svelte";
  import AuditSection from "$lib/components/sso/AuditSection.svelte";
  import LockClosed from "svelte-radix/LockClosed.svelte";
  import Plus from "svelte-radix/Plus.svelte";
  import { page } from "$app/state";
  import { base } from "$app/paths";

  const groupId = $derived(page.params.groupId! as GenericId<"Group">);
  const client = getConvexClient();

  type Tab = "connections" | "policy" | "audit";
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "connections", label: "Connections" },
    { id: "policy", label: "Policy" },
    { id: "audit", label: "Audit log" },
  ];
  let tab = $state<Tab>("connections");

  const connections = useQuery(api.auth.group.listConnections, () => ({
    where: { groupId: groupId },
    paginationOpts: { cursor: null, numItems: 25 },
  }));
  type SsoConnection = { _id: string; status?: string };
  const visibleConnections = $derived.by(() =>
    ((connections.data as { page?: SsoConnection[] } | undefined)?.page ?? []).filter(
      (connection) => connection.status !== "draft",
    ),
  );
</script>

<div
  class="col-span-full mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-10 max-md:px-4 max-md:py-6"
>
  <!-- Toolbar -->
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex items-center gap-3">
      <div
        class="flex h-10 w-10 items-center justify-center rounded-lg border border-border-transparent bg-background-tertiary"
      >
        <LockClosed size="20" class="text-content-accent" />
      </div>
      <div>
        <h1 class="heading m-0 text-xl">Connections</h1>
        <p class="m-0 mt-0.5 font-label text-[0.8125rem] text-content-secondary">
          Single sign-on (SAML &amp; OIDC) for your organization.
        </p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <a class="button button--secondary button--compact no-underline" href={`${base}/${groupId}`}>Back</a>
      {#if tab === "connections" && visibleConnections.length > 0}
        <a
          class="button button--accent button--compact no-underline inline-flex items-center gap-1.5"
          href={`${base}/${groupId}/connection/new`}
        >
          <Plus size="14" /> New
        </a>
      {/if}
    </div>
  </header>

  <!-- Tabs -->
  <div class="segmented self-start">
    {#each tabs as t (t.id)}
      <button type="button" data-active={tab === t.id} onclick={() => { tab = t.id; }}>
        {t.label}
      </button>
    {/each}
  </div>

  <!-- Active tab -->
  {#if tab === "connections"}
    {#if connections.isLoading}
      <p class="muted">Loading connections…</p>
    {:else if visibleConnections.length === 0}
      <div class="panel flex flex-col items-center gap-4 p-10 text-center">
        <LockClosed size="32" class="text-content-tertiary" />
        <div>
          <p class="m-0 font-display text-base font-medium text-content-primary">No connections yet</p>
          <p class="m-0 mt-1 font-label text-[0.8125rem] text-content-secondary">
            Add a SAML or OIDC provider to enable single sign-on.
          </p>
        </div>
        <a class="button button--accent button--compact no-underline" href={`${base}/${groupId}/connection/new`}>
          Create connection
        </a>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each visibleConnections as connection (connection._id)}
          <ConnectionListItem {connection} groupId={groupId} />
        {/each}
      </div>
    {/if}
  {:else if tab === "policy"}
    <PolicySection {client} groupId={groupId} />
  {:else if tab === "audit"}
    <AuditSection groupId={groupId} />
  {/if}
</div>
