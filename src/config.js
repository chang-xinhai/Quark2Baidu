import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeRemotePath } from "./paths.js";

export const DEFAULT_CHUNK_SIZE = 256 * 1024;
export const DEFAULT_CONCURRENCY = 3;

export const DEFAULT_CONFIG = Object.freeze({
  quarkCookie: "",
  baiduCookie: "",
  targetPath: "/Q2B/",
  concurrency: DEFAULT_CONCURRENCY,
  chunkSize: DEFAULT_CHUNK_SIZE,
  fallbackUpload: true,
  verifySsl: true
});

function platformConfigHome() {
  if (process.env.Q2B_CONFIG_HOME) return process.env.Q2B_CONFIG_HOME;
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "q2b");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "q2b");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "q2b");
}

export function resolveConfigPath(explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  if (process.env.Q2B_CONFIG) return path.resolve(process.env.Q2B_CONFIG);
  return path.join(platformConfigHome(), "config.json");
}

function fromLegacyKeys(raw) {
  return {
    quarkCookie: raw.quarkCookie ?? raw.quark_cookie,
    baiduCookie: raw.baiduCookie ?? raw.baidu_cookie,
    targetPath: raw.targetPath ?? raw.target_path,
    concurrency: raw.concurrency,
    chunkSize: raw.chunkSize ?? raw.chunk_size,
    fallbackUpload: raw.fallbackUpload ?? raw.fallback_upload,
    verifySsl: raw.verifySsl ?? raw.verify_ssl
  };
}

export function normalizeConfig(raw = {}) {
  const merged = { ...DEFAULT_CONFIG, ...Object.fromEntries(Object.entries(fromLegacyKeys(raw)).filter(([, value]) => value !== undefined)) };
  return {
    quarkCookie: String(merged.quarkCookie || "").trim(),
    baiduCookie: String(merged.baiduCookie || "").trim(),
    targetPath: normalizeRemotePath(String(merged.targetPath || DEFAULT_CONFIG.targetPath), { directory: true }),
    concurrency: Math.max(1, Math.min(20, Number.parseInt(merged.concurrency, 10) || DEFAULT_CONCURRENCY)),
    chunkSize: Math.max(64 * 1024, Math.min(4 * 1024 * 1024, Number.parseInt(merged.chunkSize, 10) || DEFAULT_CHUNK_SIZE)),
    fallbackUpload: Boolean(merged.fallbackUpload),
    verifySsl: Boolean(merged.verifySsl)
  };
}

export async function loadConfig(configPath) {
  try {
    const text = await fs.readFile(configPath, "utf8");
    return normalizeConfig(JSON.parse(text));
  } catch (error) {
    if (error.code === "ENOENT") return { ...DEFAULT_CONFIG };
    throw error;
  }
}

export async function saveConfig(configPath, config) {
  const normalized = normalizeConfig(config);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  await fs.writeFile(configPath, payload, { mode: 0o600 });
  try {
    await fs.chmod(configPath, 0o600);
  } catch {
    // Windows may ignore POSIX modes; the write still succeeds.
  }
  return normalized;
}

export function withEnvOverrides(config) {
  return normalizeConfig({
    ...config,
    quarkCookie: process.env.Q2B_QUARK_COOKIE || config.quarkCookie,
    baiduCookie: process.env.Q2B_BAIDU_COOKIE || config.baiduCookie
  });
}

export function redactSecret(value = "") {
  if (!value) return "";
  if (value.length <= 10) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function publicConfig(config) {
  return {
    ...config,
    quarkCookie: redactSecret(config.quarkCookie),
    baiduCookie: redactSecret(config.baiduCookie)
  };
}
