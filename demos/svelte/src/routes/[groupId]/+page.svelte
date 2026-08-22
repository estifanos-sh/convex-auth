<script lang="ts">
	import { getConvexClient, useQuery } from "convex-svelte";
	import { toast } from "svelte-sonner";
	import { page } from "$app/state";
	import { api } from "$convex/_generated/api.js";
	import type { FunctionReturnType } from "convex/server";
	import type { GenericId } from "convex/values";
	import { getContext } from "svelte";
	import type { AppContext } from "$lib/app";
	import AppLoading from "$lib/components/AppLoading.svelte";
	import AuthModal from "$lib/components/AuthModal.svelte";
	import OnboardingModal from "$lib/components/OnboardingModal.svelte";
	import AppSidebar from "$lib/components/AppSidebar.svelte";
	import IssueListPanel from "$lib/components/IssueListPanel.svelte";
	import SettingsPanel from "$lib/components/SettingsPanel.svelte";
	import { errorText } from "$lib/errors";

	const app = getContext<AppContext>("app");
	const client = getConvexClient();
	type AuthContext = {
		invite?: {
			accept: () => Promise<{ token: string }>;
		} | null;
	};
	const auth = getContext<AuthContext>("auth");
	type DashboardData = FunctionReturnType<typeof api.groups.get>;
	type Workspace = NonNullable<DashboardData["selectedGroup"]>;
	type User = NonNullable<DashboardData["user"]>;

	const groupId = $derived(page.params.groupId! as GenericId<"Group">);
	let activeTab = $state<"issues" | "settings">("issues");
	let selectedProjectSlug = $state<string | null>(null);

	const dashboard = useQuery(api.groups.get, () => ({ groupId }));

	const workspace: Workspace | null = $derived(dashboard.data?.selectedGroup ?? null);
	const user: User | null = $derived(dashboard.data?.user ?? null);

	const selectedProject = $derived.by(() => {
		if (!workspace) return null;
		if (selectedProjectSlug) {
			return workspace.projects.find((project) => project.slug === selectedProjectSlug) ?? workspace.projects[0] ?? null;
		}
		return workspace.projects[0] ?? null;
	});

	$effect(() => {
		if (selectedProject && !selectedProjectSlug) {
			selectedProjectSlug = selectedProject.slug;
		}
	});

	let inviteHandled = false;

	async function acceptPendingInvite(invite: NonNullable<AuthContext["invite"]>) {
		try {
			const { token } = await invite.accept();
			await client.mutation(api.groups.acceptInvite, { token });
			toast.success("Invite accepted! You've been added to the organization.");
		} catch (e: unknown) {
			toast.error(errorText(e, "Invalid or expired invite."));
		}
	}

	$effect(() => {
		if (inviteHandled || !user || !auth.invite) return;
		inviteHandled = true;
		void acceptPendingInvite(auth.invite);
	});
</script>

{#if app.isLoading}
	<AppLoading />
{:else if !app.isAuthenticated}
	<AuthModal authProviders={app.authProviders} />
{:else if dashboard.isLoading && !dashboard.data}
	<AppLoading shell />
{:else if !workspace || !user}
	<div class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 px-4">
		<OnboardingModal {client} />
	</div>
{:else}
	<AppSidebar
		groups={dashboard.data?.groups ?? []}
		selectedGroup={{ groupId: workspace.groupId, name: workspace.name }}
		projects={workspace.projects}
		permissions={{
			canCreateProjects: workspace.permissions.canCreateProjects,
		}}
		bind:activeTab
		bind:selectedProjectSlug
		{client}
		groupId={workspace.groupId}
	/>
	<main class="p-5 px-6 overflow-y-auto bg-background-primary max-md:p-4">
		{#if activeTab === "issues"}
			{#if selectedProject}
				{#key selectedProject.projectId}
					<IssueListPanel
						project={{
							projectId: selectedProject.projectId,
							name: selectedProject.name,
							identifier: selectedProject.identifier,
							slug: selectedProject.slug,
							description: selectedProject.description,
						}}
						permissions={{
							canCreateIssues: workspace.permissions.canCreateIssues,
							canMoveIssues: workspace.permissions.canMoveIssues,
							canEditIssues: workspace.permissions.canEditIssues,
							canAssignIssues: workspace.permissions.canAssignIssues,
							canDeleteIssues: workspace.permissions.canDeleteIssues,
							canCreateComments: workspace.permissions.canCreateComments,
							canDeleteComments: workspace.permissions.canDeleteComments,
						}}
						members={workspace.members.map((member) => ({ userId: member.userId, name: member.name }))}
						currentUserId={user.userId}
						{client}
					/>
				{/key}
			{:else}
				<p class="muted">No projects yet{workspace.permissions.canCreateProjects ? " — click + New in the sidebar." : "."}</p>
			{/if}
		{:else}
			<SettingsPanel
				user={{ name: user.name, email: user.email }}
				userRoleLabel={workspace.userRoleLabel}
				selectedProject={selectedProject
					? {
						projectId: selectedProject.projectId,
						identifier: selectedProject.identifier,
					}
					: null}
				members={workspace.members}
				permissions={{
					canManageMembers: workspace.permissions.canManageMembers,
					canManageSso: workspace.permissions.canManageConnection,
				}}
				groupId={workspace.groupId}
				{client}
			/>
		{/if}
	</main>
{/if}
