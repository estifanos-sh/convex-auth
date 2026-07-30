<script lang="ts">
	import { base } from '$app/paths';
	import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
	import ArrowUpRight from 'phosphor-svelte/lib/ArrowUpRight';
</script>

<svelte:head>
	<title>convex-auth — Authentication that belongs in your Convex app</title>
	<meta
		name="description"
		content="Type-safe authentication for Convex, from sign-in to enterprise SSO."
	/>
</svelte:head>

<div class="home">
	<section class="hero" aria-labelledby="hero-title">
		<p class="eyebrow">
			<span aria-hidden="true">CA</span>
			Authentication for Convex
		</p>

		<h1 id="hero-title">
			Auth that belongs
			<span>in your Convex app.</span>
		</h1>

		<p class="lede">
			One component for users, sessions, permissions, and enterprise connections. Defined in
			TypeScript and deployed with the rest of your backend.
		</p>

		<div class="hero-actions">
			<a class="primary-link" href={`${base}/getting-started/installation/`}>
				Start building
				<ArrowRight size={16} weight="bold" aria-hidden="true" />
			</a>
			<a class="text-link" href="https://github.com/robelest/convex-auth">
				GitHub
				<ArrowUpRight size={15} aria-hidden="true" />
			</a>
		</div>

		<ul class="capabilities" aria-label="Highlights">
			<li>TypeScript first</li>
			<li>OAuth, passkeys, and credentials</li>
			<li>Groups, SSO, and SCIM</li>
		</ul>
	</section>

	<section class="setup" aria-labelledby="setup-title">
		<header class="section-heading">
			<p class="eyebrow">The short path</p>
			<div>
				<h2 id="setup-title">Four moves to signed in.</h2>
				<p>Use the setup wizard, or wire the same pieces by hand.</p>
			</div>
		</header>

		<ol class="steps">
			<li>
				<div class="step-copy">
					<span class="step-number" aria-hidden="true">01</span>
					<div>
						<h3>Install</h3>
						<p>Add the package, start Convex, and run the setup wizard.</p>
						<a href={`${base}/getting-started/installation/`}>Installation guide <span>→</span></a>
					</div>
				</div>
				<pre aria-label="Install convex-auth"><code>pnpm add @robelest/convex-auth
pnpx convex dev
pnpx @robelest/convex-auth</code></pre>
			</li>

			<li>
				<div class="step-copy">
					<span class="step-number" aria-hidden="true">02</span>
					<div>
						<h3>Define auth</h3>
						<p>Choose providers once. The returned handle owns the full server API.</p>
						<a href={`${base}/getting-started/providers/`}>Choose providers <span>→</span></a>
					</div>
				</div>
				<pre aria-label="Define authentication"><code>export const auth = defineAuth(components.auth, &#123;
  providers: [github(&#123; clientId, clientSecret &#125;)]
&#125;);

export const &#123; signIn, signOut, store &#125; = auth;</code></pre>
			</li>

			<li>
				<div class="step-copy">
					<span class="step-number" aria-hidden="true">03</span>
					<div>
						<h3>Mount HTTP</h3>
						<p>Add auth routes to your existing Convex HTTP router.</p>
						<a href={`${base}/reference/config/`}>Configuration <span>→</span></a>
					</div>
				</div>
				<pre aria-label="Mount authentication routes"><code>const http = httpRouter();

auth.request.mount(http);

export default http;</code></pre>
			</li>

			<li>
				<div class="step-copy">
					<span class="step-number" aria-hidden="true">04</span>
					<div>
						<h3>Connect the client</h3>
						<p>Give the framework provider one typed browser client.</p>
						<a href={`${base}/client/react/`}>React client <span>→</span></a>
						<a href={`${base}/client/svelte/`}>Svelte client <span>→</span></a>
					</div>
				</div>
				<pre aria-label="Connect the browser client"><code>const auth = createAuthClient(&#123;
  convex,
  url: convexUrl,
  api: api.auth
&#125;);

&lt;ConvexAuthProvider &#123;auth&#125;&gt;...&lt;/ConvexAuthProvider&gt;</code></pre>
			</li>
		</ol>
	</section>

	<section class="next" aria-labelledby="next-title">
		<div>
			<p class="eyebrow">Grow deliberately</p>
			<h2 id="next-title">Add only what your app needs.</h2>
		</div>
		<nav aria-label="Next steps">
			<a href={`${base}/guides/authorization/`}>Permissions <span>→</span></a>
			<a href={`${base}/ssr/overview/`}>Server rendering <span>→</span></a>
			<a href={`${base}/connection/overview/`}>Enterprise SSO <span>→</span></a>
			<a href={`${base}/api/user/`}>API reference <span>→</span></a>
		</nav>
	</section>
</div>

<style>
	.home {
		width: min(72rem, 100%);
		margin: 0 auto;
	}

	.hero {
		padding: clamp(3.5rem, 9vw, 8rem) 0 clamp(3rem, 7vw, 6rem);
	}

	.eyebrow {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0;
		color: var(--muted);
		font-family: var(--font-label);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		line-height: 1;
		text-transform: uppercase;
	}

	.eyebrow > span {
		display: grid;
		width: 1.75rem;
		height: 1.75rem;
		place-items: center;
		border: 1px solid var(--line-strong);
		color: var(--ink-2);
		font-family: var(--font-mono);
		font-size: 0.5625rem;
		letter-spacing: 0.03em;
	}

	h1,
	h2,
	h3,
	p {
		margin-top: 0;
	}

	h1 {
		max-width: 13ch;
		margin: clamp(1.5rem, 3vw, 2.5rem) 0 1.5rem;
		color: var(--ink);
		font-family: var(--font-display);
		font-size: clamp(3.4rem, 9vw, 7.25rem);
		font-weight: 400;
		letter-spacing: -0.055em;
		line-height: 0.88;
		text-wrap: balance;
	}

	h1 span {
		display: block;
		color: var(--accent);
		font-style: italic;
	}

	.lede {
		max-width: 48ch;
		margin-bottom: 2rem;
		color: var(--ink-2);
		font-size: clamp(1.05rem, 2vw, 1.3rem);
		line-height: 1.55;
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1.5rem;
	}

	.primary-link,
	.text-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-label);
		font-size: 0.8125rem;
		font-weight: 600;
		text-decoration: none;
	}

	.primary-link {
		min-height: 2.75rem;
		padding: 0 1.125rem;
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--bg);
	}

	.primary-link:hover,
	.primary-link:focus-visible {
		background: color-mix(in srgb, var(--accent) 86%, var(--ink));
		color: var(--bg);
	}

	.text-link {
		color: var(--muted);
	}

	.text-link:hover,
	.text-link:focus-visible {
		color: var(--ink);
	}

	.capabilities {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem 1.5rem;
		margin: clamp(3rem, 7vw, 6rem) 0 0;
		padding: 1rem 0 0;
		border-top: 1px solid var(--line);
		color: var(--muted);
		font-family: var(--font-label);
		font-size: 0.6875rem;
		letter-spacing: 0.02em;
		list-style: none;
	}

	.capabilities li:not(:first-child)::before {
		content: '/';
		margin-right: 1.5rem;
		color: var(--faint);
	}

	.setup {
		border-top: 1px solid var(--line-strong);
	}

	.section-heading {
		display: grid;
		grid-template-columns: minmax(9rem, 0.65fr) minmax(0, 1.35fr);
		gap: 2rem;
		padding: clamp(2rem, 5vw, 4rem) 0;
	}

	.section-heading h2,
	.next h2 {
		margin-bottom: 0.5rem;
		color: var(--ink);
		font-family: var(--font-display);
		font-size: clamp(2rem, 4vw, 3rem);
		font-weight: 400;
		letter-spacing: -0.035em;
		line-height: 1;
	}

	.section-heading div > p {
		margin-bottom: 0;
		color: var(--muted);
	}

	.steps {
		margin: 0;
		padding: 0;
		border-bottom: 1px solid var(--line);
		list-style: none;
	}

	.steps > li {
		display: grid;
		grid-template-columns: minmax(16rem, 0.85fr) minmax(0, 1.15fr);
		gap: clamp(2rem, 6vw, 6rem);
		padding: clamp(1.5rem, 4vw, 2.75rem) 0;
		border-top: 1px solid var(--line);
	}

	.step-copy {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr);
		gap: 0.75rem;
	}

	.step-number {
		padding-top: 0.2rem;
		color: var(--accent);
		font-family: var(--font-mono);
		font-size: 0.625rem;
		font-weight: 600;
	}

	.step-copy h3 {
		margin-bottom: 0.45rem;
		color: var(--ink);
		font-family: var(--font-label);
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.step-copy p {
		max-width: 31ch;
		margin-bottom: 0.85rem;
		color: var(--ink-2);
		line-height: 1.5;
	}

	.step-copy a {
		display: inline-flex;
		gap: 0.3rem;
		margin: 0.25rem 0.85rem 0.25rem 0;
		color: var(--ink-2);
		font-family: var(--font-label);
		font-size: 0.6875rem;
		font-weight: 600;
		text-decoration: none;
	}

	.step-copy a:hover,
	.step-copy a:focus-visible {
		color: var(--accent);
	}

	.steps pre {
		align-self: start;
		margin: 0;
		padding: 1.1rem 1.25rem;
		overflow-x: auto;
		border: 1px solid var(--line);
		background: var(--surface-soft);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: clamp(0.68rem, 1.3vw, 0.78rem);
		line-height: 1.7;
		tab-size: 2;
	}

	.next {
		display: grid;
		grid-template-columns: minmax(14rem, 1fr) minmax(0, 1fr);
		gap: 3rem;
		padding: clamp(4rem, 9vw, 8rem) 0 clamp(2rem, 5vw, 4rem);
	}

	.next .eyebrow {
		margin-bottom: 1rem;
	}

	.next nav {
		display: grid;
		align-content: start;
		border-top: 1px solid var(--line);
	}

	.next nav a {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.8rem 0;
		border-bottom: 1px solid var(--line);
		color: var(--ink-2);
		font-family: var(--font-label);
		font-size: 0.75rem;
		font-weight: 600;
		text-decoration: none;
	}

	.next nav a:hover,
	.next nav a:focus-visible {
		color: var(--accent);
	}

	@media (max-width: 700px) {
		.hero {
			padding-top: 3rem;
		}

		h1 {
			font-size: clamp(3rem, 15vw, 5rem);
		}

		.capabilities {
			display: grid;
			gap: 0.4rem;
		}

		.capabilities li:not(:first-child)::before {
			margin-right: 0.75rem;
		}

		.section-heading,
		.steps > li,
		.next {
			grid-template-columns: 1fr;
		}

		.section-heading {
			gap: 1.5rem;
		}

		.steps > li {
			gap: 1.5rem;
		}

		.next {
			gap: 2rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.primary-link,
		.text-link,
		.step-copy a,
		.next nav a {
			transition: none;
		}
	}
</style>
