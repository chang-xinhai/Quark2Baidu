import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import { fetch } from "undici";
import { AuthError, Q2BError } from "../errors.js";
import { createDispatcher, normalizeCookieHeader, requestJson, urlWithParams } from "../http.js";

export const UA_QUARK =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch";

export class QuarkClient {
  static BASE_URL = "https://drive-pc.quark.cn/1/clouddrive";

  constructor({ cookie, verifySsl = true, timeoutMs = 30_000 }) {
    this.cookie = normalizeCookieHeader(cookie);
    this.timeoutMs = timeoutMs;
    this.dispatcher = createDispatcher(verifySsl);
    this.headers = {
      "User-Agent": UA_QUARK,
      Origin: "https://pan.quark.cn",
      Referer: "https://pan.quark.cn/",
      Cookie: this.cookie
    };
  }

  async close() {
    await this.dispatcher.close();
  }

  async checkAlive() {
    try {
      const data = await this.listFiles("0", { page: 1, size: 1 });
      if (data?.status === 401 || data?.code === 401) return false;
      return Boolean(data?.data);
    } catch {
      return false;
    }
  }

  async listFiles(parentId, { page = 1, size = 200 } = {}) {
    const url = urlWithParams(`${QuarkClient.BASE_URL}/file/sort`, {
      pdir_fid: parentId,
      _page: page,
      _size: size,
      _sort: "file_name:asc",
      pr: "ucpro",
      fr: "pc"
    });
    return requestJson(url, {
      headers: this.headers,
      dispatcher: this.dispatcher,
      timeoutMs: this.timeoutMs
    });
  }

  async listAllRecursive(parentId, parentPath = "/") {
    const results = [];
    const queue = [{ fid: parentId, path: parentPath }];

    while (queue.length) {
      const current = queue.shift();
      let page = 1;

      while (true) {
        const data = await this.listFiles(current.fid, { page, size: 200 });
        const fileList = data?.data?.list || [];
        if (!fileList.length) break;

        for (const item of fileList) {
          const isDir = Boolean(item.dir) || item.file_type === 0;
          const name = item.file_name;
          if (!item.fid || !name) continue;

          if (isDir) {
            queue.push({ fid: item.fid, path: `${current.path.replace(/\/$/, "")}/${name}/` });
          } else {
            results.push({
              fid: item.fid,
              file_name: name,
              path: current.path,
              size: Number(item.size || 0)
            });
          }
        }

        if (fileList.length < 200) break;
        page += 1;
      }
    }

    return results;
  }

  async getFileInfo(fids) {
    if (!Array.isArray(fids) || !fids.length) return [];
    const url = urlWithParams(`${QuarkClient.BASE_URL}/file/download`, {
      pr: "ucpro",
      fr: "pc",
      uc_param_str: ""
    });
    const data = await requestJson(url, {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fids }),
      dispatcher: this.dispatcher,
      timeoutMs: this.timeoutMs
    });

    if (data?.code === 401 || data?.status === 401) {
      throw new AuthError("Quark cookie is invalid or expired.");
    }
    if (data?.code !== 0) return [];
    return (data?.data || []).filter((item) => !item.dir);
  }

  async getSliceMd5(url, size) {
    const buffer = await this.downloadRange(url, 0, Math.max(0, size - 1));
    if (!buffer) return null;
    return crypto.createHash("md5").update(buffer).digest("hex");
  }

  async downloadChunkB64(url, offset, length) {
    const buffer = await this.downloadRange(url, offset, offset + length - 1);
    if (!buffer) return null;
    return buffer.toString("base64");
  }

  async downloadRange(url, start, end) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          ...this.headers,
          Range: `bytes=${start}-${end}`
        },
        dispatcher: this.dispatcher,
        signal: controller.signal
      });
      if (![200, 206].includes(response.status)) return null;
      return Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  }

  async downloadToFile(url, outputPath) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(this.timeoutMs, 120_000));
    try {
      const response = await fetch(url, {
        headers: this.headers,
        dispatcher: this.dispatcher,
        signal: controller.signal
      });
      if (![200, 206].includes(response.status)) {
        throw new Q2BError(`Quark download failed with HTTP ${response.status}.`);
      }
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(outputPath));
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
