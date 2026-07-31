<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import '../app.css';
	import Sidebar from '$lib/components/docs/Sidebar.svelte';
	import MobileNav from '$lib/components/docs/MobileNav.svelte';
	import SearchDialog from '$lib/components/docs/SearchDialog.svelte';
	import { tableOverflow } from '$lib/utils/tableOverflow';

	let { children } = $props();
	let mobileNavOpen = $state(false);
	let searchOpen = $state(false);

	const routePath = $derived(page.url.pathname.slice(base.length) || '/');
	const isLanding = $derived(routePath === '/');

	function openSearch() {
		mobileNavOpen = false;
		searchOpen = true;
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			searchOpen = !searchOpen;
		}
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<svelte:head>
	<title>convex-auth</title>
	<meta
		name="description"
		content="Authentication infrastructure for Convex applications, from first sign-in to enterprise identity."
	/>
</svelte:head>

<a class="skip-link" href="#main-content">Skip to documentation</a>

<div class={['floating-controls', isLanding ? 'landing-controls' : 'docs-controls']}>
	{#if !isLanding}
		<button
			class="utility-button"
			onclick={() => (mobileNavOpen = true)}
			aria-label="Open documentation menu"
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.5" />
			</svg>
		</button>
	{/if}

	<button class="utility-button" onclick={openSearch} aria-label="Search documentation">
		<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M21.71 20.29 18 16.61A9 9 0 1 0 16.61 18l3.68 3.68a.999.999 0 0 0 1.42 0 1 1 0 0 0 0-1.39ZM11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
		</svg>
	</button>
</div>

<MobileNav bind:open={mobileNavOpen} onSearch={openSearch} />
<SearchDialog bind:open={searchOpen} />

{#if isLanding}
	<main id="main-content" class="landing" data-pagefind-body>
		{#key page.url.pathname}
			{@render children()}
		{/key}
	</main>
{:else}
	<div class="docs-layout">
		<div class="sidebar-container" aria-label="Documentation navigation">
			<Sidebar onSearch={openSearch} />
		</div>
		<main id="main-content" class="docs-main">
			<div class="doc-content" data-pagefind-body {@attach tableOverflow} tabindex="-1">
				{#key page.url.pathname}
					{@render children()}
				{/key}
			</div>
		</main>
	</div>
{/if}

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		width: 100%;
		overflow-x: hidden;
	}

	:global(body) {
		padding-top: 0;
	}

	.skip-link {
		position: fixed;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 100;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--accent);
		background: var(--surface-raised);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: 0.68rem;
		letter-spacing: 0.04em;
		transform: translateY(-200%);
		transition: transform 140ms ease;
	}

	.skip-link:focus {
		transform: translateY(0);
	}

	.docs-layout {
		min-height: 100dvh;
		background: var(--bg);
	}

	.sidebar-container {
		display: none;
	}

	.docs-main {
		width: 100%;
		min-width: 0;
		padding: var(--brand-edge) var(--brand-edge) 5rem;
	}

	.doc-content {
		width: min(100%, 48rem);
		margin: 0;
	}

	@media (min-width: 56rem) {
		.sidebar-container {
			display: block;
			position: fixed;
			top: 0;
			bottom: 0;
			left: 0;
			width: var(--shell-sidebar-width);
			border-right: 1px solid var(--line);
			background: var(--surface);
			z-index: 10;
		}

		.docs-controls {
			display: none;
		}

		.docs-main {
			margin-left: var(--shell-sidebar-width);
			padding: var(--brand-edge) var(--brand-edge) 7rem;
		}
	}

	.landing {
		display: flex;
		width: 100%;
		height: 100dvh;
		align-items: flex-end;
		margin: 0;
		padding: var(--brand-edge);
		overflow: hidden;
	}

	.floating-controls {
		position: fixed;
		z-index: 20;
		display: flex;
		gap: 0.5rem;
	}

	.landing-controls {
		top: var(--brand-edge);
		right: var(--brand-edge);
	}

	.docs-controls {
		top: var(--brand-edge-mobile);
		right: var(--brand-edge-mobile);
		left: var(--brand-edge-mobile);
		justify-content: space-between;
	}

	.utility-button {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		place-items: center;
		border: 1px solid var(--line);
		background: rgba(15, 16, 12, 0.86);
		color: var(--muted);
		backdrop-filter: blur(12px);
		cursor: pointer;
	}

	.utility-button:hover {
		border-color: var(--line-strong);
		color: var(--ink);
	}

	@media (max-width: 55.999rem) {
		.docs-main {
			padding-top: calc(var(--brand-edge-mobile) + 4.25rem);
		}
	}

	@media (max-width: 47.999rem) {
		.landing {
			padding-bottom: 6rem;
		}
	}
</style>
