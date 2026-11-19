# GPT-6.2 owner model choices

GPT-6.2 Sol and Astra are explicit model-picker options for the platform owner.
Choose Sol for most high-end work and Astra for harder final reasoning. Claude
Fable 5.2 remains independently available through its existing Anthropic route
and 30-day provider retention policy. Manual selection does not change standard
chat defaults, Profundo, the old Astra finisher, or Replit Agent's own model.

## Owner-requested frontier jury

When the authenticated owner explicitly asks to run the default jury and
Profundo is off, the preferred panel is Openference DeepSeek V4 Pro,
OpenAI GPT-6.2 Sol, and Anthropic Claude Fable 5.2. Astra is manual only:
it does not give OpenAI a second ballot or add a metered synthesis call.
The existing synthesis and bounded recovery policy remain in place; the
same paid provider is not called a second time during seat recovery.
Use a new direct command such as “Run the jury on these two proposals.”

This panel requires `OWNER_JURY_DIRECT_API_ENABLED=1`. Exact
`OWNER_FRONTIER_REFRESH_DISABLED=1` restores the prior roster without disabling
manual model selection. Each new vote requires both the existing owner-jury
ceiling and the provider's durable shared $30 paid-AI reservation. At 8,192
Sol and 16,384 Fable output tokens, published short-context output rates
alone have upper bounds of about $0.082 and $0.656, plus input. Each provider is
asked once; the host requires a complete exact-model ballot and recorded usage.
A single failed ballot cannot become a consensus. Existing authorization,
request evidence checks, report/income paths, and autonomous loops are unchanged.

## Design boundaries

1. Standard OpenAI rates per million tokens are $2/$10 input/output for Sol
   and $8/$40 for Astra. Above 272K input tokens the whole request costs 2×
   input and 1.5× output. Reserve worst-case tokens and cache writes per call
   against the existing $30 UTC-day aggregate cap; no retries after failure.
2. No new durable storage: use the existing spend reservations and ledger.
3. Missing credentials, usage or ledger persistence fail closed. An uncertain
   dispatch retains its hold and cannot be repeated on its client. An observed
   overrun retains a larger hold.
4. One server-owned reservation UUID per dispatch, with no transport retry.
   Subsequent successful tool rounds are separately reserved and charged.
5. Only authenticated, explicit owner selection can resolve a client; the
   active owner tenant is required again at dispatch. Existing tool gates stay.
6. `OPENAI_GPT_62_DISABLED=1` stops selection and new dispatch. The exact
   provider model ID and usage ledger distinguish a real success from discovery.
7. The owner chooses the model. Existing policy and tools retain authority;
   the model cannot authorize its own budget or disable protections.
8. Verify exact identity, cost, pre-dispatch gating, audited stream release and
   exclusion from automatic defaults. A catalog hit is not generation evidence.

Sources: [Sol](https://developers.openai.com/api/docs/models/gpt-6.2-sol),
[Astra](https://developers.openai.com/api/docs/models/gpt-6.2-astra), and
[OpenAI pricing](https://developers.openai.com/api/docs/pricing).
