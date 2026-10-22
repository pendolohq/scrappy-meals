import { describe, expect, it } from "vitest";

import { isKnownDevice, rememberDevice } from "./known-device";

const SECRET = "a-test-secret-that-is-long-enough";
const ALEX = { email: "alex@example.test", sessionVersion: 1 };
const SAM = { email: "sam@example.test", sessionVersion: 3 };

describe("known devices", () => {
  it("recognises a device after its member signed in on it", () => {
    const cookie = rememberDevice(undefined, ALEX, SECRET);
    expect(isKnownDevice(cookie, ALEX, SECRET)).toBe(true);
    expect(isKnownDevice(cookie, SAM, SECRET)).toBe(false);
  });

  it("remembers everyone who signed in on a shared device", () => {
    const alex = rememberDevice(undefined, ALEX, SECRET);
    const both = rememberDevice(alex, SAM, SECRET);
    expect(isKnownDevice(both, ALEX, SECRET)).toBe(true);
    expect(isKnownDevice(both, SAM, SECRET)).toBe(true);
    // Signing in again doesn't grow it.
    expect(rememberDevice(both, SAM, SECRET)).toBe(both);
  });

  it("keeps the most recent few", () => {
    let cookie: string | undefined;
    for (let n = 0; n < 8; n++) {
      cookie = rememberDevice(
        cookie,
        { email: `m${n}@example.test`, sessionVersion: 1 },
        SECRET
      );
    }
    expect(
      isKnownDevice(
        cookie,
        { email: "m7@example.test", sessionVersion: 1 },
        SECRET
      )
    ).toBe(true);
    expect(
      isKnownDevice(
        cookie,
        { email: "m0@example.test", sessionVersion: 1 },
        SECRET
      )
    ).toBe(false);
  });

  it("forgets a member's devices when their password changes", () => {
    const cookie = rememberDevice(undefined, ALEX, SECRET);
    expect(isKnownDevice(cookie, { ...ALEX, sessionVersion: 2 }, SECRET)).toBe(
      false
    );
  });

  it("can't be made up without the secret", () => {
    const other = rememberDevice(undefined, ALEX, "another-secret");
    expect(isKnownDevice(other, ALEX, SECRET)).toBe(false);
    expect(isKnownDevice("alex@example.test", ALEX, SECRET)).toBe(false);
    expect(isKnownDevice(undefined, ALEX, SECRET)).toBe(false);
    expect(isKnownDevice("", ALEX, SECRET)).toBe(false);
  });
});
