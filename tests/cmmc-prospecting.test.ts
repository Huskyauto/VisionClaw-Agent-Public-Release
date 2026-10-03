import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cmmcProspectArtifactKey,
  cmmcProspectSourceRunKey,
  buildCmmcProspectArtifacts,
  createRequestPacer,
  deliverCmmcProspectArtifacts,
  discoverCmmcProspects,
  discoverOrResumeCmmcProspects,
  isCmmcProspectDeliveryReady,
  lookupSamCompanies,
  samGovSource,
  type CmmcProspectSource,
} from "../server/lib/cmmc-prospecting";
import { lookupSamExactCompany } from "../server/lib/sam-exact-company";
import { buildArtifactIntent } from "../server/durable-artifacts";

describe("CMMC prospect discovery", () => {
  it("attributes one exact company only when the legal name and address anchors agree", async () => {
    const result = await lookupSamExactCompany({
      tenantId: 907,
      companyName: "Lake County Tool Works North Inc",
      state: "IL",
      city: "Zion",
      streetAddress: "1730 Lewis Avenue",
      websiteDomain: "lctwn.com",
      includeInactive: true,
      maxCandidates: 10,
    }, {
      async search() {
        return {
          outcome: "ok" as const,
          attempts: 1,
          coverageComplete: true,
          entities: [{
            entityRegistration: {
              legalBusinessName: "Lake County Tool Works North, Inc.",
              ueiSAM: "LCTW12345678",
              cageCode: "9ZZ99",
              registrationStatus: "Active",
            },
            coreData: {
              physicalAddress: {
                addressLine1: "1730 Lewis Ave",
                city: "Zion",
                stateOrProvinceCode: "IL",
                zipCode: "60099",
              },
              entityInformation: { entityURL: "https://www.lctwn.com" },
              generalInformation: { entityTypeDesc: "Business Organization" },
            },
            assertions: {
              goodsAndServices: {
                naicsList: [{ naicsCode: "332710" }],
                pscList: [{ pscCode: "3416" }],
              },
            },
          }],
          diagnostics: [],
        };
      },
    });

    assert.equal(result.resolutionStatus, "exact_match");
    assert.equal(result.coverageComplete, true);
    assert.equal(result.matchedEntity?.legalName, "Lake County Tool Works North, Inc.");
    assert.equal(result.matchedEntity?.cage, "9ZZ99");
    assert.equal(result.matchedEntity?.uei, "LCTW12345678");
    assert.deepEqual(result.evidence.strongIdentifiersMatched, ["name", "address", "website"]);
    assert.equal(result.candidates[0].matchScore, 1);
    assert.ok(result.candidates[0].whyMatched.includes("street_address_match"));
  });

  it("withholds CAGE attribution when SAM search coverage is incomplete", async () => {
    const result = await lookupSamExactCompany({
      tenantId: 907,
      companyName: "Acme Defense Inc",
      state: "IL",
      city: "Chicago",
    }, {
      async search() {
        return {
          outcome: "ok" as const,
          attempts: 10,
          coverageComplete: false,
          entities: [{
            entityRegistration: {
              legalBusinessName: "Acme Defense Inc",
              cageCode: "1AB23",
              ueiSAM: "ACME12345678",
            },
            coreData: {
              physicalAddress: { city: "Chicago", stateOrProvinceCode: "IL" },
            },
          }],
          diagnostics: ["sam_exact_attempt_cap_before_query_coverage:Acme Defense Inc"],
        };
      },
    });

    assert.equal(result.coverageComplete, false);
    assert.equal(result.resolutionStatus, "no_attributable_match");
    assert.equal(result.matchedEntity, null);
    assert.ok(result.diagnostics.some((item) => item.includes("attempt_cap")));
  });

  it("credits an exact alias only when a second strong identifier corroborates it", async () => {
    const result = await lookupSamExactCompany({
      tenantId: 907,
      companyName: "Acme Defense Holdings",
      aliases: ["Acme Defense Systems LLC"],
      websiteDomain: "acmedefense.example",
    }, {
      async search() {
        return {
          outcome: "ok" as const,
          attempts: 2,
          coverageComplete: true,
          entities: [{
            entityRegistration: { legalBusinessName: "Acme Defense Systems LLC", cageCode: "1AB23", ueiSAM: "ACME12345678" },
            coreData: { entityInformation: { entityURL: "https://acmedefense.example" } },
          }],
        };
      },
    });
    assert.equal(result.resolutionStatus, "exact_match");
    assert.equal(result.matchedEntity?.cage, "1AB23");
    assert.ok(result.candidates[0].whyMatched.includes("exact_alias"));
  });

  it("withholds both competing CAGE identities when two attributable candidates are tied", async () => {
    const result = await lookupSamExactCompany({
      tenantId: 907,
      companyName: "Acme Defense Inc",
      state: "IL",
      city: "Chicago",
    }, {
      async search() {
        return {
          outcome: "ok" as const,
          attempts: 2,
          coverageComplete: true,
          entities: ["1AB23", "2CD45"].map((cageCode) => ({
            entityRegistration: { legalBusinessName: "Acme Defense Inc", cageCode, ueiSAM: `${cageCode}UEI0000` },
            coreData: { physicalAddress: { city: "Chicago", stateOrProvinceCode: "IL" } },
          })),
        };
      },
    });
    assert.equal(result.resolutionStatus, "ambiguous");
    assert.equal(result.matchedEntity, null);
    assert.equal(result.candidates.length, 2);
  });

  it("looks up an exact company name through SAM and returns attributable entity details", async () => {
    const previous = process.env.SAM_GOV_API_KEY;
    process.env.SAM_GOV_API_KEY = "test-key";
    const urls: URL[] = [];
    try {
      const source = samGovSource(async (rawUrl) => {
        const url = new URL(String(rawUrl));
        urls.push(url);
        return Response.json({
          totalRecords: 1,
          entityData: [{
            entityRegistration: {
              legalBusinessName: "Acme Defense, Inc.",
              ueiSAM: "ACME12345678",
              cageCode: "1AB23",
              registrationStatus: "Active",
              samRegistered: "Yes",
              purposeOfRegistrationCode: "Z2",
              purposeOfRegistrationDesc: "All Awards",
              registrationDate: "2010-01-01",
              lastUpdateDate: "2026-08-01",
              registrationExpirationDate: "2027-12-31",
              activationDate: "2010-01-02",
              ueiStatus: "Active",
              ueiCreationDate: "2022-04-04",
              exclusionStatusFlag: "No",
            },
            coreData: {
              physicalAddress: {
                addressLine1: "10 Main St",
                city: "Chicago",
                stateOrProvinceCode: "IL",
                zipCode: "60601",
                zipCodePlus4: "1234",
                countryCode: "USA",
              },
              mailingAddress: {
                addressLine1: "PO Box 2",
                city: "Chicago",
                stateOrProvinceCode: "IL",
                zipCode: "60602",
                countryCode: "USA",
              },
              entityInformation: { entityURL: "https://acme.example", entityStartDate: "2001-02-03", fiscalYearEndCloseDate: "1231" },
              congressionalDistrict: "07",
              generalInformation: {
                entityStructureCode: "2L",
                entityStructureDesc: "Corporation",
                profitStructureCode: "2X",
                profitStructureDesc: "For Profit",
                stateOfIncorporationCode: "IL",
                countryOfIncorporationCode: "USA",
              },
              businessTypes: { businessTypeList: [{ businessTypeDesc: "Small Business" }] },
              financialInformation: { debtSubjectToOffset: "No" },
            },
            assertions: {
              goodsAndServices: {
                primaryNaics: "541512",
                naicsList: [{ naicsCode: "541512" }],
                pscList: [{ pscCode: "D399", pscDescription: "Other IT" }],
              },
              disasterReliefData: { disasterRegistryFlag: "No", bondingFlag: "Yes", geographicalAreaServed: ["IL", "WI"] },
              ediInformation: { ediInformationFlag: "Yes" },
            },
            pointsOfContact: {
              electronicBusinessPOC: {
                firstName: "Ada",
                lastName: "Lovelace",
                title: "Contracts Director",
                email: "contracts@acme.example",
                usPhone: "312-555-0100",
                usPhoneExtension: "42",
                nonUsPhone: "+44 20 7946 0958",
                fax: "312-555-0101",
                city: "Chicago",
                stateOrProvinceCode: "IL",
                countryCode: "USA",
              },
            },
          }],
        });
      }, { retry429: false });

      const result = await lookupSamCompanies({
        tenantId: 907,
        companyNames: ["Acme Defense, Inc."],
      }, source);

      assert.equal(result.outcome, "ok");
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].requestedName, "Acme Defense, Inc.");
      assert.equal(result.results[0].status, "matched");
      assert.equal(result.results[0].matches.length, 1);
      assert.equal(result.results[0].matches[0].legalName, "Acme Defense, Inc.");
      assert.equal(result.results[0].matches[0].cage, "1AB23");
      assert.equal(result.results[0].matches[0].uei, "ACME12345678");
      assert.equal(result.results[0].matches[0].registrationStatus, "active");
      assert.equal(result.results[0].matches[0].samRegistered, "Yes");
      assert.equal(result.results[0].matches[0].ueiStatus, "Active");
      assert.equal(result.results[0].matches[0].registrationDate, "2010-01-01");
      assert.equal(result.results[0].matches[0].registrationExpirationDate, "2027-12-31");
      assert.equal(result.results[0].matches[0].purposeOfRegistration, "All Awards");
      assert.equal(result.results[0].matches[0].city, "Chicago");
      assert.equal(result.results[0].matches[0].mailingAddress.zipCode, "60602");
      assert.equal(result.results[0].matches[0].entityInformation.entityURL, "https://acme.example");
      assert.equal(result.results[0].matches[0].congressionalDistrict, "07");
      assert.equal(result.results[0].matches[0].primaryNaics, "541512");
      assert.deepEqual(result.results[0].matches[0].naics, ["541512"]);
      assert.deepEqual(result.results[0].matches[0].pscCodes, [{ code: "D399", description: "Other IT" }]);
      assert.equal(result.results[0].matches[0].disasterRelief.disasterRegistryFlag, "No");
      assert.equal(result.results[0].matches[0].ediInformationFlag, "Yes");
      assert.equal(result.results[0].matches[0].pointsOfContact.electronicBusiness.firstName, "Ada");
      assert.equal(result.results[0].matches[0].pointsOfContact.electronicBusiness.title, "Contracts Director");
      assert.equal(result.results[0].matches[0].pointsOfContact.electronicBusiness.email, "contracts@acme.example");
      assert.equal(result.results[0].matches[0].pointsOfContact.electronicBusiness.phone, "312-555-0100");
      assert.equal(result.results[0].matches[0].pointsOfContact.electronicBusiness.phoneExtension, "42");
      assert.equal(result.results[0].matches[0].pointsOfContact.electronicBusiness.nonUsPhone, "+44 20 7946 0958");
      assert.equal(result.sourceCalls, 1);
      assert.equal(urls[0].hostname, "api.sam.gov");
      assert.equal(urls[0].pathname, "/entity-information/v3/entities");
      assert.equal(urls[0].searchParams.get("legalBusinessName"), "Acme Defense, Inc.");
      assert.equal(urls[0].searchParams.get("registrationStatus"), "A");
      assert.equal(urls[0].searchParams.get("size"), "10");
    } finally {
      if (previous === undefined) delete process.env.SAM_GOV_API_KEY;
      else process.env.SAM_GOV_API_KEY = previous;
    }
  });

  it("requires review when one exact result is accompanied by another candidate", async () => {
    const result = await lookupSamCompanies({
      tenantId: 907,
      companyNames: ["Acme Defense"],
    }, {
      async lookupCompanyName() {
        return {
          outcome: "ok" as const,
          attempts: 1,
          totalRecords: 2,
          entities: [
            { entityRegistration: { legalBusinessName: "Acme Defense", ueiSAM: "ACME11111111", cageCode: "1AB23" } },
            { entityRegistration: { legalBusinessName: "Acme Defense Systems", ueiSAM: "ACME22222222", cageCode: "2CD34" } },
          ],
        };
      },
    });

    assert.equal(result.results[0].status, "needs_review");
    assert.equal(result.results[0].matches.length, 2);
  });

  it("preserves a SAM point of contact whose only populated field is canonical nonUsPhone", async () => {
    const result = await lookupSamCompanies({
      tenantId: 907,
      companyNames: ["Global Defense"],
    }, {
      async lookupCompanyName() {
        return {
          outcome: "ok" as const,
          attempts: 1,
          totalRecords: 1,
          entities: [{
            entityRegistration: { legalBusinessName: "Global Defense", ueiSAM: "GLOBAL111111", cageCode: "4GH56" },
            pointsOfContact: { governmentBusinessPOC: { nonUsPhone: "+49 30 123456" } },
          }],
        };
      },
    });

    assert.equal(
      result.results[0].matches[0].pointsOfContact.governmentBusiness?.nonUsPhone,
      "+49 30 123456",
    );
  });

  it("deduplicates names and exposes partial matches, no matches, and retryable source failures", async () => {
    const calls: string[] = [];
    const source = {
      async lookupCompanyName(name: string) {
        calls.push(name);
        if (name === "Retry Co") return { outcome: "rate_limited" as const, attempts: 3, diagnostic: "retry_after_exhausted" };
        if (name === "Missing Co") return { outcome: "ok" as const, attempts: 1, entities: [], totalRecords: 0 };
        return {
          outcome: "ok" as const,
          attempts: 1,
          totalRecords: 2,
          entities: [
            { entityRegistration: { legalBusinessName: "Alpha Defense LLC", ueiSAM: "ALPHA11111111", cageCode: "2CD34" } },
            { entityRegistration: { legalBusinessName: "Alpha Defense Solutions LLC", ueiSAM: "ALPHA22222222", cageCode: "3EF45" } },
          ],
        };
      },
    };

    const result = await lookupSamCompanies({
      tenantId: 907,
      companyNames: ["Alpha Defense", "ALPHA-DEFENSE", "Missing Co", "Retry Co"],
    }, source);

    assert.deepEqual(calls, ["Alpha Defense", "Missing Co", "Retry Co"]);
    assert.equal(result.outcome, "partial");
    assert.equal(result.retryable, true);
    assert.deepEqual(result.pendingNames, ["Retry Co"]);
    assert.equal(result.results[0].status, "needs_review");
    assert.equal(result.results[0].matches[0].matchType, "partial");
    assert.equal(result.results[0].matches[0].cage, "2CD34");
    assert.equal(result.results[1].status, "not_found");
    assert.equal(result.results[1].matches.length, 0);
    assert.equal(result.results[2].status, "source_error");
    assert.match(result.results[2].diagnostic || "", /retry_after_exhausted/);
    assert.equal(result.sourceCalls, 5);
  });

  it("never exceeds the whole-run SAM request-attempt ceiling", async () => {
    const perNameBudgets: number[] = [];
    const result = await lookupSamCompanies({
      tenantId: 907,
      companyNames: Array.from({ length: 10 }, (_, index) => `Retry Company ${index + 1}`),
    }, {
      async lookupCompanyName(_name, _includeInactive, maxAttempts = 3) {
        perNameBudgets.push(maxAttempts);
        return { outcome: "rate_limited" as const, attempts: maxAttempts, diagnostic: "retry_after_exhausted" };
      },
    });

    assert.equal(result.sourceCalls, 25);
    assert.ok(result.sourceCalls <= 25);
    assert.deepEqual(perNameBudgets, [3, 3, 3, 3, 3, 3, 3, 3, 1]);
    assert.equal(result.pendingNames.length, 10);
    assert.equal(result.results.length, 10);
    assert.equal(result.results[9].diagnostic, "source_attempt_budget_exhausted");
  });

  it("reports a missing SAM key as a per-name configuration error without an outbound call", async () => {
    const previous = process.env.SAM_GOV_API_KEY;
    delete process.env.SAM_GOV_API_KEY;
    let fetchCalls = 0;
    try {
      const source = samGovSource(async () => {
        fetchCalls++;
        throw new Error("must not fetch without a key");
      }, { retry429: false });
      const result = await lookupSamCompanies({
        tenantId: 907,
        companyNames: ["Acme Defense, Inc."],
      }, source);

      assert.equal(fetchCalls, 0);
      assert.equal(result.outcome, "configuration_error");
      assert.equal(result.terminal, true);
      assert.equal(result.retryable, false);
      assert.equal(result.sourceCalls, 0);
      assert.equal(result.results[0].status, "configuration_error");
      assert.equal(result.results[0].matches.length, 0);
    } finally {
      if (previous === undefined) delete process.env.SAM_GOV_API_KEY;
      else process.env.SAM_GOV_API_KEY = previous;
    }
  });

  it("reserves concurrent request slots atomically", async () => {
    let clock = 1_000;
    const waits: number[] = [];
    const pace = createRequestPacer(350, {
      now: () => clock,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        clock += milliseconds;
      },
    });
    await Promise.all([pace(), pace(), pace()]);
    assert.deepEqual(waits, [350, 350]);
  });

  it("discovers registered entities rather than procurement notice titles", async () => {
    const previous = process.env.SAM_GOV_API_KEY;
    process.env.SAM_GOV_API_KEY = "test-key";
    const urls: URL[] = [];
    try {
      const source = samGovSource(async (rawUrl) => {
        const url = new URL(String(rawUrl));
        urls.push(url);
        return Response.json({
          totalRecords: 1,
          entityData: [{
            entityRegistration: {
              legalBusinessName: "Illinois Federal Supply LLC",
              ueiSAM: "ABCDEF123456",
              cageCode: "1AB23",
              registrationStatus: "Active",
              registrationExpirationDate: "2027-01-01",
            },
            coreData: {
              physicalAddress: {
                addressLine1: "10 Main St",
                city: "Chicago",
                stateOrProvinceCode: "IL",
                zipCode: "60601",
              },
              businessTypes: { businessTypeList: [{ businessTypeDesc: "Small Business" }] },
            },
            assertions: { goodsAndServices: { naicsList: [{ naicsCode: "541512" }] } },
          }],
        });
      });
      const result = await discoverCmmcProspects({
        tenantId: 901,
        query: "federal suppliers",
        states: ["IL"],
        dateWindow: { from: "2026-01-01", to: "2026-08-31" },
      }, source);

      assert.equal(result.outcome, "ok");
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0].company, "Illinois Federal Supply LLC");
      assert.equal(result.candidates[0].cage, "1AB23");
      assert.equal(result.candidates[0].state, "IL");
      assert.ok(urls.every((url) => url.pathname === "/entity-information/v3/entities"));
      assert.equal(urls[0].searchParams.get("physicalAddressProvinceOrStateCode"), "IL");
      assert.equal(urls[0].searchParams.get("registrationStatus"), "A");
      assert.equal(urls[0].searchParams.has("title"), false);
    } finally {
      if (previous === undefined) delete process.env.SAM_GOV_API_KEY;
      else process.env.SAM_GOV_API_KEY = previous;
    }
  });

  it("fails explicitly without a SAM key and makes no outbound request", async () => {
    const previous = process.env.SAM_GOV_API_KEY;
    delete process.env.SAM_GOV_API_KEY;
    let fetchCalls = 0;
    try {
      const source = samGovSource(async () => {
        fetchCalls++;
        throw new Error("must not fetch");
      });
      const response = await source.discover({
        tenantId: 1,
        query: "CMMC",
        states: ["VA"],
        dateWindow: { from: "2026-01-01", to: "2026-01-31" },
      });
      assert.equal(response.outcome, "configuration_error");
      assert.equal(fetchCalls, 0);
    } finally {
      if (previous === undefined) delete process.env.SAM_GOV_API_KEY;
      else process.env.SAM_GOV_API_KEY = previous;
    }
  });

  it("batches one entity request per state and accepts canonical sam.gov evidence", async () => {
    const previous = process.env.SAM_GOV_API_KEY;
    process.env.SAM_GOV_API_KEY = "test-key";
    const urls: URL[] = [];
    try {
      const source = samGovSource(async (rawUrl) => {
        const url = new URL(String(rawUrl));
        urls.push(url);
        const uei = url.searchParams.get("ueiSAM");
        const state = url.searchParams.get("physicalAddressProvinceOrStateCode") || uei?.split("-").at(-1) || "VA";
        return Response.json({
          totalRecords: 1,
          entityData: [{
            entityRegistration: {
              legalBusinessName: `${state} Defense LLC`,
              cageCode: `1${state}23`,
              ueiSAM: uei || `UEI-${state}`,
              registrationStatus: "Active",
            },
            coreData: { physicalAddress: { city: "Test City", stateOrProvinceCode: state } },
          }],
        });
      });
      const result = await discoverCmmcProspects({
        tenantId: 90,
        query: "cybersecurity",
        states: ["VA", "IL"],
        dateWindow: { from: "2026-01-02", to: "2026-02-03" },
      }, source);
      assert.equal(result.outcome, "ok");
      assert.equal(result.candidates.length, 2);
      assert.equal(result.sourceCalls, 2);
      assert.equal(urls.length, 2, "authoritative SAM entity rows must not be immediately re-queried");
      assert.ok(result.candidates.every((candidate) => candidate.sourceUrls[0].startsWith("https://sam.gov/")));
      const discoveryUrls = urls.filter((url) => url.searchParams.has("physicalAddressProvinceOrStateCode"));
      assert.deepEqual(discoveryUrls.map((url) => url.searchParams.get("physicalAddressProvinceOrStateCode")), ["IL", "VA"]);
      assert.ok(discoveryUrls.every((url) => url.searchParams.get("registrationStatus") === "A"));
    } finally {
      if (previous === undefined) delete process.env.SAM_GOV_API_KEY;
      else process.env.SAM_GOV_API_KEY = previous;
    }
  });

  it("keeps a two-state SAM run to one upstream request per state", async () => {
    const previous = process.env.SAM_GOV_API_KEY;
    process.env.SAM_GOV_API_KEY = "test-key";
    let calls = 0;
    try {
      const source = samGovSource(async (rawUrl) => {
        calls++;
        const url = new URL(String(rawUrl));
        const state = url.searchParams.get("physicalAddressProvinceOrStateCode") || "IL";
        return Response.json({
          totalRecords: 1,
          entityData: [{
            entityRegistration: {
              legalBusinessName: `${state} Reliable Supplier`,
              cageCode: state === "IL" ? "1IL23" : "1WI23",
              ueiSAM: `UEI-${state}`,
              registrationStatus: "Active",
            },
            coreData: { physicalAddress: { city: "Test City", stateOrProvinceCode: state } },
          }],
        });
      });
      const result = await discoverCmmcProspects({
        tenantId: 902,
        query: "CMMC level 1 business report",
        states: ["IL", "WI"],
        dateWindow: { from: "2026-01-01", to: "2026-08-31" },
      }, source);
      assert.equal(result.outcome, "ok");
      assert.equal(result.candidates.length, 2);
      assert.equal(calls, 2);
    } finally {
      if (previous === undefined) delete process.env.SAM_GOV_API_KEY;
      else process.env.SAM_GOV_API_KEY = previous;
    }
  });

  it("retries live-style 429s with bounded backoff and reports every upstream attempt", async () => {
    const previous = process.env.SAM_GOV_API_KEY;
    process.env.SAM_GOV_API_KEY = "test-key";
    let calls = 0;
    const waits: number[] = [];
    try {
      const source = samGovSource(async () => {
        calls++;
        if (calls < 3) return new Response("rate limited", { status: 429 });
        return Response.json({
          totalRecords: 1,
          entityData: [{
            entityRegistration: {
              legalBusinessName: "Recovered Supplier",
              cageCode: "1IL23",
              ueiSAM: "UEI-RECOVERED",
              registrationStatus: "Active",
            },
            coreData: { physicalAddress: { city: "Chicago", stateOrProvinceCode: "IL" } },
          }],
        });
      }, {
        retry429: true,
        sleep: async (milliseconds) => { waits.push(milliseconds); },
      });
      const result = await discoverCmmcProspects({
        tenantId: 903,
        query: "retry accounting",
        states: ["IL"],
        dateWindow: { from: "2026-01-01", to: "2026-08-31" },
      }, source);
      assert.equal(result.outcome, "ok");
      assert.equal(result.candidates.length, 1);
      assert.equal(result.sourceCalls, 3);
      assert.equal(calls, 3);
      assert.deepEqual(waits, [5_000, 15_000]);
    } finally {
      if (previous === undefined) delete process.env.SAM_GOV_API_KEY;
      else process.env.SAM_GOV_API_KEY = previous;
    }
  });

  it("resumes only the pending state after a paced multi-state run is rate limited", async () => {
    const previous = process.env.SAM_GOV_API_KEY;
    process.env.SAM_GOV_API_KEY = "test-key";
    const firstStates: string[] = [];
    const resumedStates: string[] = [];
    try {
      const firstSource = samGovSource(async (rawUrl) => {
        const state = new URL(String(rawUrl)).searchParams.get("physicalAddressProvinceOrStateCode")!;
        firstStates.push(state);
        if (state === "WI") return new Response("rate limited", { status: 429 });
        return Response.json({
          totalRecords: 1,
          entityData: [{
            entityRegistration: {
              legalBusinessName: "Illinois Supplier",
              cageCode: "1IL23",
              ueiSAM: "UEI-IL",
              registrationStatus: "Active",
            },
            coreData: { physicalAddress: { city: "Chicago", stateOrProvinceCode: "IL" } },
          }],
        });
      }, { retry429: false });
      const input = {
        tenantId: 904,
        query: "resumable paced report",
        states: ["IL", "WI"],
        dateWindow: { from: "2026-01-01", to: "2026-08-31" },
      };
      const partial = await discoverOrResumeCmmcProspects(input, null, firstSource);
      assert.equal(partial.outcome, "partial");
      assert.deepEqual(partial.completedStates, ["IL"]);
      assert.deepEqual(partial.pendingStates, ["WI"]);
      assert.equal(partial.candidates.length, 1);
      assert.equal(isCmmcProspectDeliveryReady(partial), false);

      const resumedSource = samGovSource(async (rawUrl) => {
        const state = new URL(String(rawUrl)).searchParams.get("physicalAddressProvinceOrStateCode")!;
        resumedStates.push(state);
        return Response.json({
          totalRecords: 1,
          entityData: [{
            entityRegistration: {
              legalBusinessName: "Wisconsin Supplier",
              cageCode: "1WI23",
              ueiSAM: "UEI-WI",
              registrationStatus: "Active",
            },
            coreData: { physicalAddress: { city: "Madison", stateOrProvinceCode: "WI" } },
          }],
        });
      }, { retry429: false });
      const completed = await discoverOrResumeCmmcProspects(input, partial, resumedSource);
      assert.equal(completed.outcome, "ok");
      assert.equal(completed.coverageComplete, true);
      assert.deepEqual(completed.completedStates, ["IL", "WI"]);
      assert.deepEqual(completed.pendingStates, []);
      assert.equal(completed.candidates.length, 2);
      assert.equal(isCmmcProspectDeliveryReady(completed), true);
      assert.deepEqual(firstStates, ["IL", "WI"]);
      assert.deepEqual(resumedStates, ["WI"]);
    } finally {
      if (previous === undefined) delete process.env.SAM_GOV_API_KEY;
      else process.env.SAM_GOV_API_KEY = previous;
    }
  });

  it("paces state batches with a configured delay", async () => {
    const previous = process.env.SAM_GOV_API_KEY;
    process.env.SAM_GOV_API_KEY = "test-key";
    const waits: number[] = [];
    const states: string[] = [];
    try {
      const source = samGovSource(async (rawUrl) => {
        const state = new URL(String(rawUrl)).searchParams.get("physicalAddressProvinceOrStateCode")!;
        states.push(state);
        return Response.json({ totalRecords: 0, entityData: [] });
      }, {
        retry429: false,
        batchDelayMs: 2_500,
        sleep: async (milliseconds) => { waits.push(milliseconds); },
      });
      const result = await discoverCmmcProspects({
        tenantId: 905,
        query: "paced state batches",
        states: ["IL", "WI"],
        dateWindow: { from: "2026-01-01", to: "2026-08-31" },
      }, source);
      assert.equal(result.outcome, "empty");
      assert.deepEqual(states, ["IL", "WI"]);
      assert.deepEqual(waits, [2_500]);
      assert.deepEqual(result.completedStates, ["IL", "WI"]);
    } finally {
      if (previous === undefined) delete process.env.SAM_GOV_API_KEY;
      else process.env.SAM_GOV_API_KEY = previous;
    }
  });

  it("accepts only attributable CAGE evidence and caches an identical tenant-scoped run", async () => {
    let batches = 0;
    let verifications = 0;
    const source: CmmcProspectSource = {
      async discover() {
        batches++;
        return {
          outcome: "ok",
          candidates: [
            { company: "Verified Defense LLC", state: "VA", cage: "1AB23", sourceUrl: "https://api.usaspending.gov/award/1", contactPath: "https://verified.example/contact" },
            { company: "Unverified Defense LLC", state: "VA", sourceUrl: "https://api.usaspending.gov/award/2" },
          ],
        };
      },
      async verify(candidate) {
        verifications++;
        return candidate.company === "Verified Defense LLC"
          ? { outcome: "ok", evidence: { cage: "1AB23", sourceUrl: "https://api.usaspending.gov/award/1" } }
          : { outcome: "empty" };
      },
    };

    const input = { tenantId: 41, query: " CMMC   level 1 ", states: ["va"], dateWindow: { from: "2025-01-01", to: "2025-12-31" } };
    const first = await discoverCmmcProspects(input, source);
    const second = await discoverCmmcProspects(input, source);

    assert.equal(first.candidates.length, 1);
    assert.equal(first.candidates[0].company_name, "Verified Defense LLC");
    assert.equal(first.candidates[0].cage, "1AB23");
    assert.equal(first.candidates[0].verification_status, "verified");
    assert.deepEqual(first.candidates[0].sourceUrls, ["https://api.usaspending.gov/award/1"]);
    assert.equal(first.excludedWithoutCage, 1);
    assert.equal(first.cacheKey, second.cacheKey);
    assert.equal(second.cached, true);
    assert.equal(batches, 1);
    assert.equal(verifications, 2);
  });

  it("keeps calls bounded and makes terminal no-data outcomes non-retryable", async () => {
    let batches = 0;
    let verifications = 0;
    const source: CmmcProspectSource = {
      async discover() {
        batches++;
        return { outcome: "empty" };
      },
      async verify() {
        verifications++;
        return { outcome: "ok", evidence: { cage: "1AB23", sourceUrl: "https://api.usaspending.gov/award/1" } };
      },
    };

    const result = await discoverCmmcProspects(
      { tenantId: 42, query: "federal contractors", states: ["VA"], dateWindow: { from: "2025-01-01", to: "2025-12-31" } },
      source,
    );

    assert.equal(result.outcome, "empty");
    assert.equal(result.terminal, true);
    assert.equal(result.retryable, false);
    assert.deepEqual(result.candidates, []);
    assert.equal(batches, 1);
    assert.equal(verifications, 0);
  });

  it("never performs more than twenty candidate verifications", async () => {
    let verifications = 0;
    const source: CmmcProspectSource = {
      async discover() {
        return {
          outcome: "ok",
          candidates: Array.from({ length: 30 }, (_, index) => ({
            company: `Contractor ${index}`, state: "VA", cage: "1AB23",
            sourceUrl: "https://api.sam.gov/opportunities/v2/search",
            contactPath: "https://contractor.example/contact",
          })),
        };
      },
      async verify(candidate) {
        verifications++;
        return { outcome: "ok", evidence: { cage: candidate.cage, sourceUrl: candidate.sourceUrl } };
      },
    };

    const result = await discoverCmmcProspects(
      { tenantId: 43, query: "contractor", states: ["VA"], dateWindow: { from: "2025-01-01", to: "2025-12-31" } },
      source,
    );
    assert.ok(verifications <= 20);
    assert.equal(result.verificationCalls, 20);
    assert.equal(result.candidates.length, 20);
  });

  it("rejects candidates whose evidence is outside the requested states", async () => {
    let verifications = 0;
    const source: CmmcProspectSource = {
      async discover() {
        return {
          outcome: "ok",
          candidates: [{ company: "Out of State Supplier", state: "IN", cage: "1AB23", sourceUrl: "https://sam.gov/opp/example", contactPath: "mailto:test@example.com" }],
        };
      },
      async verify(candidate) {
        verifications++;
        return { outcome: "ok", evidence: { cage: candidate.cage, sourceUrl: candidate.sourceUrl } };
      },
    };
    const result = await discoverCmmcProspects(
      { tenantId: 1, query: "supplier", states: ["IL"], dateWindow: { from: "2025-01-01", to: "2025-12-31" } },
      source,
    );
    assert.equal(result.outcome, "empty");
    assert.equal(result.candidates.length, 0);
    assert.equal(verifications, 0);
  });

  it("propagates retryable verification failures instead of caching terminal empty data", async () => {
    let batches = 0;
    let allowVerification = false;
    const source: CmmcProspectSource = {
      async discover() {
        batches++;
        return {
          outcome: "ok",
          candidates: [{ company: "Rate Limited Supplier", state: "IL", cage: "1AB23", sourceUrl: "https://sam.gov/opp/example", contactPath: "mailto:test@example.com" }],
        };
      },
      async verify() {
        return allowVerification
          ? { outcome: "ok", evidence: { cage: "1AB23", sourceUrl: "https://sam.gov/opp/example" } }
          : { outcome: "rate_limited" };
      },
    };
    const input = { tenantId: 1, query: "rate-limited verification", states: ["IL"], dateWindow: { from: "2025-01-01", to: "2025-12-31" } };
    const first = await discoverCmmcProspects(input, source);
    const second = await discoverCmmcProspects(input, source);
    assert.equal(first.outcome, "rate_limited");
    assert.equal(first.terminal, false);
    assert.equal(second.cached, false);
    assert.equal(batches, 2);
    assert.deepEqual(first.completedStates, []);
    assert.deepEqual(first.pendingStates, ["IL"]);
    assert.equal(isCmmcProspectDeliveryReady(first), false);
    allowVerification = true;
    const resumed = await discoverOrResumeCmmcProspects(input, first, source);
    assert.equal(resumed.outcome, "ok");
    assert.deepEqual(resumed.completedStates, ["IL"]);
    assert.deepEqual(resumed.pendingStates, []);
    assert.equal(isCmmcProspectDeliveryReady(resumed), true);
  });

  it("does not label a mixed terminal verification failure retryable or delivery-ready", async () => {
    const result = await discoverCmmcProspects({
      tenantId: 906,
      query: "mixed terminal verification",
      states: ["IL"],
      dateWindow: { from: "2026-01-01", to: "2026-08-31" },
    }, {
      async discover() {
        return {
          outcome: "ok",
          candidates: [
            { company: "Verified Supplier", state: "IL", cage: "1AB23", sourceUrl: "https://sam.gov/verified", contactPath: "https://verified.example" },
            { company: "Blocked Supplier", state: "IL", cage: "2BC34", sourceUrl: "https://sam.gov/blocked", contactPath: "https://blocked.example" },
          ],
        };
      },
      async verify(candidate) {
        return candidate.company === "Verified Supplier"
          ? { outcome: "ok", evidence: { cage: candidate.cage, sourceUrl: candidate.sourceUrl } }
          : { outcome: "forbidden" };
      },
    });
    assert.equal(result.outcome, "partial");
    assert.equal(result.retryable, false);
    assert.deepEqual(result.pendingStates, []);
    assert.equal(isCmmcProspectDeliveryReady(result), false);
  });

  it("keeps SAM transport and server failures distinct from legitimate empty data", async () => {
    const previous = process.env.SAM_GOV_API_KEY;
    process.env.SAM_GOV_API_KEY = "test-key";
    try {
      const serverFailure = samGovSource(async () => new Response("upstream", { status: 503 }));
      const networkFailure = samGovSource(async () => { throw new Error("ECONNRESET"); });
      const input = { tenantId: 7, query: "server failure", states: ["IL"], dateWindow: { from: "2025-01-01", to: "2025-12-31" } };
      assert.equal((await discoverCmmcProspects(input, serverFailure)).outcome, "source_error");
      assert.equal((await discoverCmmcProspects({ ...input, query: "network failure" }, networkFailure)).outcome, "source_error");
    } finally {
      if (previous === undefined) delete process.env.SAM_GOV_API_KEY;
      else process.env.SAM_GOV_API_KEY = previous;
    }
  });

  it("creates the complete outreach-ready artifact set from structured rows", async () => {
    const source: CmmcProspectSource = {
      async discover() {
        return { outcome: "ok", candidates: [{ company: "Export Supplier", state: "IL", cage: "1AB23", sourceUrl: "https://sam.gov/entity/UEI/coreData", contactPath: "https://supplier.example" }] };
      },
      async verify(candidate) {
        return { outcome: "ok", evidence: { cage: candidate.cage, sourceUrl: candidate.sourceUrl } };
      },
    };
    const result = await discoverCmmcProspects(
      { tenantId: 991, query: "export", states: ["IL"], dateWindow: { from: "2026-01-01", to: "2026-08-31" } },
      source,
    );
    const artifacts = buildCmmcProspectArtifacts(result);
    assert.deepEqual(buildCmmcProspectArtifacts(result), artifacts);
    assert.deepEqual(
      buildCmmcProspectArtifacts({
        ...result,
        cached: true,
        diagnostics: [...result.diagnostics, "durable_checkpoint_recovered"],
      }),
      artifacts,
    );
    assert.deepEqual(artifacts.map((artifact) => artifact.fileName), [
      "prospects.json", "prospects.csv", "prospects_report.md", "run_log.md",
    ]);
    assert.match(artifacts.find((artifact) => artifact.fileName === "prospects.csv")!.content, /Export Supplier/);
    assert.match(artifacts.find((artifact) => artifact.fileName === "prospects_report.md")!.content, /does not prove CMMC/i);
  });

  it("delivers every artifact with stable per-run idempotency keys and preserves partial failures", async () => {
    const source: CmmcProspectSource = {
      async discover() {
        return { outcome: "ok", candidates: [{ company: "Durable Supplier", state: "WI", cage: "2CD34", sourceUrl: "https://sam.gov/entity/UEI-WI/coreData", contactPath: "https://sam.gov/entity/UEI-WI/coreData" }] };
      },
      async verify(candidate) {
        return { outcome: "ok", evidence: { cage: candidate.cage, sourceUrl: candidate.sourceUrl } };
      },
    };
    const result = await discoverCmmcProspects(
      { tenantId: 992, query: "durable", states: ["WI"], dateWindow: { from: "2026-01-01", to: "2026-08-31" } },
      source,
    );
    const keys: string[] = [];
    const deliveries = await deliverCmmcProspectArtifacts(result, { tenantId: 992, projectId: 372 }, async (artifact, key) => {
      keys.push(key);
      if (artifact.fileName === "run_log.md") throw new Error("Drive permission verification failed");
      return { success: true, artifactId: keys.length, viewUrl: `https://drive.google.com/file/d/${keys.length}/view` };
    });
    assert.equal(deliveries.length, 4);
    assert.equal(new Set(keys).size, 4);
    assert.ok(keys.every((key) => key.length <= 300));
    assert.ok(keys.every((key) => key.includes(result.cacheKey)));
    assert.ok(keys.every((key) => key.includes("p372")));
    assert.equal(deliveries.find((item) => item.fileName === "run_log.md")?.success, false);
    assert.match(deliveries.find((item) => item.fileName === "run_log.md")?.error || "", /permission verification/i);
  });

  it("keeps artifact idempotency keys valid for long real-world discovery queries", async () => {
    const result = await discoverCmmcProspects(
      {
        tenantId: 993,
        query: `CMMC Level 1 self-assessment preparation prospects with attributable CAGE evidence and public contact paths ${"federal contractor ".repeat(20)}`,
        states: ["IL", "WI"],
        dateWindow: { from: "2026-01-01", to: "2026-08-31" },
      },
      {
        async discover() {
          return {
            outcome: "ok",
            candidates: [
              { company: "Long Query Supplier", state: "IL", cage: "3EF45", sourceUrl: "https://sam.gov/entity/UEI-LONG/coreData" },
            ],
          };
        },
        async verify(candidate) {
          return { outcome: "ok", evidence: { cage: candidate.cage, sourceUrl: candidate.sourceUrl } };
        },
      },
    );
    const keys: string[] = [];
    await deliverCmmcProspectArtifacts(result, { tenantId: 993, projectId: 372 }, async (_artifact, key) => {
      keys.push(key);
      if (key.length > 300) throw new Error("Artifact requires a valid idempotency key");
      return { success: true };
    });

    assert.equal(keys.length, 4);
    assert.equal(new Set(keys).size, 4);
    assert.ok(keys.every((key) => key.length <= 300));
    const sourceRunKey = cmmcProspectSourceRunKey(result.cacheKey);
    const repeatedSourceRunKey = cmmcProspectSourceRunKey(result.cacheKey);
    const distinctSourceRunKey = cmmcProspectSourceRunKey(`${result.cacheKey}:different`);
    assert.equal(sourceRunKey, repeatedSourceRunKey);
    assert.notEqual(sourceRunKey, distinctSourceRunKey);
    assert.ok(sourceRunKey.length <= 300);
    assert.equal(
      cmmcProspectArtifactKey(result.cacheKey, 372, "prospects.json"),
      keys.find((key) => key.endsWith(":prospects.json")),
    );
    assert.notEqual(
      cmmcProspectArtifactKey(result.cacheKey, 372, "prospects.json"),
      cmmcProspectArtifactKey(result.cacheKey, 373, "prospects.json"),
    );
    assert.notEqual(
      cmmcProspectArtifactKey(result.cacheKey, 372, "prospects.json"),
      cmmcProspectArtifactKey(result.cacheKey, 372, "prospects.csv"),
    );
    assert.doesNotThrow(() =>
      buildArtifactIntent({
        tenantId: 993,
        projectId: 372,
        logicalName: "prospects.json",
        artifactKind: "cmmc_prospect_report",
        mimeType: "application/json",
        bytes: Buffer.from("{}"),
        sourceRunKey,
        idempotencyKey: keys[0],
      }),
    );
  });
});