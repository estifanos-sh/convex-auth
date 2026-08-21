<script lang="ts">
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import { getContext } from "svelte";
  import { getConvexClient } from "convex-svelte";
  import type { GenericId } from "convex/values";
  import type { AppContext } from "$lib/app";
  import NewConnectionForm from "$lib/components/sso/NewConnectionForm.svelte";

  const groupId = $derived(page.params.groupId! as GenericId<"Group">);
  const client = getConvexClient();
  const siteUrl = getContext<AppContext>("app").siteUrl;
</script>

<div class="col-span-full max-w-3xl mx-auto w-full px-8 py-10 flex flex-col gap-6 max-md:px-4 max-md:py-6">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="heading text-xl m-0">New connection</h1>
      <p class="m-0 mt-1 font-label text-[0.8125rem] text-content-secondary">Create a group SSO connection.</p>
    </div>
    <a class="button button--secondary button--compact no-underline" href={`${base}/${groupId}/connection`}>Back</a>
  </div>

  <NewConnectionForm
    {client}
    groupId={groupId}
    {siteUrl}
    ondone={(connectionId) => {
      if (connectionId) {
        goto(`${base}/${groupId}/connection/${connectionId}`);
        return;
      }
      goto(`${base}/${groupId}/connection`);
    }}
  />
</div>
