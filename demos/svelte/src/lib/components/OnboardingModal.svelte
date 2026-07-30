<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { api } from "$convex/_generated/api.js";
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { errorText } from "$lib/errors";

  let { client } = $props<{
    client: ConvexClient;
  }>();

  let isSubmitting: boolean = $state(false);
  let name: string = $state("");

  async function handleCreate() {
    if (name.trim().length < 3) {
      toast.error("Name must be at least 3 characters.");
      return;
    }

    isSubmitting = true;

    try {
      const result = await client.mutation(api.groups.create, { name });
      if ("ok" in result && !result.ok && "message" in result) {
        toast.error(typeof result.message === "string" ? result.message : "Something went wrong.");
      } else if ("groupId" in result) {
        void goto(`${base}/${result.groupId}`);
      }
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
  <div
    class="panel flex w-full max-w-80 flex-col gap-2.5 rounded-xl border-t-[3px] border-t-brand-red p-5 shadow-[0_24px_80px_rgb(0_0_0_/_0.34)]"
  >
    <h2 class="heading text-xl m-0">New organization</h2>

  <form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
    <input bind:value={name} class="input" type="text" maxlength="60" placeholder="Organization name" />
    <button class="button button--accent button--block" disabled={isSubmitting} type="submit">
      {isSubmitting ? "Creating..." : "Create"}
    </button>
  </form>
  </div>
</div>
