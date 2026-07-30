<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { base } from "$app/paths";
  import { api } from "$convex/_generated/api.js";
  import ChevronRight from "svelte-radix/ChevronRight.svelte";

  type ConnectionListItem = {
    _id: string;
    name?: string;
    status?: string;
    protocol?: "oidc" | "saml";
  };
  type DomainRecord = {
    domain: string;
    isPrimary?: boolean;
    verifiedAt?: number;
  };

  let { connection, groupId } = $props<{
    connection: ConnectionListItem;
    groupId: string;
  }>();

  const domains = useQuery(api.auth.group.listDomains, () => ({
    connectionId: connection._id,
  }));

  const domainList = $derived.by(() => (domains.data ?? []) as DomainRecord[]);
  const primaryDomain = $derived(domainList.find((d) => d.isPrimary) ?? domainList[0] ?? null);
  const verifiedCount = $derived(domainList.filter((d) => Boolean(d.verifiedAt)).length);
  const isActive = $derived(connection.status === "active");
</script>

<a
  class="panel group relative flex items-center gap-5 px-6 py-5 no-underline transition-colors hover:bg-background-tertiary max-md:flex-col max-md:items-start max-md:gap-3 max-md:px-4 max-md:py-4"
  href={`${base}/${groupId}/connection/${connection._id}`}
>
  <!-- Status border -->
  <div class="absolute top-0 left-0 w-[3px] h-full {isActive ? 'bg-content-success' : 'bg-content-tertiary'}"></div>

  <!-- Name + domain -->
  <div class="flex-1 min-w-0">
    <p class="m-0 font-display text-lg font-medium text-content-primary truncate">{connection.name ?? "Untitled connection"}</p>
    <p class="m-0 mt-1 font-label text-[0.75rem] text-content-secondary truncate">{primaryDomain?.domain ?? "No domain configured"}</p>
  </div>

  <!-- Protocol chip -->
  <div class="flex items-center gap-2 shrink-0">
    <span class="chip border-indigo-500/20 text-indigo-600 bg-indigo-50 uppercase tracking-[0.08em]">
      {connection.protocol ?? "oidc"}
    </span>
    <span class="chip uppercase tracking-[0.08em] {isActive ? 'text-green-800 bg-green-50 border-green-300' : 'text-content-secondary bg-background-tertiary border-border-transparent'}">
      {connection.status ?? "draft"}
    </span>
  </div>

  <!-- Domain verification -->
  <div class="font-label text-[0.75rem] text-content-secondary shrink-0 w-32 text-right max-md:text-left max-md:w-auto">
    {#if domainList.length > 0}
      <span class="{verifiedCount === domainList.length ? 'text-green-800' : 'text-amber-700'}">{verifiedCount}/{domainList.length} verified</span>
    {:else}
      <span class="text-content-tertiary">No domains</span>
    {/if}
  </div>

  <!-- Arrow -->
  <ChevronRight size="18" class="text-content-tertiary group-hover:text-content-primary transition-colors shrink-0 max-md:hidden" />

  <!-- Geometric offset shadow -->
  <div class="absolute -bottom-[3px] -right-[3px] w-full h-full border border-border-transparent rounded-lg -z-10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
</a>
