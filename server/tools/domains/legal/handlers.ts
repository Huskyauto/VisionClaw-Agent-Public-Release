/**
 * Tools-layer-split S18 — legal-domain migrated handlers.
 *
 * TWO handler shapes:
 *
 * 1. Contract trio (create_contract / list_contracts / update_contract_status)
 *    — DB-backed, dispatch into ./business-tools. In the legacy facade each was
 *    a switch arm of the form:
 *      const biz = await import("./business-tools");
 *      return biz.<fn>({ ...params, tenant_id: params._tenantId });
 *    Mechanical move: the ONLY edit is params._tenantId -> ctx.tenantId (the
 *    dispatcher strips + re-stamps it from the trusted context). VERIFIED SAFE:
 *    the 3 business-tools fns read the tenant solely via
 *    tenantGuard(params.tenant_id) (throws on a falsy value — the legacy arms
 *    had no explicit gate, so fail-closed behavior is unchanged) and read NO
 *    _-prefixed trust signal, so passing the dispatcher-stripped params
 *    alongside tenant_id: ctx.tenantId is behavior-identical.
 *
 * 2. Legal-document pair (legal_review / generate_legal_document) — PURE logic:
 *    verbatim copies of the legacy switch-arm bodies (inline RISK_PATTERNS /
 *    PROTECTIVE_CLAUSES / TEMPLATES). They read NO DB, NO tenant, NO ctx, and NO
 *    tools.ts module-scope helper, so stripTrustSignals is behavior-neutral and
 *    ctx is unused (named _ctx). Bodies moved byte-for-byte — no renames, no
 *    logic edits.
 *
 * The sole external dependency of the contract trio (../../../business-tools) is
 * pulled via a call-time dynamic import(...) inside each handler — NOT a
 * top-level static import — so the domain module statically imports only within
 * server/tools/ and cannot recurse into the app graph (acyclicity invariant,
 * plan.md S2; same seam S8-S17 used). No tools.ts module-scope helpers moved.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  createContractDefinition,
  listContractsDefinition,
  updateContractStatusDefinition,
  legalReviewDefinition,
  generateLegalDocumentDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Contract trio (DB-backed; dispatch into business-tools)
// ---------------------------------------------------------------------------

async function createContractHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.createContract({ ...params, tenant_id: ctx.tenantId });
}

async function listContractsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.listContracts({ ...params, tenant_id: ctx.tenantId });
}

async function updateContractStatusHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.updateContractStatus({ ...params, tenant_id: ctx.tenantId });
}

// ---------------------------------------------------------------------------
// Legal-document pair (PURE logic; verbatim switch-arm bodies; ctx unused)
// ---------------------------------------------------------------------------

async function legalReviewHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
      const docText = typeof params.document_text === "string" ? params.document_text.trim() : "";
      if (!docText) return { error: "document_text is required" };
      if (docText.length > 500_000) return { error: "Document too large — max 500,000 characters" };
      const docType = params.document_type || "contract";
      const perspective = typeof params.party_perspective === "string" ? params.party_perspective.slice(0, 200) : "reviewing party";
      const industry = typeof params.industry === "string" ? params.industry.slice(0, 200) : "general";
      const jurisdiction = typeof params.jurisdiction === "string" ? params.jurisdiction.slice(0, 200) : "US";

      const lowerDoc = docText.toLowerCase();
      const wordCount = docText.split(/\s+/).filter(Boolean).length;

      const RISK_PATTERNS: { pattern: RegExp; label: string; severity: "high" | "medium" | "low"; category: string; explanation: string }[] = [
        { pattern: /indemnif(y|ication|ies)/gi, label: "Indemnification Clause", severity: "high", category: "liability", explanation: "Requires one party to cover losses/damages of the other. Can create unlimited financial exposure." },
        { pattern: /unlimited liability/gi, label: "Unlimited Liability", severity: "high", category: "liability", explanation: "No cap on damages. This can expose you to catastrophic financial risk." },
        { pattern: /non[- ]?compete/gi, label: "Non-Compete Clause", severity: "high", category: "restrictive", explanation: "Restricts your ability to work with competitors or in the same industry after the agreement ends." },
        { pattern: /non[- ]?solicit/gi, label: "Non-Solicitation", severity: "medium", category: "restrictive", explanation: "Prevents recruiting or doing business with the other party's clients/employees." },
        { pattern: /intellectual property.{0,50}(assign|transfer|vest|belong)/gi, label: "IP Assignment", severity: "high", category: "ip", explanation: "Transfers ownership of intellectual property. Ensure scope is limited to work product only." },
        { pattern: /work[- ]?for[- ]?hire/gi, label: "Work-for-Hire", severity: "medium", category: "ip", explanation: "Creator has no ownership of work produced. Standard for employment but risky for freelancers." },
        { pattern: /(perpetual|irrevocable|worldwide).{0,30}license|(license|grant).{0,30}(perpetual|irrevocable|worldwide)/gi, label: "Perpetual/Irrevocable License", severity: "high", category: "ip", explanation: "Grants permanent, non-cancelable rights. Very difficult to undo once signed." },
        { pattern: /auto[- ]?renew|automatic.*renewal/gi, label: "Auto-Renewal", severity: "medium", category: "term", explanation: "Contract renews automatically. Check notice period to cancel — often 30-90 days before renewal." },
        { pattern: /terminat(e|ion).{0,80}(without cause|for convenience|at any time)/gi, label: "Termination Without Cause", severity: "high", category: "term", explanation: "Allows termination without reason. Check if both parties have equal termination rights." },
        { pattern: /liquidated damages/gi, label: "Liquidated Damages", severity: "high", category: "liability", explanation: "Pre-set penalty amounts for breach. Can be disproportionately large." },
        { pattern: /waiv(e|er|ing).{0,30}(right|claim|jury|trial)/gi, label: "Rights Waiver", severity: "high", category: "legal", explanation: "Gives up legal rights including right to jury trial. Significantly limits legal recourse." },
        { pattern: /arbitration|binding mediation/gi, label: "Mandatory Arbitration", severity: "medium", category: "legal", explanation: "Disputes resolved through arbitration instead of court. Can be costly and may favor the drafting party." },
        { pattern: /confidential(ity)?.{0,30}(surviv|perpetual|indefinite)/gi, label: "Perpetual Confidentiality", severity: "medium", category: "confidentiality", explanation: "Confidentiality obligations that never expire. Standard for trade secrets but burdensome for general info." },
        { pattern: /penalty|penalt(y|ies).{0,30}(late|breach|fail)/gi, label: "Penalty Clauses", severity: "medium", category: "liability", explanation: "Financial penalties for late delivery or breach. Ensure amounts are reasonable and proportionate." },
        { pattern: /force majeure/gi, label: "Force Majeure", severity: "low", category: "protection", explanation: "Excuses performance during extraordinary events (war, pandemic, natural disaster). Generally protective." },
        { pattern: /governing law|governed by/gi, label: "Governing Law", severity: "low", category: "legal", explanation: "Specifies which jurisdiction's law applies. Important for dispute resolution." },
        { pattern: /limitation of liability/gi, label: "Liability Cap", severity: "medium", category: "liability", explanation: "Caps maximum damages. Favorable if you're the service provider; review the cap amount carefully." },
        { pattern: /sole discretion|absolute discretion/gi, label: "Sole Discretion Clause", severity: "high", category: "control", explanation: "Gives one party unilateral decision-making power. Watch for imbalanced application." },
        { pattern: /assign(ment)?.{0,30}(without|prior)?.{0,20}consent/gi, label: "Assignment Restriction", severity: "low", category: "control", explanation: "Limits ability to transfer the contract. Standard but check if it's mutual." },
        { pattern: /warrant(y|ies)?.{0,30}(disclaim|as[- ]is|no warrant)/gi, label: "Warranty Disclaimer", severity: "medium", category: "liability", explanation: "Disclaims warranties. You receive no guarantees about quality or fitness for purpose." },
      ];

      const clauseAnalysis: { clause: string; severity: string; category: string; explanation: string; count: number }[] = [];
      let highRiskCount = 0, medRiskCount = 0, lowRiskCount = 0;

      for (const rp of RISK_PATTERNS) {
        const matches = docText.match(rp.pattern);
        if (matches && matches.length > 0) {
          clauseAnalysis.push({ clause: rp.label, severity: rp.severity, category: rp.category, explanation: rp.explanation, count: matches.length });
          if (rp.severity === "high") highRiskCount += matches.length;
          else if (rp.severity === "medium") medRiskCount += matches.length;
          else lowRiskCount += matches.length;
        }
      }

      const PROTECTIVE_CLAUSES = [
        { pattern: /force majeure/gi, label: "Force Majeure" },
        { pattern: /limitation of liability/gi, label: "Limitation of Liability" },
        { pattern: /governing law|governed by/gi, label: "Governing Law / Choice of Law" },
        { pattern: /dispute resolution|arbitration|mediation/gi, label: "Dispute Resolution Mechanism" },
        { pattern: /terminat(e|ion)/gi, label: "Termination Clause" },
        { pattern: /confidential/gi, label: "Confidentiality / NDA" },
        { pattern: /notice|notification.{0,30}(writing|written|email)/gi, label: "Notice Requirements" },
        { pattern: /sever(ability|able)/gi, label: "Severability" },
        { pattern: /entire agreement|whole agreement/gi, label: "Entire Agreement / Integration" },
        { pattern: /warrant(y|ies)/gi, label: "Warranties" },
        { pattern: /insurance|coverage/gi, label: "Insurance Requirements" },
        { pattern: /data protection|privacy|personal data/gi, label: "Data Protection / Privacy" },
      ];

      const missingProtections: string[] = [];
      const presentProtections: string[] = [];
      for (const pc of PROTECTIVE_CLAUSES) {
        if (pc.pattern.test(docText)) {
          presentProtections.push(pc.label);
        } else {
          missingProtections.push(pc.label);
        }
      }

      const deadlinePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2}|within \d+ (days?|months?|years?|business days?)|no later than|due (on|by)|deadline)/gi;
      const deadlineMatches = docText.match(deadlinePattern) || [];
      const obligations = deadlineMatches.slice(0, 20).map(m => m.trim());

      let baseScore = 70;
      baseScore -= highRiskCount * 5;
      baseScore -= medRiskCount * 2;
      baseScore -= lowRiskCount * 0.5;
      baseScore -= missingProtections.length * 3;
      baseScore += presentProtections.length * 1.5;

      if (wordCount < 200) baseScore -= 10;
      if (wordCount > 10000) baseScore += 2;
      if (lowerDoc.includes("entire agreement")) baseScore += 2;
      if (lowerDoc.includes("severab")) baseScore += 2;

      const safetyScore = Math.max(0, Math.min(100, Math.round(baseScore)));
      const grade = safetyScore >= 80 ? "A" : safetyScore >= 65 ? "B" : safetyScore >= 50 ? "C" : safetyScore >= 35 ? "D" : "F";

      const recommendations: string[] = [];
      if (highRiskCount > 0) recommendations.push(`URGENT: ${highRiskCount} high-risk clause(s) detected. Review indemnification, IP assignment, and liability provisions immediately.`);
      if (missingProtections.length > 0) recommendations.push(`Add missing protections: ${missingProtections.join(", ")}`);
      if (!lowerDoc.includes("governing law") && !lowerDoc.includes("governed by")) recommendations.push("Add a governing law clause specifying which jurisdiction's laws apply.");
      if (!lowerDoc.includes("terminat")) recommendations.push("Add clear termination provisions with notice periods for both parties.");
      if (!lowerDoc.includes("dispute") && !lowerDoc.includes("arbitration")) recommendations.push("Add a dispute resolution mechanism (mediation, arbitration, or litigation venue).");
      if (lowerDoc.includes("non-compete") || lowerDoc.includes("noncompete")) recommendations.push("Review non-compete scope: ensure geographic area, time period, and industry scope are reasonable.");
      if (lowerDoc.includes("indemnif")) recommendations.push("Negotiate mutual indemnification or cap indemnification obligations.");
      if (!lowerDoc.includes("limitation of liability")) recommendations.push("Add a limitation of liability clause to cap maximum damages.");
      clauseAnalysis.filter(c => c.severity === "high").forEach(c => {
        recommendations.push(`Negotiate ${c.clause}: ${c.explanation}`);
      });

      return {
        contract_safety_score: safetyScore,
        grade,
        summary: `${docType.replace(/_/g, " ").toUpperCase()} — ${wordCount} words — reviewed from ${perspective} perspective — ${jurisdiction} jurisdiction`,
        risk_dashboard: { high: highRiskCount, medium: medRiskCount, low: lowRiskCount, total_clauses_analyzed: clauseAnalysis.length },
        clause_analysis: clauseAnalysis.sort((a, b) => { const order = { high: 0, medium: 1, low: 2 }; return (order[a.severity as keyof typeof order] ?? 3) - (order[b.severity as keyof typeof order] ?? 3); }),
        missing_protections: missingProtections,
        present_protections: presentProtections,
        obligations_timeline: obligations.length > 0 ? obligations : ["No explicit deadlines or timelines detected"],
        negotiation_priorities: recommendations.slice(0, 10),
        metadata: { document_type: docType, perspective, industry, jurisdiction, word_count: wordCount, analyzed_at: new Date().toISOString() },
      };
}

async function generateLegalDocumentHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
      const docType = params.document_type;
      if (!docType) return { error: "document_type is required" };
      const partyA = typeof params.party_a === "string" ? params.party_a.trim().slice(0, 500) : "";
      if (!partyA) return { error: "party_a is required" };
      const partyB = typeof params.party_b === "string" ? params.party_b.trim().slice(0, 500) : "Second Party";
      const desc = typeof params.description === "string" ? params.description.trim() : "";
      if (!desc) return { error: "description is required" };
      if (desc.length > 50_000) return { error: "description too large — max 50,000 characters" };
      const jurisdiction = typeof params.jurisdiction === "string" ? params.jurisdiction.trim().slice(0, 500) : "Illinois, USA";
      const duration = typeof params.duration === "string" ? params.duration.trim().slice(0, 200) : "12 months";
      const compensation = typeof params.compensation === "string" ? params.compensation.trim().slice(0, 2000) : "";
      const specialTerms = typeof params.special_terms === "string" ? params.special_terms.trim().slice(0, 10_000) : "";
      const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      const TEMPLATES: Record<string, (a: string, b: string, d: string, j: string, dur: string, comp: string, spec: string) => string> = {
        nda_mutual: (a, b, d, j, dur) => `MUTUAL NON-DISCLOSURE AGREEMENT\n\nEffective Date: ${today}\n\nThis Mutual Non-Disclosure Agreement ("Agreement") is entered into by and between:\n\nParty A: ${a}\nParty B: ${b}\n\nPurpose: ${d}\n\n1. DEFINITION OF CONFIDENTIAL INFORMATION\nConfidential Information means any non-public information disclosed by either party to the other, whether oral, written, electronic, or visual, including but not limited to: business plans, financial data, technical data, trade secrets, know-how, inventions, processes, techniques, algorithms, software, designs, customer lists, and market strategies.\n\n2. OBLIGATIONS\nBoth parties agree to:\na) Hold Confidential Information in strict confidence\nb) Not disclose Confidential Information to third parties without prior written consent\nc) Use Confidential Information solely for the Purpose stated above\nd) Protect Confidential Information with at least the same degree of care used to protect their own confidential information, but no less than reasonable care\n\n3. EXCLUSIONS\nConfidential Information does not include information that:\na) Was publicly known at the time of disclosure\nb) Becomes publicly known through no fault of the receiving party\nc) Was already known to the receiving party prior to disclosure\nd) Is independently developed without use of Confidential Information\ne) Is disclosed pursuant to court order or legal requirement (with prompt notice)\n\n4. TERM\nThis Agreement shall remain in effect for ${dur} from the Effective Date. Confidentiality obligations shall survive termination for a period of 2 years.\n\n5. RETURN OF MATERIALS\nUpon termination or request, each party shall promptly return or destroy all Confidential Information and certify destruction in writing.\n\n6. NO LICENSE\nNothing in this Agreement grants any license or right to use Confidential Information except as expressly stated.\n\n7. REMEDIES\nBoth parties acknowledge that breach may cause irreparable harm and agree that the non-breaching party shall be entitled to seek equitable relief, including injunction, in addition to other remedies.\n\n8. GOVERNING LAW\nThis Agreement shall be governed by and construed in accordance with the laws of ${j}.\n\n9. ENTIRE AGREEMENT\nThis Agreement constitutes the entire agreement between the parties concerning confidentiality and supersedes all prior agreements.\n\n10. SEVERABILITY\nIf any provision is found unenforceable, the remaining provisions shall continue in full force and effect.\n\nIN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date.\n\n_________________________          _________________________\n${a}                               ${b}\nDate: _______________              Date: _______________`,

        nda_one_way: (a, b, d, j, dur) => `ONE-WAY NON-DISCLOSURE AGREEMENT\n\nEffective Date: ${today}\n\nDisclosing Party: ${a}\nReceiving Party: ${b}\n\nPurpose: ${d}\n\n1. DEFINITION OF CONFIDENTIAL INFORMATION\nConfidential Information means any non-public information disclosed by the Disclosing Party to the Receiving Party, including but not limited to business plans, financial data, technical data, trade secrets, customer information, and proprietary processes.\n\n2. OBLIGATIONS OF RECEIVING PARTY\nThe Receiving Party agrees to:\na) Maintain strict confidentiality of all Confidential Information\nb) Not disclose to any third party without prior written consent\nc) Use Confidential Information solely for the Purpose stated above\nd) Limit access to employees/agents with a need to know who are bound by similar obligations\n\n3. EXCLUSIONS\nConfidential Information excludes information that is: (a) publicly available, (b) already known to Receiving Party, (c) independently developed, or (d) required by law to be disclosed.\n\n4. TERM\nThis Agreement remains in effect for ${dur}. Confidentiality obligations survive for 2 years after termination.\n\n5. RETURN OF MATERIALS\nUpon request or termination, Receiving Party shall return or destroy all Confidential Information.\n\n6. GOVERNING LAW\nGoverned by the laws of ${j}.\n\n7. REMEDIES\nDisclosing Party is entitled to equitable relief for breach, in addition to other legal remedies.\n\n8. ENTIRE AGREEMENT & SEVERABILITY\nThis is the complete agreement. Unenforceable provisions shall not affect remaining terms.\n\n_________________________          _________________________\n${a} (Disclosing Party)            ${b} (Receiving Party)\nDate: _______________              Date: _______________`,

        freelancer_agreement: (a, b, d, j, dur, comp, spec) => `INDEPENDENT CONTRACTOR AGREEMENT\n\nEffective Date: ${today}\n\nClient: ${a}\nContractor: ${b}\n\n1. SCOPE OF WORK\n${d}\n\n2. TERM\nThis Agreement shall commence on ${today} and continue for ${dur}, unless terminated earlier per Section 8.\n\n3. COMPENSATION\n${comp || "To be determined by mutual agreement."}\nPayment terms: Net 30 days from invoice date. Contractor shall submit itemized invoices.\n\n4. INDEPENDENT CONTRACTOR STATUS\n${b} is an independent contractor, not an employee. Contractor is responsible for their own taxes, insurance, and benefits. Contractor controls the manner, method, and means of performing services.\n\n5. INTELLECTUAL PROPERTY\nAll work product created under this Agreement shall be considered "work made for hire." To the extent any work product does not qualify, Contractor assigns all rights to Client upon full payment. Contractor retains the right to use general skills, knowledge, and techniques developed during the engagement.\n\n6. CONFIDENTIALITY\nContractor shall maintain confidentiality of all proprietary information and shall not disclose to third parties during and for 2 years after the Agreement.\n\n7. WARRANTIES\nContractor warrants that: (a) they have the right to enter this Agreement, (b) work will be original and not infringe third-party rights, (c) services will be performed professionally.\n\n8. TERMINATION\nEither party may terminate with 14 days written notice. Client shall pay for all work completed through the termination date.\n\n9. LIMITATION OF LIABILITY\nNeither party's total liability shall exceed the total compensation paid or payable under this Agreement.\n\n10. INDEMNIFICATION\nEach party shall indemnify the other against claims arising from their own breach of this Agreement or negligence.\n\n11. DISPUTE RESOLUTION\nDisputes shall first be resolved through good-faith negotiation, then mediation, then binding arbitration in ${j}.\n\n12. GOVERNING LAW\nGoverned by the laws of ${j}.\n\n13. ENTIRE AGREEMENT & SEVERABILITY\nThis constitutes the entire agreement. Amendments must be in writing signed by both parties.\n\n${spec ? `14. SPECIAL TERMS\n${spec}\n\n` : ""}IN WITNESS WHEREOF:\n\n_________________________          _________________________\n${a} (Client)                      ${b} (Contractor)\nDate: _______________              Date: _______________`,

        terms_of_service: (a, _b, d, j) => `TERMS OF SERVICE\n\nLast Updated: ${today}\n\nThese Terms of Service ("Terms") govern your use of services provided by ${a}.\n\n${d}\n\n1. ACCEPTANCE OF TERMS\nBy accessing or using our services, you agree to be bound by these Terms. If you do not agree, do not use the services.\n\n2. DESCRIPTION OF SERVICE\n${a} provides the services as described on our website and documentation.\n\n3. USER ACCOUNTS\nYou are responsible for maintaining the confidentiality of your account credentials. You agree to notify us immediately of any unauthorized use.\n\n4. ACCEPTABLE USE\nYou agree not to: (a) violate any laws, (b) infringe intellectual property rights, (c) transmit malware or harmful code, (d) interfere with service operations, (e) attempt unauthorized access.\n\n5. INTELLECTUAL PROPERTY\nAll content, trademarks, and technology are owned by ${a} or its licensors. You receive a limited, non-exclusive license to use the service.\n\n6. PRIVACY\nYour use of the service is also governed by our Privacy Policy.\n\n7. PAYMENT TERMS\nIf applicable, fees are due as specified. We reserve the right to change pricing with 30 days notice.\n\n8. DISCLAIMER OF WARRANTIES\nSERVICES ARE PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.\n\n9. LIMITATION OF LIABILITY\nIN NO EVENT SHALL ${a} BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES. TOTAL LIABILITY SHALL NOT EXCEED FEES PAID IN THE PRIOR 12 MONTHS.\n\n10. INDEMNIFICATION\nYou agree to indemnify ${a} against claims arising from your use of the service or violation of these Terms.\n\n11. TERMINATION\nWe may terminate or suspend access immediately for violation of these Terms.\n\n12. GOVERNING LAW\nThese Terms are governed by the laws of ${j}.\n\n13. DISPUTE RESOLUTION\nDisputes shall be resolved through binding arbitration in ${j}.\n\n14. CHANGES TO TERMS\nWe reserve the right to modify these Terms. Continued use after changes constitutes acceptance.\n\n15. SEVERABILITY\nIf any provision is unenforceable, the remaining provisions remain in effect.\n\n16. CONTACT\n${a}\n\nBy using our services, you acknowledge that you have read, understood, and agree to these Terms.`,

        nda_employee: (a, b, d, j, dur) => `EMPLOYEE NON-DISCLOSURE AGREEMENT\n\nEffective Date: ${today}\n\nEmployer: ${a}\nEmployee: ${b}\n\nPurpose: ${d}\n\n1. DEFINITION OF CONFIDENTIAL INFORMATION\nConfidential Information includes all non-public information relating to the Employer's business, including but not limited to: trade secrets, business strategies, financial data, customer lists, product plans, technical specifications, source code, algorithms, employee information, and any information marked as confidential.\n\n2. EMPLOYEE OBLIGATIONS\nEmployee agrees to:\na) Hold all Confidential Information in strict confidence during and after employment\nb) Not disclose Confidential Information to any person outside the company without prior written authorization\nc) Use Confidential Information solely for the purpose of performing job duties\nd) Return all materials containing Confidential Information upon termination of employment\ne) Not copy or reproduce Confidential Information except as required for job duties\n\n3. EXCLUSIONS\nConfidential Information does not include information that: (a) is or becomes publicly available through no fault of Employee, (b) was known to Employee before employment, (c) is independently developed without use of Confidential Information, (d) is required to be disclosed by law (with prompt notice to Employer).\n\n4. INTELLECTUAL PROPERTY\nAll inventions, discoveries, developments, and works created during employment that relate to the Employer's business shall be the sole property of the Employer.\n\n5. NON-SOLICITATION\nFor a period of ${dur} after termination, Employee shall not solicit any employees, contractors, or customers of the Employer.\n\n6. TERM\nConfidentiality obligations survive termination of employment indefinitely for trade secrets and for ${dur} for other Confidential Information.\n\n7. REMEDIES\nEmployee acknowledges that breach may cause irreparable harm and Employer shall be entitled to injunctive relief.\n\n8. GOVERNING LAW\nGoverned by the laws of ${j}.\n\n9. SEVERABILITY & ENTIRE AGREEMENT\nIf any provision is unenforceable, remaining provisions continue in force. This is the complete agreement on confidentiality.\n\n_________________________          _________________________\n${a} (Employer)                    ${b} (Employee)\nDate: _______________              Date: _______________`,

        partnership_agreement: (a, b, d, j, dur, comp, spec) => `PARTNERSHIP AGREEMENT\n\nEffective Date: ${today}\n\nPartner A: ${a}\nPartner B: ${b}\n\nPurpose: ${d}\n\n1. FORMATION\nThe Partners hereby form a partnership ("Partnership") for the purpose described above, governed by the laws of ${j}.\n\n2. TERM\nThe Partnership shall commence on ${today} and continue for ${dur}, unless terminated earlier per this Agreement.\n\n3. CONTRIBUTIONS\n${comp || "Each Partner shall contribute capital, services, or resources as mutually agreed."}\n\n4. PROFIT AND LOSS SHARING\nProfits and losses shall be shared equally (50/50) unless otherwise agreed in writing.\n\n5. MANAGEMENT AND AUTHORITY\na) All major decisions require unanimous consent of all Partners\nb) Day-to-day operations may be managed by either Partner\nc) Neither Partner may incur obligations exceeding $5,000 without the other's written consent\n\n6. BANKING AND ACCOUNTING\na) Partnership funds shall be maintained in a joint account\nb) Accurate books and records shall be maintained and available to all Partners\nc) Annual accounting shall be performed\n\n7. WITHDRAWAL AND DISSOLUTION\na) A Partner may withdraw with 90 days written notice\nb) Upon withdrawal, the withdrawing Partner's interest shall be valued at fair market value\nc) The Partnership may be dissolved by mutual agreement or by court order\n\n8. NON-COMPETE\nDuring the term and for 12 months after, Partners shall not engage in competing business without written consent.\n\n9. DISPUTE RESOLUTION\nDisputes shall be resolved through mediation, then binding arbitration in ${j}.\n\n10. LIMITATION OF LIABILITY\nNo Partner shall be liable for honest errors in judgment or mistakes of fact.\n\n11. GOVERNING LAW\nGoverned by the laws of ${j}.\n\n12. ENTIRE AGREEMENT\nThis constitutes the entire agreement. Amendments require written consent of all Partners.\n\n${spec ? `13. SPECIAL TERMS\n${spec}\n\n` : ""}IN WITNESS WHEREOF:\n\n_________________________          _________________________\n${a} (Partner A)                   ${b} (Partner B)\nDate: _______________              Date: _______________`,

        sow: (a, b, d, j, dur, comp, spec) => `STATEMENT OF WORK (SOW)\n\nEffective Date: ${today}\nSOW Reference: SOW-${Date.now().toString(36).toUpperCase()}\n\nClient: ${a}\nService Provider: ${b}\n\n1. PROJECT DESCRIPTION\n${d}\n\n2. SCOPE OF WORK\nThe Service Provider shall deliver the services and deliverables described in this SOW in accordance with the terms herein.\n\n3. DELIVERABLES AND MILESTONES\n[To be detailed by the parties — include specific deliverables, acceptance criteria, and milestone dates]\n\n4. TIMELINE\nProject duration: ${dur}\nStart date: ${today}\n\n5. COMPENSATION AND PAYMENT\n${comp || "Payment terms to be agreed upon by both parties."}\nInvoices shall be submitted upon completion of each milestone. Payment is due within 30 days of invoice.\n\n6. ACCEPTANCE CRITERIA\nDeliverables shall be reviewed within 10 business days. Written acceptance or detailed rejection required. Two rounds of revisions included.\n\n7. CHANGE MANAGEMENT\nChanges to scope require a written Change Order signed by both parties. Change Orders may adjust timeline and compensation.\n\n8. PROJECT MANAGEMENT\nWeekly status reports shall be provided. A designated project manager shall be assigned by each party.\n\n9. ASSUMPTIONS AND DEPENDENCIES\n[List key assumptions and client-provided resources/access required]\n\n10. INTELLECTUAL PROPERTY\nAll deliverables become Client property upon full payment. Service Provider retains rights to pre-existing IP and general methodologies.\n\n11. CONFIDENTIALITY\nBoth parties shall maintain confidentiality of proprietary information shared during the engagement.\n\n12. TERMINATION\nEither party may terminate with 30 days written notice. Client shall pay for work completed through termination date.\n\n13. GOVERNING LAW\nGoverned by the laws of ${j}.\n\n${spec ? `14. SPECIAL TERMS\n${spec}\n\n` : ""}ACCEPTED AND AGREED:\n\n_________________________          _________________________\n${a} (Client)                      ${b} (Service Provider)\nDate: _______________              Date: _______________`,

        msa: (a, b, d, j, dur, _comp, spec) => `MASTER SERVICE AGREEMENT (MSA)\n\nEffective Date: ${today}\n\nClient: ${a}\nService Provider: ${b}\n\n${d}\n\n1. TERM\nThis MSA shall remain in effect for ${dur} from the Effective Date and shall govern all Statements of Work (SOWs) executed hereunder.\n\n2. SERVICES\nService Provider shall perform services as described in individual SOWs executed under this MSA. Each SOW shall reference this MSA and specify scope, deliverables, timeline, and fees.\n\n3. COMPENSATION\nPayment terms shall be specified in each SOW. Unless otherwise stated, invoices are due Net 30.\n\n4. INTELLECTUAL PROPERTY\na) Pre-existing IP remains with its owner\nb) Work product created under SOWs shall be owned by Client upon full payment\nc) Service Provider retains rights to general tools, methodologies, and know-how\n\n5. CONFIDENTIALITY\nBoth parties agree to maintain confidentiality of all proprietary information for the term of this MSA and 3 years thereafter.\n\n6. REPRESENTATIONS AND WARRANTIES\nService Provider warrants that: (a) services will be performed professionally, (b) deliverables will not infringe third-party rights, (c) it has authority to enter this agreement.\n\n7. LIMITATION OF LIABILITY\nNEITHER PARTY SHALL BE LIABLE FOR INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES. TOTAL LIABILITY SHALL NOT EXCEED THE FEES PAID UNDER THE APPLICABLE SOW IN THE PRIOR 12 MONTHS.\n\n8. INDEMNIFICATION\nEach party shall indemnify the other against third-party claims arising from its own breach, negligence, or willful misconduct.\n\n9. TERMINATION\na) Either party may terminate with 60 days written notice\nb) Either party may terminate immediately for material breach (with 30 days cure period)\nc) Outstanding SOWs shall continue unless separately terminated\n\n10. INSURANCE\nService Provider shall maintain appropriate professional liability and general commercial insurance.\n\n11. DISPUTE RESOLUTION\nDisputes shall be resolved through negotiation, then mediation, then binding arbitration in ${j}.\n\n12. FORCE MAJEURE\nNeither party shall be liable for delays due to events beyond reasonable control.\n\n13. GOVERNING LAW\nGoverned by the laws of ${j}.\n\n14. ENTIRE AGREEMENT\nThis MSA and its SOWs constitute the entire agreement. Amendments must be in writing.\n\n${spec ? `15. SPECIAL TERMS\n${spec}\n\n` : ""}IN WITNESS WHEREOF:\n\n_________________________          _________________________\n${a} (Client)                      ${b} (Service Provider)\nDate: _______________              Date: _______________`,

        cease_desist: (a, b, d, j) => `CEASE AND DESIST LETTER\n\nDate: ${today}\n\nFROM: ${a}\nTO: ${b}\n\nRE: DEMAND TO CEASE AND DESIST\n\nDear ${b},\n\nThis letter serves as formal notice and demand that you immediately CEASE AND DESIST the following conduct:\n\n${d}\n\nFACTS:\nIt has come to our attention that you have engaged in the above-described conduct, which constitutes a violation of our rights and/or applicable law.\n\nLEGAL BASIS:\nThe conduct described above may constitute one or more of the following:\n- Infringement of intellectual property rights (trademark, copyright, patent, or trade secret)\n- Unfair business practices\n- Breach of contract or agreement\n- Violation of applicable statutes and regulations\n\nDEMAND:\nWe hereby demand that you:\n1. Immediately cease and desist all described conduct\n2. Confirm in writing within 14 days of receipt that you have complied with this demand\n3. Preserve all documents, communications, and materials related to this matter\n\nCONSEQUENCES OF NON-COMPLIANCE:\nIf you fail to comply with this demand, we reserve the right to pursue all available legal remedies, including but not limited to:\n- Filing a lawsuit seeking injunctive relief and damages\n- Reporting the matter to appropriate regulatory authorities\n- Seeking recovery of attorney's fees and costs\n\nThis letter is not intended to be, nor should it be construed as, a complete statement of the facts or law related to this matter. All rights and remedies are expressly reserved.\n\nGoverned by the laws of ${j}.\n\nSincerely,\n\n_________________________\n${a}\nDate: ${today}\n\n[NOTICE: This letter should be reviewed by a qualified attorney before sending.]`,

        consulting_agreement: (a, b, d, j, dur, comp, spec) => `CONSULTING AGREEMENT\n\nEffective Date: ${today}\n\nClient: ${a}\nConsultant: ${b}\n\n1. ENGAGEMENT\n${a} hereby engages ${b} as an independent consultant to provide the services described herein.\n\n2. SCOPE OF SERVICES\n${d}\n\n3. TERM\nThis Agreement shall commence on ${today} and continue for ${dur}, unless terminated earlier.\n\n4. COMPENSATION\n${comp || "Compensation to be agreed upon by both parties."}\nPayment terms: Net 30 from receipt of invoice. Expenses pre-approved in writing shall be reimbursed.\n\n5. INDEPENDENT CONTRACTOR STATUS\nConsultant is an independent contractor. Nothing in this Agreement creates an employment, agency, or partnership relationship. Consultant is responsible for own taxes, insurance, and benefits.\n\n6. CONFIDENTIALITY\nConsultant shall maintain strict confidentiality of all Client proprietary information during and for 3 years after the engagement.\n\n7. INTELLECTUAL PROPERTY\nAll work product shall be "work made for hire" owned by Client. To the extent any work does not qualify, Consultant assigns all rights to Client. Consultant retains general skills and pre-existing IP.\n\n8. NON-SOLICITATION\nDuring the term and for 12 months after, Consultant shall not solicit Client's employees or customers.\n\n9. WARRANTIES\nConsultant warrants professional competence and that work will not infringe third-party rights.\n\n10. LIMITATION OF LIABILITY\nTotal liability shall not exceed the compensation paid under this Agreement.\n\n11. TERMINATION\nEither party may terminate with 14 days written notice. Client pays for all work completed.\n\n12. GOVERNING LAW\nGoverned by the laws of ${j}.\n\n13. DISPUTE RESOLUTION\nDisputes resolved through mediation then binding arbitration in ${j}.\n\n14. ENTIRE AGREEMENT\nThis is the complete agreement. Amendments require written consent.\n\n${spec ? `15. SPECIAL TERMS\n${spec}\n\n` : ""}IN WITNESS WHEREOF:\n\n_________________________          _________________________\n${a} (Client)                      ${b} (Consultant)\nDate: _______________              Date: _______________`,

        licensing_agreement: (a, b, d, j, dur, comp, spec) => `LICENSING AGREEMENT\n\nEffective Date: ${today}\n\nLicensor: ${a}\nLicensee: ${b}\n\n1. GRANT OF LICENSE\n${a} hereby grants to ${b} a [non-exclusive/exclusive] license to use the following:\n\n${d}\n\n2. SCOPE OF LICENSE\na) Territory: Worldwide unless otherwise specified\nb) Purpose: As described in the grant above\nc) Sublicensing: Not permitted without prior written consent\n\n3. TERM\nThis license shall be effective for ${dur} from the Effective Date.\n\n4. COMPENSATION\n${comp || "License fees to be agreed upon by both parties."}\n\n5. INTELLECTUAL PROPERTY OWNERSHIP\nAll intellectual property rights in the licensed material remain with ${a}. This Agreement does not transfer ownership.\n\n6. RESTRICTIONS\nLicensee shall not:\na) Modify, adapt, or create derivative works without written consent\nb) Reverse engineer, decompile, or disassemble the licensed material\nc) Remove any proprietary notices or labels\nd) Use the licensed material for purposes outside the scope of this license\n\n7. WARRANTIES\nLicensor warrants that it has the right to grant this license and that the licensed material does not infringe third-party rights.\n\n8. DISCLAIMER\nEXCEPT AS EXPRESSLY STATED, THE LICENSED MATERIAL IS PROVIDED "AS IS" WITHOUT WARRANTY.\n\n9. LIMITATION OF LIABILITY\nLicensor's total liability shall not exceed the license fees paid in the prior 12 months.\n\n10. TERMINATION\na) Either party may terminate with 30 days written notice\nb) Licensor may terminate immediately for breach\nc) Upon termination, Licensee shall cease all use and return/destroy licensed materials\n\n11. GOVERNING LAW\nGoverned by the laws of ${j}.\n\n12. ENTIRE AGREEMENT\nThis constitutes the entire agreement regarding the license.\n\n${spec ? `13. SPECIAL TERMS\n${spec}\n\n` : ""}IN WITNESS WHEREOF:\n\n_________________________          _________________________\n${a} (Licensor)                    ${b} (Licensee)\nDate: _______________              Date: _______________`,

        privacy_policy: (a, _b, d, j) => `PRIVACY POLICY\n\nLast Updated: ${today}\n\n${a} ("we", "us", "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information.\n\n${d}\n\n1. INFORMATION WE COLLECT\na) Information you provide: name, email address, account credentials, payment information\nb) Automatically collected: IP address, browser type, device information, usage data, cookies\nc) Third-party sources: analytics providers, advertising partners\n\n2. HOW WE USE YOUR INFORMATION\na) Provide and maintain our services\nb) Process transactions and send related information\nc) Send service updates and administrative messages\nd) Respond to customer service requests\ne) Improve and personalize user experience\nf) Comply with legal obligations\n\n3. DATA SHARING AND DISCLOSURE\nWe do not sell your personal information. We may share data with:\na) Service providers who assist in operations (bound by confidentiality)\nb) Legal authorities when required by law\nc) Business partners with your consent\nd) In connection with a merger, acquisition, or asset sale\n\n4. DATA RETENTION\nWe retain personal data only as long as necessary for the purposes outlined, or as required by law.\n\n5. YOUR RIGHTS\nDepending on your jurisdiction, you may have rights to:\na) Access your personal data\nb) Correct inaccurate data\nc) Delete your data ("right to be forgotten")\nd) Restrict processing\ne) Data portability\nf) Object to processing\ng) Opt-out of sale of personal information (California residents)\n\n6. COOKIES AND TRACKING\nWe use cookies and similar technologies. You can control cookies through your browser settings.\n\n7. SECURITY\nWe implement appropriate technical and organizational measures to protect your data, including encryption in transit and at rest.\n\n8. CHILDREN'S PRIVACY\nOur services are not intended for individuals under 13. We do not knowingly collect data from children.\n\n9. INTERNATIONAL DATA TRANSFERS\nYour data may be transferred to and processed in countries other than your own, with appropriate safeguards in place.\n\n10. CHANGES TO THIS POLICY\nWe may update this policy and will notify you of material changes via email or service notification.\n\n11. CONTACT US\n${a}\nFor privacy inquiries, contact our Data Protection Officer.\n\n12. GOVERNING LAW\nThis policy is governed by the laws of ${j}.`,
      };

      const defaultTemplate = (a: string, b: string, d: string, j: string, dur: string, comp: string, spec: string) =>
        `${docType.replace(/_/g, " ").toUpperCase()}\n\nEffective Date: ${today}\n\nParty A: ${a}\nParty B: ${b}\n\nPurpose / Scope:\n${d}\n\nTerm: ${dur}\n${comp ? `Compensation: ${comp}\n` : ""}Jurisdiction: ${j}\n${spec ? `Special Terms: ${spec}\n` : ""}\n[This is a template outline. For a complete ${docType.replace(/_/g, " ")}, consult with a qualified attorney in your jurisdiction.]\n\n_________________________          _________________________\n${a}                               ${b}\nDate: _______________              Date: _______________`;

      const templateFn = TEMPLATES[docType] || defaultTemplate;
      const document = templateFn(partyA, partyB, desc, jurisdiction, duration, compensation, specialTerms);

      return {
        document_type: docType,
        generated_document: document,
        metadata: { party_a: partyA, party_b: partyB, jurisdiction, duration, generated_at: today, word_count: document.split(/\s+/).length },
        disclaimer: "IMPORTANT: This document is generated for informational purposes and as a starting point. It is NOT a substitute for professional legal advice. Have all legal documents reviewed by a qualified attorney before signing.",
      };
}

/** Registered by ./index.ts at import time. */
export const legalDomainTools: RegisteredTool[] = [
  defineTool(createContractDefinition, createContractHandler),
  defineTool(listContractsDefinition, listContractsHandler),
  defineTool(updateContractStatusDefinition, updateContractStatusHandler),
  defineTool(legalReviewDefinition, legalReviewHandler),
  defineTool(generateLegalDocumentDefinition, generateLegalDocumentHandler),
];
