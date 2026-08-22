<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { getConvexClient } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$convex/_generated/api.js';
	import ArrowLeft from 'svelte-radix/ArrowLeft.svelte';

	type SignInResult = {
		kind: 'signedIn' | 'redirect' | 'started' | 'totpRequired' | 'deviceCode';
		redirect?: URL | string;
	};
	type AuthParameters = Record<string, string | number | boolean | undefined>;

	type AuthContext = {
		invite?: { email?: string } | null;
		signIn: (provider: string, args?: AuthParameters) => Promise<SignInResult>;
		webauthn?: {
			isSupported: () => boolean;
			signIn: (opts?: AuthParameters) => Promise<SignInResult>;
		};
	};

	let { authProviders } = $props<{
		authProviders: { google: boolean };
	}>();

	const auth = getContext<AuthContext>('auth');
	const convexClient = getConvexClient();

	let isSubmitting: boolean = $state(false);
	let password: string = $state('');
	let resetCode: string = $state('');
	let resetNewPassword: string = $state('');
	let verifyCode: string = $state('');

	const isInvite = Boolean(auth.invite);
	const prefillEmail = auth.invite?.email ?? '';
	let email: string = $state(prefillEmail);

	let mode: 'signIn' | 'signUp' = $state('signIn');
	type Step =
		| 'email'
		| 'password'
		| 'checking'
		| 'resetRequest'
		| 'resetVerify'
		| 'verifyEmail';
	let step: Step = $state('email');
	const passkeySupported = $derived(auth.webauthn?.isSupported() ?? false);

	function getErrorMessage(error: unknown) {
		if (error instanceof Error) {
			return error.message;
		}
		return String(error);
	}

	function isNoMatchingSsoError(error: unknown) {
		const message = getErrorMessage(error);
		return message.includes('No group connection matched the provided input.');
	}

	function isCredentialsError(error: unknown) {
		const message = getErrorMessage(error);
		return message.includes('Invalid credentials') || message.includes('credentials');
	}

	function classifyPasswordError(error: unknown): string {
		const msg = getErrorMessage(error);
		if (msg.includes('Invalid credentials') || msg.includes('credentials')) {
			return 'Wrong password. Try again.';
		}
		if (msg.includes('Invalid password')) {
			return 'Password must be at least 8 characters.';
		}
		if (msg.includes('Invalid code') || msg.includes('verification code')) {
			return 'That code is invalid or expired. Try again.';
		}
		return msg;
	}

	onMount(() => {
		if (!isInvite || !prefillEmail || step !== 'email') {
			return;
		}

		step = 'checking';
		void convexClient
			.query(api.groups.emailExists, { email: prefillEmail })
			.then((exists: boolean) => {
				mode = exists ? 'signIn' : 'signUp';
				step = 'password';
			})
			.catch(() => {
				mode = 'signUp';
				step = 'password';
			});
	});

	async function handleEmailContinue() {
		if (!email.includes('@')) return;
		isSubmitting = true;

		let shouldFallbackToPassword = false;

		try {
			const ssoInfo = await convexClient.query(api.auth.group.signInLookup, {
				selector: { email },
			});
			if (!ssoInfo) {
				shouldFallbackToPassword = true;
			} else {
				const result = await auth.signIn('connection', { connectionId: ssoInfo.connectionId });
				if (result.kind === 'redirect' && result.redirect) {
					window.location.href = result.redirect.toString();
					return;
				}
				window.location.reload();
				return;
			}
		} catch (error) {
			if (!isNoMatchingSsoError(error)) {
				toast.error(getErrorMessage(error));
				isSubmitting = false;
				return;
			}
			shouldFallbackToPassword = true;
		}

		if (shouldFallbackToPassword) {
			try {
				const exists = await convexClient.query(api.groups.emailExists, { email });
				mode = exists ? 'signIn' : 'signUp';
			} catch {}

			isSubmitting = false;
			step = 'password';
		}
	}

	async function handlePasswordSubmit() {
		isSubmitting = true;

		try {
			const result = await auth.signIn('password', { flow: mode, email, password });
			if (result.kind === 'signedIn') {
				window.location.reload();
			} else if (result.kind === 'redirect' && result.redirect) {
				window.location.href = result.redirect.toString();
			} else if (result.kind === 'started') {
				verifyCode = '';
				step = 'verifyEmail';
			}
		} catch (e) {
			if (mode === 'signUp' && isCredentialsError(e)) {
				mode = 'signIn';
				toast.error('An account with this email already exists. Enter your password to sign in.');
			} else {
				toast.error(classifyPasswordError(e));
			}
		} finally {
			isSubmitting = false;
		}
	}

	async function handleResetRequest() {
		if (!email.includes('@')) return;
		isSubmitting = true;

		try {
			await auth.signIn('password', { flow: 'reset', email });
			resetCode = '';
			resetNewPassword = '';
			step = 'resetVerify';
		} catch (e) {
			toast.error(getErrorMessage(e));
		} finally {
			isSubmitting = false;
		}
	}

	async function handleResetVerify() {
		isSubmitting = true;

		try {
			const result = await auth.signIn('password', {
				flow: 'verify',
				email,
				code: resetCode,
				newPassword: resetNewPassword,
			});
			if (result.kind === 'signedIn') {
				window.location.reload();
			} else if (result.kind === 'redirect' && result.redirect) {
				window.location.href = result.redirect.toString();
			}
		} catch (e) {
			toast.error(classifyPasswordError(e));
		} finally {
			isSubmitting = false;
		}
	}

	async function handleVerifyEmail() {
		isSubmitting = true;

		try {
			const result = await auth.signIn('password', {
				flow: 'verify',
				email,
				code: verifyCode,
			});
			if (result.kind === 'signedIn') {
				window.location.reload();
			} else if (result.kind === 'redirect' && result.redirect) {
				window.location.href = result.redirect.toString();
			}
		} catch (e) {
			toast.error(classifyPasswordError(e));
		} finally {
			isSubmitting = false;
		}
	}

	async function handleGoogleSignIn() {
		isSubmitting = true;

		try {
			const result = await auth.signIn('google');
			if (result.kind === 'redirect' && result.redirect) {
				window.location.href = result.redirect.toString();
			} else if (result.kind === 'signedIn') {
				window.location.reload();
			}
		} catch (e) {
			toast.error(getErrorMessage(e));
		} finally {
			isSubmitting = false;
		}
	}

	async function handlePasskeySignIn() {
		if (!auth.webauthn) return;
		isSubmitting = true;

		try {
			const result = await auth.webauthn.signIn();
			if (result.kind === 'redirect' && result.redirect) {
				window.location.href = result.redirect.toString();
			} else if (result.kind === 'signedIn') {
				window.location.reload();
			}
		} catch (e) {
			toast.error(getErrorMessage(e));
		} finally {
			isSubmitting = false;
		}
	}

	function goBackToEmail() {
		step = 'email';
		password = '';
	}

	function goToResetRequest() {
		step = 'resetRequest';
		password = '';
	}

	function goBackToPassword() {
		step = 'password';
		resetCode = '';
		resetNewPassword = '';
	}
</script>

<div class="panel flex w-full max-w-80 flex-col gap-3 rounded-xl border-t-[3px] border-t-brand-red p-5 shadow-[0_24px_80px_rgb(0_0_0_/_0.34)] max-md:max-w-full max-md:rounded-none max-md:border-x-0 max-md:p-4">
	{#if isInvite}
		<p class="font-label text-[0.6875rem] text-content-accent m-0">You've been invited to an organization</p>
	{/if}
	<h2 class="heading text-xl m-0">
		{#if step === 'checking'}
			Loading...
		{:else if step === 'resetRequest'}
			Reset password
		{:else if step === 'resetVerify'}
			Enter your code
		{:else if step === 'verifyEmail'}
			Verify your email
		{:else}
			{mode === 'signIn' ? 'Sign in' : 'Create account'}
		{/if}
	</h2>

	{#if step === 'checking'}
		<p class="muted">Checking your account...</p>

	{:else if step === 'email'}
		{#if passkeySupported}
			<button
				class="button button--secondary button--block"
				disabled={isSubmitting}
				onclick={handlePasskeySignIn}
			>Continue with passkey</button>
			<div class="divider"><span>or</span></div>
		{/if}
		<form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handleEmailContinue(); }}>
			<input
				bind:value={email}
				class="input"
				type="email"
				placeholder="Email"
				autocomplete="email"
			/>
			<button class="button button--accent button--block" disabled={isSubmitting || !email.includes('@')} type="submit">
				{isSubmitting ? 'Checking...' : 'Continue'}
			</button>
		</form>

	{:else if step === 'password'}
		<form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handlePasswordSubmit(); }}>
			{#if !isInvite}
				<button
					class="flex items-center gap-1 font-label text-[0.75rem] text-content-secondary text-left bg-transparent border-0 p-0 cursor-pointer hover:text-content-primary"
					type="button"
					onclick={goBackToEmail}
				><ArrowLeft size="14" />{email}</button>
			{:else}
				<span class="font-label text-[0.75rem] text-content-secondary">{email}</span>
			{/if}
			<input
				bind:value={password}
				class="input"
				type="password"
				placeholder={mode === 'signIn' ? 'Password' : 'Choose a password'}
				autocomplete={mode === 'signIn' ? 'current-password' : 'new-password'}
			/>
			<button class="button button--accent button--block" disabled={isSubmitting} type="submit">
				{#if isSubmitting}
					{mode === 'signIn' ? 'Signing in...' : 'Creating account...'}
				{:else}
					{mode === 'signIn' ? 'Sign in' : 'Create account'}
				{/if}
			</button>
			{#if mode === 'signIn'}
				<button
					class="bg-transparent border-0 p-0 font-label text-[0.75rem] text-content-accent hover:text-content-primary cursor-pointer self-end"
					type="button"
					onclick={goToResetRequest}
				>Forgot password?</button>
			{/if}
		</form>

	{:else if step === 'resetRequest'}
		<form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handleResetRequest(); }}>
			<button
				class="flex items-center gap-1 font-label text-[0.75rem] text-content-secondary text-left bg-transparent border-0 p-0 cursor-pointer hover:text-content-primary"
				type="button"
				onclick={goBackToPassword}
			><ArrowLeft size="14" />Back</button>
			<p class="font-label text-[0.75rem] text-content-secondary m-0">
				Enter the email for your account and we'll send you a code.
			</p>
			<input
				bind:value={email}
				class="input"
				type="email"
				placeholder="Email"
				autocomplete="email"
			/>
			<button
				class="button button--accent button--block"
				disabled={isSubmitting || !email.includes('@')}
				type="submit"
			>
				{isSubmitting ? 'Sending...' : 'Send reset code'}
			</button>
		</form>

	{:else if step === 'resetVerify'}
		<form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handleResetVerify(); }}>
			<button
				class="flex items-center gap-1 font-label text-[0.75rem] text-content-secondary text-left bg-transparent border-0 p-0 cursor-pointer hover:text-content-primary"
				type="button"
				onclick={goToResetRequest}
			><ArrowLeft size="14" />{email}</button>
			<p class="font-label text-[0.75rem] text-content-secondary m-0">
				Check your email for a code, then choose a new password.
			</p>
			<input
				bind:value={resetCode}
				class="input"
				type="text"
				placeholder="Code from email"
				autocomplete="one-time-code"
			/>
			<input
				bind:value={resetNewPassword}
				class="input"
				type="password"
				placeholder="New password"
				autocomplete="new-password"
				minlength={8}
			/>
			<button
				class="button button--accent button--block"
				disabled={isSubmitting || resetCode.length === 0 || resetNewPassword.length < 8}
				type="submit"
			>
				{isSubmitting ? 'Updating...' : 'Update password'}
			</button>
		</form>

	{:else if step === 'verifyEmail'}
		<form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handleVerifyEmail(); }}>
			<span class="font-label text-[0.75rem] text-content-secondary">{email}</span>
			<p class="font-label text-[0.75rem] text-content-secondary m-0">
				Check your email for a verification code.
			</p>
			<input
				bind:value={verifyCode}
				class="input"
				type="text"
				placeholder="Code from email"
				autocomplete="one-time-code"
			/>
			<button
				class="button button--accent button--block"
				disabled={isSubmitting || verifyCode.length === 0}
				type="submit"
			>
				{isSubmitting ? 'Verifying...' : 'Verify email'}
			</button>
		</form>
	{/if}

	{#if authProviders.google && step !== 'checking' && step !== 'resetRequest' && step !== 'resetVerify' && step !== 'verifyEmail'}
		<div class="divider"><span>or</span></div>
		<button
			class="button button--secondary button--block"
			disabled={isSubmitting}
			onclick={handleGoogleSignIn}
		>Continue with Google</button>
	{/if}

	{#if !isInvite && (step === 'email' || step === 'password')}
		<p class="font-label text-[0.75rem] text-content-secondary text-center m-0 mt-1">
			{#if mode === 'signIn'}
				Don't have an account?
				<button class="bg-transparent border-0 p-0 font-label text-[0.75rem] font-semibold text-content-accent hover:text-content-primary cursor-pointer" onclick={() => { mode = 'signUp'; }}>Sign up</button>
			{:else}
				Already have an account?
				<button class="bg-transparent border-0 p-0 font-label text-[0.75rem] font-semibold text-content-accent hover:text-content-primary cursor-pointer" onclick={() => { mode = 'signIn'; }}>Sign in</button>
			{/if}
		</p>
	{/if}
</div>
