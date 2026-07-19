import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertTenantContext,
  isStrictTenantContext,
  ADMIN_TENANT_ID,
  _resetTenantContextWarnings,
} from "../../server/storage-helpers/tenant-context";

// R74.13g — STRICT_TENANT_CONTEXT runtime flag tests.
// Defends against the silent `?? 1` fall-through that lets tenant A's
// step-ledger run silently get scoped to tenant 1 (admin/Bob).

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

test("ADMIN_TENANT_ID is 1 (Bob's tenant)", () => {
  assert.equal(ADMIN_TENANT_ID, 1);
});

test("isStrictTenantContext: false when env unset", () => {
  withEnv("STRICT_TENANT_CONTEXT", undefined, () => {
    assert.equal(isStrictTenantContext(), false);
  });
});

test("isStrictTenantContext: true when env=='true'", () => {
  withEnv("STRICT_TENANT_CONTEXT", "true", () => {
    assert.equal(isStrictTenantContext(), true);
  });
});

test("isStrictTenantContext: false for any other value", () => {
  withEnv("STRICT_TENANT_CONTEXT", "1", () => {
    assert.equal(isStrictTenantContext(), false);
  });
  withEnv("STRICT_TENANT_CONTEXT", "yes", () => {
    assert.equal(isStrictTenantContext(), false);
  });
  withEnv("STRICT_TENANT_CONTEXT", "TRUE", () => {
    assert.equal(isStrictTenantContext(), false);
  });
});

test("assertTenantContext: returns valid tenantId unchanged (permissive)", () => {
  withEnv("STRICT_TENANT_CONTEXT", undefined, () => {
    assert.equal(assertTenantContext(42, "test:positive"), 42);
    assert.equal(assertTenantContext(1, "test:admin"), 1);
    assert.equal(assertTenantContext(999999, "test:large"), 999999);
  });
});

test("assertTenantContext: returns valid tenantId unchanged (strict)", () => {
  withEnv("STRICT_TENANT_CONTEXT", "true", () => {
    assert.equal(assertTenantContext(42, "test:strict-positive"), 42);
  });
});

test("assertTenantContext (permissive): falls back to ADMIN_TENANT_ID for null", () => {
  withEnv("STRICT_TENANT_CONTEXT", undefined, () => {
    _resetTenantContextWarnings();
    assert.equal(assertTenantContext(null, "test:perm-null"), ADMIN_TENANT_ID);
  });
});

test("assertTenantContext (permissive): falls back for undefined", () => {
  withEnv("STRICT_TENANT_CONTEXT", undefined, () => {
    _resetTenantContextWarnings();
    assert.equal(assertTenantContext(undefined, "test:perm-undef"), ADMIN_TENANT_ID);
  });
});

test("assertTenantContext (permissive): falls back for fail-open shapes (0, NaN, -1, 1.5)", () => {
  withEnv("STRICT_TENANT_CONTEXT", undefined, () => {
    _resetTenantContextWarnings();
    assert.equal(assertTenantContext(0, "test:perm-0"), ADMIN_TENANT_ID);
    assert.equal(assertTenantContext(NaN, "test:perm-nan"), ADMIN_TENANT_ID);
    assert.equal(assertTenantContext(-1, "test:perm-neg"), ADMIN_TENANT_ID);
    assert.equal(assertTenantContext(1.5, "test:perm-frac"), ADMIN_TENANT_ID);
    assert.equal(assertTenantContext(Infinity, "test:perm-inf"), ADMIN_TENANT_ID);
  });
});

test("assertTenantContext (strict): throws for null", () => {
  withEnv("STRICT_TENANT_CONTEXT", "true", () => {
    assert.throws(
      () => assertTenantContext(null, "test:strict-null"),
      /STRICT_TENANT_CONTEXT.*missing\/invalid/,
    );
  });
});

test("assertTenantContext (strict): throws for undefined", () => {
  withEnv("STRICT_TENANT_CONTEXT", "true", () => {
    assert.throws(
      () => assertTenantContext(undefined, "test:strict-undef"),
      /STRICT_TENANT_CONTEXT/,
    );
  });
});

test("assertTenantContext (strict): throws for fail-open shapes (0, NaN, -1, 1.5, Infinity)", () => {
  withEnv("STRICT_TENANT_CONTEXT", "true", () => {
    assert.throws(() => assertTenantContext(0, "test:s-0"), /STRICT_TENANT_CONTEXT/);
    assert.throws(() => assertTenantContext(NaN, "test:s-nan"), /STRICT_TENANT_CONTEXT/);
    assert.throws(() => assertTenantContext(-1, "test:s-neg"), /STRICT_TENANT_CONTEXT/);
    assert.throws(() => assertTenantContext(1.5, "test:s-frac"), /STRICT_TENANT_CONTEXT/);
    assert.throws(() => assertTenantContext(Infinity, "test:s-inf"), /STRICT_TENANT_CONTEXT/);
  });
});

test("assertTenantContext (strict): error message includes sourceTag and raw value", () => {
  withEnv("STRICT_TENANT_CONTEXT", "true", () => {
    try {
      assertTenantContext(0, "chat-engine:processMessage");
      assert.fail("should have thrown");
    } catch (err: any) {
      assert.match(err.message, /chat-engine:processMessage/);
      assert.match(err.message, /raw=0/);
    }
  });
});

test("assertTenantContext (permissive): warning is rate-limited per sourceTag", () => {
  withEnv("STRICT_TENANT_CONTEXT", undefined, () => {
    _resetTenantContextWarnings();
    const origWarn = console.warn;
    const calls: string[] = [];
    console.warn = (msg: string) => calls.push(msg);
    try {
      // 5 calls with the same sourceTag should produce exactly 1 warning
      for (let i = 0; i < 5; i++) {
        assertTenantContext(null, "test:rate-limit-A");
      }
      assert.equal(calls.length, 1, `expected 1 warning, got ${calls.length}`);
      // Different sourceTag → another warning
      assertTenantContext(null, "test:rate-limit-B");
      assert.equal(calls.length, 2);
    } finally {
      console.warn = origWarn;
    }
  });
});
