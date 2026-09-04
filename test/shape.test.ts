/**
 * Normalizers for JSON from catalogs that publish no contract. These exist because a wrong
 * type used to throw three layers away from where it arrived: a non-string `description` blew
 * up inside the search formatter, and a non-string `style_type` on `.split`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asString, asStringArray } from "../dist/shape.js";

describe("asString", () => {
  test("passes a usable string through", () => {
    assert.equal(asString("hello"), "hello");
  });

  test("rejects every non-string, including the truthy ones", () => {
    // A number is truthy, so a bare `if (value)` guard would let it reach .split or .slice.
    for (const value of [12345, { a: 1 }, ["x"], true, null, undefined]) {
      assert.equal(asString(value), undefined, `expected ${JSON.stringify(value)} to be rejected`);
    }
  });

  test("treats an empty string as absent", () => {
    assert.equal(asString(""), undefined);
  });
});

describe("asStringArray", () => {
  test("keeps only the string members", () => {
    assert.deepEqual(asStringArray(["a", 1, null, "b", {}]), ["a", "b"]);
  });

  test("rejects non-arrays and arrays with no strings", () => {
    for (const value of ["not an array", 5, null, undefined, {}, [], [1, 2]]) {
      assert.equal(asStringArray(value), undefined);
    }
  });
});
