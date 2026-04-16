# Contributing to VisionClaw

Thanks for your interest in contributing! This project welcomes contributions of all kinds — bug fixes, new tools, documentation improvements, and feature ideas.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Follow the setup instructions in [FORK-SETUP.md](FORK-SETUP.md)
4. Create a feature branch: `git checkout -b my-feature`
5. Make your changes
6. Test locally to make sure everything works
7. Commit with a clear message describing what you changed
8. Push to your fork and open a Pull Request

## What We're Looking For

- **Bug fixes** — Found something broken? Fix it and send a PR.
- **New tools** — VisionClaw has 195+ tools. If you build a useful one, we want it.
- **Documentation** — Clearer explanations, better examples, typo fixes — all welcome.
- **Performance improvements** — Faster queries, better caching, reduced token usage.
- **New integrations** — Connect a new service or API provider.
- **UI/UX improvements** — Better layouts, accessibility fixes, responsive design.

## Code Style

- TypeScript throughout (frontend and backend)
- Use existing patterns — look at how similar features are implemented before adding new ones
- Keep changes focused — one feature or fix per PR
- Add `data-testid` attributes to interactive and display elements
- Use the `siteConfig` pattern for any platform branding (never hardcode company names)

## Architecture Notes

- **Frontend:** React 18 + Vite + TailwindCSS + shadcn/ui
- **Backend:** Express.js + Drizzle ORM + PostgreSQL
- **AI:** Multi-provider (OpenAI, Anthropic, xAI, Google, Perplexity, OpenRouter)
- **Tools** are defined in `server/tools.ts` — follow the existing pattern
- **Routes** live in `server/routes.ts` — keep route handlers thin, use the storage interface for data operations

## Pull Request Guidelines

- Describe what your PR does and why
- Reference any related issues
- Make sure the app starts without errors
- Test the feature you changed
- Keep PRs reasonably sized — large PRs are harder to review

## Reporting Issues

Open a GitHub Issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, database)

## Questions?

Open a Discussion on GitHub or reach out via the contact info in the README.
