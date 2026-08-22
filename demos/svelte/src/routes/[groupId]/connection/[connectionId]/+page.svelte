<script lang="ts">
  import { page } from "$app/state";
  import { getContext } from "svelte";
  import { getConvexClient } from "convex-svelte";
  import type { GenericId } from "convex/values";
  import type { AppContext } from "$lib/app";
  import ConnectionDetail from "$lib/components/sso/ConnectionDetail.svelte";

  const groupId = $derived(page.params.groupId! as GenericId<"Group">);
  const connectionId = $derived(
    page.params.connectionId! as GenericId<"GroupConnection">,
  );
  const client = getConvexClient();
  const siteUrl = getContext<AppContext>("app").siteUrl;
</script>

<ConnectionDetail
  {client}
  {groupId}
  {connectionId}
  {siteUrl}
/>
