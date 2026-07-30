<script lang="ts">
	import { base } from '$app/paths';
</script>

<svelte:head>
	<title>convex-auth documentation</title>
	<meta
		name="description"
		content="Technical documentation for @robelest/convex-auth."
	/>
</svelte:head>

<section class="cover" aria-labelledby="cover-title">
	<div class="cover-copy">
		<h1 id="cover-title">convex-auth</h1>
		<p class="summary">Authentication and authorization for Convex applications.</p>
	</div>

	<div class="install" aria-label="Install convex-auth">
		<span>Install</span>
		<code>pnpm add @robelest/convex-auth</code>
	</div>

	<nav class="entry-points" aria-label="Documentation entry points">
		<a href={`${base}/getting-started/installation/`}>
			<span>Get started</span>
			<span aria-hidden="true">→</span>
		</a>
		<a href="https://tangible-snake-149.convex.site/demo/">
			<span>View demo</span>
			<span aria-hidden="true">→</span>
		</a>
	</nav>
</section>

<style>
	.cover {
		display: grid;
		width: min(100%, 52rem);
		gap: clamp(1.5rem, 4vh, 2.5rem);
	}

	h1 {
		margin: 0;
		color: var(--ink);
		font-family: var(--font-display);
		font-size: clamp(3.25rem, min(9vw, 11vh), 6.5rem);
		font-weight: 500;
		letter-spacing: -0.06em;
		line-height: 0.92;
	}

	.summary {
		max-width: 40ch;
		margin: clamp(0.9rem, 2vh, 1.25rem) 0 0;
		color: var(--ink-2);
		font-size: clamp(1rem, min(2.5vw, 2.5vh), 1.2rem);
		line-height: 1.5;
	}

	.install {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 1rem;
		width: min(100%, 36rem);
		min-height: 3.25rem;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--line-strong);
		background: rgba(11, 12, 9, 0.72);
	}

	.install span {
		color: var(--muted);
		font-family: var(--font-label);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.install code {
		min-width: 0;
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: clamp(0.68rem, 1.8vw, 0.78rem);
		overflow-wrap: anywhere;
	}

	.entry-points {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		width: min(100%, 36rem);
		border-top: 1px solid var(--line);
		border-left: 1px solid var(--line);
	}

	.entry-points a {
		display: flex;
		min-height: 2.8rem;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.65rem 0.8rem;
		border-right: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		color: var(--ink-2);
		font-family: var(--font-label);
		font-size: 0.68rem;
		font-weight: 500;
		text-decoration: none;
	}

	.entry-points a span:last-child {
		color: var(--faint);
	}

	.entry-points a:hover,
	.entry-points a:focus-visible {
		background: var(--accent-soft);
		color: var(--ink);
	}

	.entry-points a:hover span:last-child,
	.entry-points a:focus-visible span:last-child {
		color: var(--accent);
	}

	@media (max-width: 34rem) {
		.cover {
			gap: 1.3rem;
		}

		.install {
			grid-template-columns: 1fr;
			gap: 0.35rem;
		}

		.entry-points {
			grid-template-columns: 1fr;
		}
	}

	@media (max-height: 34rem) and (min-width: 35rem) {
		.cover {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.7fr);
			align-items: end;
		}

		.install,
		.entry-points {
			width: 100%;
		}

		.entry-points {
			grid-column: 1 / -1;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-height: 38rem) and (max-width: 34rem) {
		.cover {
			gap: 0.75rem;
		}

		h1 {
			font-size: clamp(2.6rem, 10vh, 3.4rem);
		}

		.summary {
			margin-top: 0.6rem;
			font-size: 0.9rem;
		}

		.install {
			min-height: 0;
			padding: 0.5rem 0.7rem;
		}

		.entry-points a {
			min-height: 2.2rem;
			padding: 0.4rem 0.65rem;
		}
	}
</style>
