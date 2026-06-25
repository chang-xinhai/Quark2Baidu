import { Agent, fetch } from "undici";
import { HttpError } from "./errors.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

export function createDispatcher(verifySsl = true) {
  return new Agent({
    connect: {
      rejectUnauthorized: verifySsl
    }
  });
}

export function normalizeCookieHeader(rawCookie = "") {
  if (typeof rawCookie !== "string") return "";
  return rawCookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("; ");
}

export function urlWithParams(url, params = {}) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      target.searchParams.set(key, String(value));
    }
  }
  return target;
}

async function request(url, options = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    dispatcher,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    expectJson = true
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      dispatcher,
      signal: controller.signal
    });
    const text = await response.text();

    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status} for ${new URL(url).hostname}`, {
        status: response.status,
        bodyPreview: text.slice(0, 240)
      });
    }

    if (!expectJson) return text;

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new HttpError("Response was not valid JSON.", {
        status: response.status,
        bodyPreview: text.slice(0, 240),
        cause: error
      });
    }
  } catch (error) {
    if (error.name === "AbortError") {
      throw new HttpError(`Request timed out after ${timeoutMs}ms.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function requestJson(url, options = {}) {
  return request(url, { ...options, expectJson: true });
}

export function requestText(url, options = {}) {
  return request(url, { ...options, expectJson: false });
}

export function formBody(data) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      body.set(key, String(value));
    }
  }
  return body;
}
