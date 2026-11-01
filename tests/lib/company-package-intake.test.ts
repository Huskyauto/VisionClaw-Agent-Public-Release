import test from "node:test";
import assert from "node:assert/strict";
import { companyPackageBody } from "../../server/routes/company-report-packages";

const input = { requestId: "00000000-0000-4000-8000-000000000001",
  company: "Example Company", acceptResearchCost: true };

test("business email supplies the starting website; personal email needs a website", () => {
  const parsed = companyPackageBody.safeParse({ ...input, contactEmail: "sales@example.com" });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.website, "https://example.com/");
    assert.equal(parsed.data.contactEmail, "sales@example.com");
  }
  for (const contactEmail of ["owner@gmail.com", "owner@outlook.com", "owner@localhost", "owner@127.0.0.1"])
    assert.equal(companyPackageBody.safeParse({ ...input, contactEmail }).success, false, contactEmail);
  const explicit = companyPackageBody.parse({ ...input, contactEmail: "owner@gmail.com", website: "https://example.com/" });
  assert.equal(explicit.website, "https://example.com/");
  assert.equal(companyPackageBody.safeParse(input).success, false);
});
