import { describe, expect, it } from "vitest";

import { isSocialPostUrl, normaliseRecipeUrl } from "./recipe-url";

function rejected(input: string) {
  const result = normaliseRecipeUrl(input);
  if (result.ok) {
    throw new Error(`expected ${input} to be rejected, got ${result.url}`);
  }
  return result.error;
}

describe("normaliseRecipeUrl", () => {
  it("accepts an https URL and returns the normalised href", () => {
    expect(normaliseRecipeUrl("https://example.com/recipes/soup")).toEqual({
      ok: true,
      url: "https://example.com/recipes/soup",
    });
  });

  it("accepts http", () => {
    expect(normaliseRecipeUrl("http://example.com/soup")).toEqual({
      ok: true,
      url: "http://example.com/soup",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseRecipeUrl("  https://example.com/soup \n")).toEqual({
      ok: true,
      url: "https://example.com/soup",
    });
  });

  it("drops the fragment but keeps the query", () => {
    expect(
      normaliseRecipeUrl("https://example.com/soup?id=7&x=y#step-2")
    ).toEqual({
      ok: true,
      url: "https://example.com/soup?id=7&x=y",
    });
  });

  it("returns what new URL() would, so equal pages compare equal", () => {
    expect(normaliseRecipeUrl("HTTPS://Example.COM")).toEqual({
      ok: true,
      url: new URL("https://example.com").href,
    });
  });

  it("accepts a URL of exactly 2048 characters", () => {
    const base = "https://example.com/";
    const input = base + "a".repeat(2048 - base.length);
    expect(input).toHaveLength(2048);
    expect(normaliseRecipeUrl(input).ok).toBe(true);
  });

  it("rejects an empty or blank string", () => {
    expect(rejected("")).not.toBe("");
    expect(rejected("   ")).not.toBe("");
  });

  it("rejects text that is not a URL", () => {
    expect(rejected("chicken soup")).not.toBe("");
    expect(rejected("example.com/soup")).not.toBe("");
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://example.com/soup",
    "data:text/html,hi",
  ])("rejects the scheme in %s", (input) => {
    expect(rejected(input)).not.toBe("");
  });

  it("rejects credentials in the URL", () => {
    expect(rejected("https://user:pw@example.com/soup")).not.toBe("");
    expect(rejected("https://user@example.com/soup")).not.toBe("");
  });

  it.each([
    "http://localhost/soup",
    "http://localhost:8080/soup",
    "http://mealie:9000/api",
    "http://postgres",
    "http://localhost./x",
    "http://mealie.:9000/api",
    "http://postgres./",
  ])("rejects the single-label host in %s", (input) => {
    expect(rejected(input)).not.toBe("");
  });

  it.each([
    "http://10.0.0.5/",
    "http://169.254.169.254/latest",
    "http://192.168.1.1:8080/soup",
    "http://8.8.8.8/",
    "http://0x7f.1/",
  ])("rejects the IPv4 address in %s", (input) => {
    expect(rejected(input)).not.toBe("");
  });

  it("accepts a host name with digits in it", () => {
    expect(normaliseRecipeUrl("https://123.example.com/soup").ok).toBe(true);
  });

  it("rejects a URL over 2048 characters", () => {
    const base = "https://example.com/";
    expect(rejected(base + "a".repeat(2049 - base.length))).not.toBe("");
  });

  it("rejects a URL that grows past 2048 characters once encoded", () => {
    expect(rejected("https://example.com/" + "é".repeat(1000))).not.toBe("");
  });

  it("rejects host names with characters a host can't have", () => {
    expect(rejected('https://a"b.com/')).not.toBe("");
  });
});

describe("normaliseRecipeUrl for social posts", () => {
  it.each([
    [
      "https://www.instagram.com/p/DAbc123/?igsh=MXx4&utm_source=ig_web_copy_link",
      "https://www.instagram.com/p/DAbc123/",
    ],
    [
      "https://www.facebook.com/share/p/1AbCd/?mibextid=wwXIfr&rdid=xyz",
      "https://www.facebook.com/share/p/1AbCd/",
    ],
    [
      "https://m.facebook.com/story.php?fbclid=abc",
      "https://m.facebook.com/story.php",
    ],
    [
      "https://m.facebook.com/story.php?story_fbid=1&id=2&mibextid=x",
      "https://m.facebook.com/story.php?id=2&story_fbid=1",
    ],
    ["https://fb.watch/abc123/?mibextid=x#t=3", "https://fb.watch/abc123/"],
  ])("drops the query string of %s", (input, expected) => {
    expect(normaliseRecipeUrl(input)).toEqual({ ok: true, url: expected });
  });

  it("keeps the params that identify the post", () => {
    const a = normaliseRecipeUrl("https://www.facebook.com/watch/?v=1");
    const b = normaliseRecipeUrl("https://www.facebook.com/watch/?v=2");
    expect(a).not.toEqual(b);
    expect(a).toEqual({ ok: true, url: "https://www.facebook.com/watch/?v=1" });
  });

  it("compares equal whatever the order of the params", () => {
    const a = normaliseRecipeUrl(
      "https://m.facebook.com/story.php?id=2&story_fbid=1"
    );
    const b = normaliseRecipeUrl(
      "https://m.facebook.com/story.php?story_fbid=1&id=2"
    );
    expect(a).toEqual(b);
  });

  it("keeps the query of a lookalike host", () => {
    expect(normaliseRecipeUrl("https://notfacebook.com/soup?id=7")).toEqual({
      ok: true,
      url: "https://notfacebook.com/soup?id=7",
    });
  });

  it("makes the same post with different tracking parameters equal", () => {
    const a = normaliseRecipeUrl("https://www.instagram.com/p/X/?igsh=1");
    const b = normaliseRecipeUrl("https://www.instagram.com/p/X/?igsh=2");
    expect(a).toEqual(b);
  });

  it("still applies the usual checks to social URLs", () => {
    expect(rejected("https://user:pw@www.instagram.com/p/X/")).not.toBe("");
    expect(rejected("ftp://www.facebook.com/x")).not.toBe("");
  });
});

describe("isSocialPostUrl", () => {
  it.each([
    "https://instagram.com/p/abc/",
    "https://www.instagram.com/reel/abc/",
    "https://facebook.com/share/p/abc",
    "https://www.facebook.com/share/p/abc",
    "https://m.facebook.com/story.php?id=1",
    "https://web.facebook.com/x/posts/1",
    "https://fb.watch/abc/",
    "https://www.fb.watch/abc/",
    "HTTPS://WWW.INSTAGRAM.COM/p/abc/",
    "http://www.instagram.com/p/abc/",
  ])("is true for %s", (url) => {
    expect(isSocialPostUrl(url)).toBe(true);
  });

  it.each([
    "https://notfacebook.com/x",
    "https://facebook.com.evil.example/x",
    "https://instagram.co/p/abc",
    "https://fakeinstagram.com/p/abc",
    "https://example.com/?u=https://www.facebook.com/x",
    "https://example.com/instagram.com",
    "https://user@evil.example/facebook.com",
  ])("is false for the lookalike %s", (url) => {
    expect(isSocialPostUrl(url)).toBe(false);
  });

  it.each([
    "",
    "   ",
    "instagram",
    "www.instagram.com/p/abc",
    "https://",
    "not a url",
    "javascript:alert(1)",
  ])("is false for unusable input %j", (input) => {
    expect(isSocialPostUrl(input)).toBe(false);
  });

  it("is false for a normal recipe site", () => {
    expect(isSocialPostUrl("https://example.com/soup")).toBe(false);
  });
});
