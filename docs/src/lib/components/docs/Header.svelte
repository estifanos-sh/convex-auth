<script lang="ts">
	import { base } from '$app/paths';
	import SearchDialog from './SearchDialog.svelte';

	let { onMenuToggle }: { onMenuToggle?: () => void } = $props();
	let searchOpen = $state(false);

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			searchOpen = !searchOpen;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<header class="header">
	<div class="header-inner">
		<div class="left">
			{#if onMenuToggle}
				<button class="menu-btn" onclick={onMenuToggle} aria-label="Open documentation menu">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.5" />
					</svg>
				</button>
			{/if}

			<a class="brand" href={`${base}/`} aria-label="convex-auth documentation home">
				<span class="brand-mark" aria-hidden="true"><span></span></span>
				<span>convex-auth</span>
				<span class="brand-label">docs</span>
			</a>
		</div>

		<div class="right">
			<button class="search-btn" onclick={() => (searchOpen = true)}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M21.71 20.29 18 16.61A9 9 0 1 0 16.61 18l3.68 3.68a.999.999 0 0 0 1.42 0 1 1 0 0 0 0-1.39ZM11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
				</svg>
				<span class="search-label">Search</span>
				<kbd>⌘ K</kbd>
			</button>

			<a href="https://github.com/robelest/convex-auth" class="icon-link" aria-label="GitHub">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.08 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3Z" />
				</svg>
			</a>
		</div>
	</div>
</header>

<SearchDialog bind:open={searchOpen} />

<style>
	.header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 20;
		height: 4rem;
		border-bottom: 1px solid var(--line);
		background: rgba(15, 16, 12, 0.86);
		backdrop-filter: blur(16px);
	}

	.header-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		height: 100%;
		padding: 0 clamp(1rem, 2vw, 1.5rem);
	}

	.left,
	.right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		color: var(--ink);
		font-size: 0.95rem;
		font-weight: 500;
		letter-spacing: -0.015em;
		text-decoration: none;
	}

	.brand:hover {
		color: var(--ink);
	}

	.brand-mark {
		position: relative;
		width: 0.8rem;
		height: 0.8rem;
		border: 1px solid var(--line-strong);
	}

	.brand-mark::before,
	.brand-mark::after,
	.brand-mark span {
		content: '';
		position: absolute;
		width: 2px;
		height: 2px;
		background: var(--accent);
	}

	.brand-mark::before {
		top: 2px;
		left: 2px;
	}

	.brand-mark::after {
		right: 2px;
		bottom: 2px;
	}

	.brand-mark span {
		top: 5px;
		left: 5px;
	}

	.brand-label {
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: 0.55rem;
		font-weight: 400;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.menu-btn {
		display: none;
		width: 2rem;
		height: 2rem;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}

	.menu-btn:hover {
		border-color: var(--line-strong);
		color: var(--ink);
	}

	@media (max-width: 55.999rem) {
		.menu-btn {
			display: flex;
		}
	}

	.search-btn {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: clamp(9rem, 20vw, 15rem);
		height: 2rem;
		padding: 0 0.65rem;
		border: 1px solid var(--line);
		background: rgba(231, 226, 214, 0.025);
		color: var(--muted);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.search-btn:hover {
		border-color: var(--line-strong);
		color: var(--ink-2);
	}

	.search-label {
		flex: 1;
		text-align: left;
	}

	kbd {
		color: var(--faint);
		font-family: var(--font-mono);
		font-size: 0.55rem;
		letter-spacing: 0.02em;
	}

	.icon-link {
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		border: 1px solid transparent;
		color: var(--muted);
		text-decoration: none;
	}

	.icon-link:hover {
		border-color: var(--line);
		color: var(--ink);
	}

	@media (max-width: 34rem) {
		.brand-label,
		.search-label,
		.search-btn kbd {
			display: none;
		}

		.search-btn {
			width: 2rem;
			justify-content: center;
			padding: 0;
		}
	}
</style>
