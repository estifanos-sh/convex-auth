<script lang="ts">
	import { getContext } from "svelte";
	import { toast } from "svelte-sonner";
	import { errorText } from "$lib/errors";
	type AuthParameters = Record<string, string | number | boolean | undefined>;

	type AuthContext = {
		signIn: (
			provider: string,
			args?: AuthParameters,
		) => Promise<{ kind: "signedIn" | "redirect"; redirect?: URL | string }>;
	};

	let { email } = $props<{ email: string | null }>();

	const auth = getContext<AuthContext>("auth");

	let currentPassword = $state("");
	let newPassword = $state("");
	let confirmPassword = $state("");
	let isSubmitting = $state(false);

	const trimmedEmail = $derived(email?.trim() ?? "");
	const minLength = 8;
	const passwordsMatch = $derived(
		newPassword.length > 0 && newPassword === confirmPassword,
	);
	const newPasswordLongEnough = $derived(newPassword.length >= minLength);
	const canSubmit = $derived(
		!isSubmitting &&
			trimmedEmail.length > 0 &&
			currentPassword.length > 0 &&
			newPasswordLongEnough &&
			passwordsMatch,
	);

	function clearForm() {
		currentPassword = "";
		newPassword = "";
		confirmPassword = "";
	}

	async function handleSubmit() {
		if (trimmedEmail.length === 0) {
			toast.error("Account email is unavailable. Try refreshing the page.");
			return;
		}
		if (!newPasswordLongEnough) {
			toast.error(`New password must be at least ${minLength} characters.`);
			return;
		}
		if (!passwordsMatch) {
			toast.error("New password and confirmation do not match.");
			return;
		}

		isSubmitting = true;
		try {
			await auth.signIn("password", {
				flow: "change",
				email: trimmedEmail,
				currentPassword,
				newPassword,
			});
			toast.success("Password updated.");
			clearForm();
		} catch (e) {
			toast.error(errorText(e, "Failed to update password."));
		} finally {
			isSubmitting = false;
		}
	}
</script>

<form
	class="flex flex-col gap-2"
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
>
	{#if trimmedEmail}
		<p class="font-label text-[0.75rem] text-content-secondary m-0">
			Updating password for <span class="text-content-primary">{trimmedEmail}</span>
		</p>
	{/if}

	<label class="flex flex-col gap-1">
		<span class="font-label text-[0.75rem] text-content-primary">Current password</span>
		<input
			bind:value={currentPassword}
			class="input"
			type="password"
			autocomplete="current-password"
			disabled={isSubmitting}
			required
		/>
	</label>

	<label class="flex flex-col gap-1">
		<span class="font-label text-[0.75rem] text-content-primary">New password</span>
		<input
			bind:value={newPassword}
			class="input"
			type="password"
			autocomplete="new-password"
			minlength={minLength}
			disabled={isSubmitting}
			required
		/>
	</label>

	<label class="flex flex-col gap-1">
		<span class="font-label text-[0.75rem] text-content-primary">Confirm new password</span>
		<input
			bind:value={confirmPassword}
			class="input"
			type="password"
			autocomplete="new-password"
			minlength={minLength}
			disabled={isSubmitting}
			required
		/>
	</label>

	{#if newPassword.length > 0 && !newPasswordLongEnough}
		<p class="font-label text-[0.75rem] text-content-secondary m-0">
			At least {minLength} characters.
		</p>
	{:else if confirmPassword.length > 0 && !passwordsMatch}
		<p class="font-label text-[0.75rem] text-content-secondary m-0">
			New password and confirmation do not match.
		</p>
	{/if}

	<button
		class="button button--accent button--compact self-start"
		type="submit"
		disabled={!canSubmit}
	>
		{isSubmitting ? "Updating..." : "Update password"}
	</button>
</form>
