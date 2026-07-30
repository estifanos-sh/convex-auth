<script lang="ts">
  import { getConvexClient, useQuery } from "convex-svelte";
  import { getContext } from "svelte";
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { api } from "$convex/_generated/api.js";
  import type { AppContext } from "$lib/app";
  import AppLoading from "$lib/components/AppLoading.svelte";
  import AuthModal from "$lib/components/AuthModal.svelte";
  import OnboardingModal from "$lib/components/OnboardingModal.svelte";

  const app = getContext<AppContext>("app");
  const client = getConvexClient();

  const dashboard = useQuery(api.groups.get, () => (app.isAuthenticated ? {} : "skip"));

  $effect(() => {
    const data = dashboard.data;
    if (!data || data.groups.length === 0) return;
    const target = data.selectedGroup?.groupId ?? data.groups[0]?.groupId;
    if (target) void goto(`${base}/${target}`, { replaceState: true });
  });
</script>

{#if app.isLoading}
  <AppLoading />
{:else if !app.isAuthenticated}
  <AuthModal authProviders={app.authProviders} />
{:else if dashboard.data && dashboard.data.groups.length === 0}
  <OnboardingModal {client} />
{:else}
  <AppLoading shell />
{/if}
