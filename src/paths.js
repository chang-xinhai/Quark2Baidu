import { ValidationError } from "./errors.js";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function normalizeRemotePath(input = "/", { directory = true } = {}) {
  if (typeof input !== "string") {
    throw new ValidationError("Remote path must be a string.");
  }

  const trimmed = input.trim();
  const raw = trimmed || "/";
  if (CONTROL_CHARS.test(raw)) {
    throw new ValidationError("Remote path contains control characters.");
  }

  const normalized = raw.replace(/\\/g, "/").replace(/\/+/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new ValidationError("Remote path cannot contain '.' or '..'.");
    }
  }

  let result = `/${parts.join("/")}`;
  if (result === "/") return "/";
  if (directory && !result.endsWith("/")) result += "/";
  return result;
}

export function assertSafeRemoteSegment(segment) {
  if (typeof segment !== "string" || !segment.trim()) {
    throw new ValidationError("Remote filename cannot be empty.");
  }
  if (CONTROL_CHARS.test(segment) || segment.includes("/") || segment.includes("\\")) {
    throw new ValidationError(`Remote filename is not safe: ${segment}`);
  }
  if (segment === "." || segment === "..") {
    throw new ValidationError("Remote filename cannot be '.' or '..'.");
  }
  return segment;
}

export function remoteJoin(root, relativePath, filename) {
  const rootParts = normalizeRemotePath(root, { directory: true }).split("/").filter(Boolean);
  const relativeParts = normalizeRemotePath(relativePath || "/", { directory: true }).split("/").filter(Boolean);
  const name = assertSafeRemoteSegment(filename);
  return `/${[...rootParts, ...relativeParts, name].join("/")}`.replace(/\/+/g, "/");
}

export function remoteParent(path) {
  const normalized = normalizeRemotePath(path, { directory: false });
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}${parts.length ? "/" : ""}`;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const precision = unit === 0 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(precision)} ${units[unit]}`;
}
