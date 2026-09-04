/** Credential handling across redirects. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { callerHeaders, headersForHop } from "../dist/http.js";

const withAuth = { authorization: "Bearer dk_SECRET", accept: "*/*" };

describe("headersForHop", () => {
  test("keeps credentials on a same-origin redirect", () => {
    const out = headersForHop(withAuth, "https://a.example/one", "https://a.example/two");
    assert.equal(out?.authorization, "Bearer dk_SECRET");
  });

  test("strips credentials when the host changes", () => {
    const out = headersForHop(withAuth, "https://a.example/one", "https://evil.example/two");
    assert.equal(out?.authorization, undefined);
    assert.equal(out?.accept, "*/*", "non-credential headers should survive");
  });

  test("strips credentials when the scheme or port changes", () => {
    assert.equal(
      headersForHop(withAuth, "https://a.example/x", "https://a.example:8443/x")?.authorization,
      undefined,
    );
  });

  test("strips cookies too, case-insensitively", () => {
    const out = headersForHop(
      { Authorization: "Bearer x", Cookie: "s=1" },
      "https://a.example/x",
      "https://b.example/x",
    );
    assert.deepEqual(out, {});
  });
});

describe("callerHeaders", () => {
  test("keeps ordinary caller headers", () => {
    assert.deepEqual(callerHeaders({ accept: "application/json" }), {
      accept: "application/json",
    });
  });

  test("strips a caller-supplied user-agent, whatever its casing", () => {
    // The User-Agent is how this client identifies itself to sites that gate on client
    // identity. It is not a knob callers get to turn.
    assert.deepEqual(callerHeaders({ "User-Agent": "Mozilla/5.0", accept: "*/*" }), {
      accept: "*/*",
    });
    assert.deepEqual(callerHeaders({ "user-agent": "curl/8.0" }), {});
  });

  test("handles no headers at all", () => {
    assert.deepEqual(callerHeaders(undefined), {});
  });
});
