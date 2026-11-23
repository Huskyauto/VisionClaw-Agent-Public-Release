# Finished but Not Billed

**Offer:** A $175 flat-fee billing reconciliation pilot for HVAC service shops. Review up to 30 recently completed jobs for one shop and return a coded list of exceptions within seven days of receiving usable records. This service does not create invoices, collect debts, or guarantee recovered revenue.

## 1. Qualify and offer the pilot

Look for an owner or office manager who checks completion in one place and verifies billing in another. Ask:

1. Where do you mark a job complete, and where do you verify the invoice went out?
2. Does your current system already give you a reliable list of exceptions? Could you show me how you use it?
3. Can your office prepare a small, coded export with the same job ID across both sources and verify the exceptions this week?

Don't sell the audit if one native report already answers the question reliably or the records cannot be matched without customer identifiers. [Jobber](https://help.getjobber.com/en/articles/invoice-reminders) already flags jobs that require invoicing, and [Housecall Pro](https://help.housecallpro.com/en/articles/8241575-job-estimate-list-reporting) already provides job reports and CSV exports. The value here is checking across records, not duplicating those tools.

**Copy-ready pitch**

> Do you ever close out a service job in one system and have to check another to see if it actually got billed? I’m offering a $175 one-time check for HVAC shops. Your office sends two short lists with coded job numbers, no customer details. I compare up to 30 completed jobs with the invoice records and send back what’s worth checking, what’s on hold, and what I couldn’t verify. Your office decides whether to invoice anything. If your current report already catches it all, I wouldn’t recommend paying for this.

Confirm scope, secure contact, turn time and payment through your existing approved invoicing process. This workbench has no checkout or payment tracking. Agree on the data and date range before starting; if the files are unusable, stop rather than invoice based on guesses. Deliver the findings even if there are zero exceptions.

## 2. Prepare the records

Get permission from the shop and ask the office to prepare **two small CSVs** in its own spreadsheet. Scope them to the same completed-job batch, using their current billing records. Include invoices sent after the completion date. Use a fresh coded ID like `J-101` consistently across both lists. The shop keeps the private lookup from codes to its real job records. Strip names, addresses, emails, phone numbers, payment details, job notes and other columns before sharing.

**Completed jobs** — up to 30, one row per job:

```csv
job_id,completed_date,billing_status
J-101,2026-11-03,READY
J-102,2026-11-04,READY
J-103,2026-11-05,HOLD
```

- `completed_date`: `YYYY-MM-DD`.
- `billing_status`: `READY` if the office says the job can go through its normal billing check; `HOLD` for a known hold; `NON_BILLABLE` for intentional no-charge work; `UNKNOWN` if the office cannot tell.

**Invoice records** — up to 300. Include every known related invoice state, with one row per record; the same job ID may appear on several invoice records:

```csv
job_id,invoice_status
J-101,SENT
```

- `invoice_status`: `SENT`, `PAID`, `DRAFT`, `VOID`, or `UNKNOWN`. Use just the header only if the office confirms no related invoice records exist.
- Verify that both lists refer to the same shop and share the same code mapping. No ID match means **check**, never **invoice**. If an invoice only covers a deposit or partial billing, reconcile the remaining amount in the shop's billing system; this pilot does not compare amounts.

## 3. Run and review

1. In VisionClaw, open **Income Products → Finished but Not Billed**. There is also a shortcut in **Business Pilot Tools**.
2. Try **Load fictional example** first if you want to see the workflow without customer data. For a live batch, paste the two sanitized CSVs into their respective fields, confirm the coverage check, and choose **Review batch**.
3. Resolve input errors in the spreadsheet. Compare the counts and investigate any invoice records outside the job batch; they may reflect normal scope or a mismatched mapping. The workbench does not determine which.
4. Review the findings with the office:

   | Finding | What to do |
   | --- | --- |
   | Verify for invoicing | No sent or paid invoice matched a job marked `READY`. Recheck billing records including duplicates, holds, split billing and offline invoices. |
   | Insufficient information | Resolve an unknown job status or an invoice record only marked draft, void or unknown. Update the source and rerun if warranted. |
   | Billing hold / Non-billable | Respect the supplied office status. Reconcile any conflicting facts with the office. |
   | Conflicting job and invoice statuses | A sent or paid invoice already exists for a held or non-billable job. Ask the office to reconcile the records; don't treat this as a missing invoice. |
   | Sent or paid invoice found | Do not flag a missing invoice. This does not verify the amount, balance, completeness, or collection. |

5. Mark a candidate **Confirmed by office** only after the office verifies it; use **Not an exception** for cleared items. Keep unresolved candidates pending. If you edit a source, rerun and review the results again before exporting. The browser stores nothing after you close or reload the page, so export before leaving.

## 4. Hand off and learn

- Export the **handoff CSV**, preview it in a spreadsheet, and check the batch, row count, and review labels. Verify the exact recipient with the shop before handing it over through your approved secure channel. No integration is necessary; never send the raw source files back with the report. Keep or delete your local copies under the scope you agreed with the shop. If the tab closes before export, rerun from the shop's source files; do not reconstruct decisions from memory.
- Take 15 minutes to walk the office through the exceptions. The office alone decides whether and when to send an invoice. Count **invoices sent** and **cash collected** separately, arm's length from the report.
- Aim for three hours total including selling, handling the files, and the handoff. Existing tools require **$0 in new software purchases**. At $175 minus three hours at $45/hour and a $5 payment allowance, the planned contribution is **$35 before overhead and taxes**. Track actual time and direct costs rather than treating this estimate as margin.
- **Week-one go/no-go:** Offer it to five owners you know. Continue the manual pilot only if one pays, delivery stays within three hours, and the office confirms and issues invoices for at least two genuinely overlooked jobs within seven days. Then ask whether they would pay for another reconciliation. If not, don't add integrations, recurring automation, or a checkout page.
