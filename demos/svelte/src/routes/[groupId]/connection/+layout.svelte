<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { getContext } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { api } from "$convex/_generated/api.js";
  import type { AppContext } from "$lib/app";
  import AppLoading from "$lib/components/AppLoading.svelte";

  let { children } = $props();
  const app = getContext<AppContext>("app");
  const groupId = $derived(page.params.groupId!);

  const dashboard = useQuery(api.groups.get, () => (app.isAuthenticated ? { groupId } : "skip"));
  const canManage = $derived(
    (dashboard.data?.selectedGroup?.permissions as { canManageConnection?: boolean } | undefined)
      ?.canManageConnection ?? null,
  );

  $effect(() => {
    if (app.isLoading) return;
    if (!app.isAuthenticated) {
      void goto(`${base}/`);
      return;
    }
    if (canManage === false) {
      void goto(`${base}/${groupId}`);
    }
  });
</script>

{#if app.isAuthenticated && canManage}
  {@render children()}
{:else}
  <div class="col-span-full">
    <AppLoading />
  </div>
{/if}
