import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConfig, redactSecret } from "../src/config.js";
import { normalizeCookieHeader } from "../src/http.js";
import { normalizeRemotePath, remoteJoin, remoteParent } from "../src/paths.js";
import { BaiduClient } from "../src/clients/baidu.js";

test("normalizes cookie headers without changing values", () => {
  assert.equal(normalizeCookieHeader(" a=1 ; b=two=2; ; c=3 "), "a=1; b=two=2; c=3");
});

test("normalizes safe Baidu paths", () => {
  assert.equal(normalizeRemotePath("Q2B\\Movies//", { directory: true }), "/Q2B/Movies/");
  assert.equal(remoteJoin("/Q2B/", "/Work/docs/", "readme.txt"), "/Q2B/Work/docs/readme.txt");
  assert.equal(remoteParent("/Q2B/Work/docs/readme.txt"), "/Q2B/Work/docs/");
});

test("rejects unsafe remote paths and filenames", () => {
  assert.throws(() => normalizeRemotePath("/Q2B/../secret/"), /cannot contain/);
  assert.throws(() => remoteJoin("/Q2B/", "/", "../bad.txt"), /filename/);
  assert.throws(() => remoteJoin("/Q2B/", "/", "bad/name.txt"), /filename/);
});

test("normalizes config from legacy Python keys", () => {
  const config = normalizeConfig({
    quark_cookie: "q",
    baidu_cookie: "b",
    target_path: "Q2B",
    concurrency: "99",
    chunk_size: "1",
    fallback_upload: false,
    verify_ssl: false
  });
  assert.equal(config.quarkCookie, "q");
  assert.equal(config.baiduCookie, "b");
  assert.equal(config.targetPath, "/Q2B/");
  assert.equal(config.concurrency, 20);
  assert.equal(config.chunkSize, 64 * 1024);
  assert.equal(config.fallbackUpload, false);
  assert.equal(config.verifySsl, false);
});

test("redacts secrets for display", () => {
  assert.equal(redactSecret(""), "");
  assert.equal(redactSecret("1234567890"), "********");
  assert.equal(redactSecret("abcdefghijklmnopqrstuvwxyz"), "abcd...wxyz");
});

test("Baidu MD5 simulator stays compatible with known implementation", () => {
  assert.equal(
    BaiduClient.encMd5Simulator("0123456789abcdef0123456789abcdef"),
    "888888888o8888888888888888888888"
  );
});
