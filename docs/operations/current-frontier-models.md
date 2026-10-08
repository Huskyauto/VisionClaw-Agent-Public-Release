# Opus 5.5 and Gemini 3.8 Flash

Verified October 4, 2026 against official publisher documentation and the live
OpenRouter catalog. The owner-visible model-menu function returns both entries.

| Picker label | OpenRouter ID | Input / output per million tokens | Context / maximum output |
|---|---|---|---|
| Claude Opus 5.5 | `anthropic/claude-opus-5.5` | $4 / $20 | 1,000,000 / 128,000 |
| Gemini 3.8 Flash | `google/gemini-3.8-flash` | $0.75 / $3.75 | 1,048,576 / 65,536 |

These are optional **metered OpenRouter** choices, not Profundo subscription
models. Neither appeared in the authenticated Profundo catalog during the check.
The standing automatic defaults, evaluators, subscription mappings, owner spend
ceilings and paid-lane authorization are unchanged. Adding a picker entry does
not authorize spending or guarantee a selected model overrides cost routing.
Without existing metered authorization, substitution/refusal still applies.

Opus 5.5 uses always-on adaptive thinking. Do not request disabled thinking or
forced tool selection; use automatic tools. Do not replay model-specific signed
thinking blocks from older Claude models. Normal application messages and
automatic tool requests remain on the existing OpenRouter-compatible path.

Native Anthropic's ID is `claude-opus-5-5`; it is not interchangeable with the
OpenRouter ID above. This change registers the OpenRouter variants only.
Google's native ID is `gemini-3.8-flash`; the selected entry includes its
OpenRouter namespace. Real-time Live and TTS variants are separate protocols,
not ordinary chat models, and are not registered by this change.

## Evidence and limits
- Official releases and live catalog IDs/prices verified.
- Registry, output/context limits and all three pricing maps regression-tested.
- Actual owner model-menu lookup returns both entries with `costClass: paid`.
- No paid inference was initiated merely to refresh the catalog; account-level
  generation, streaming and tool-use entitlement is not claimed from discovery.
- Restart refreshes the development registry; republish is needed for the live
  site. This change does not publish or change billing configuration.

Sources:
- https://platform.claude.com/docs/en/models/opus-5-5/overview
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://openrouter.ai/api/v1/models