import fs from "node:fs/promises";
import crypto from "node:crypto";
import { FormData } from "undici";
import { AuthError } from "../errors.js";
import { createDispatcher, formBody, normalizeCookieHeader, requestJson, requestText, urlWithParams } from "../http.js";
import { normalizeRemotePath, remoteJoin, remoteParent } from "../paths.js";

export const UA_BAIDU =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const FAKE_BLOCK_LIST_MD5 = [
  "5910a591dd8fc18c32a8f3df4fdc1761",
  "a5fc157d78e6ad1c7e114b056c92821e"
];

export const BAIDU_UPLOAD_BLOCK_SIZE = 4 * 1024 * 1024;

export class BaiduClient {
  static PRECREATE = "https://pan.baidu.com/api/precreate";
  static RAPID = "https://pan.baidu.com/api/rapidupload";
  static UPLOAD = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2";
  static CREATE = "https://pan.baidu.com/api/create";

  constructor({ cookie, targetRoot = "/Q2B/", verifySsl = true, timeoutMs = 30_000 }) {
    this.cookie = normalizeCookieHeader(cookie);
    this.targetRoot = normalizeRemotePath(targetRoot, { directory: true });
    this.timeoutMs = timeoutMs;
    this.dispatcher = createDispatcher(verifySsl);
    this.headers = {
      "User-Agent": UA_BAIDU,
      Referer: "https://pan.baidu.com/disk/main",
      Origin: "https://pan.baidu.com",
      Cookie: this.cookie
    };
    this.uk = null;
    this.bdstoken = null;
  }

  async close() {
    await this.dispatcher.close();
  }

  async initUserInfo() {
    const html = await requestText("https://pan.baidu.com/disk/main", {
      headers: this.headers,
      dispatcher: this.dispatcher,
      timeoutMs: this.timeoutMs
    });

    const uk = html.match(/"uk"\s*:\s*"?(\d+)"?/);
    const token = html.match(/"bdstoken"\s*:\s*"([^"]*)"/);

    if (!uk || !token) {
      throw new AuthError("Baidu cookie is invalid or bdstoken could not be found.");
    }

    this.uk = uk[1];
    this.bdstoken = token[1];
    return true;
  }

  commonParams(extra = {}) {
    return {
      bdstoken: this.bdstoken,
      app_id: "250528",
      channel: "chunlei",
      web: "1",
      clienttype: "0",
      ...extra
    };
  }

  resolvePath(relativePath, filename) {
    return remoteJoin(this.targetRoot, relativePath, filename);
  }

  async preCreate(relativePath, filename) {
    const fullPath = this.resolvePath(relativePath, filename);
    const data = {
      path: fullPath,
      autoinit: "1",
      block_list: JSON.stringify(FAKE_BLOCK_LIST_MD5),
      target_path: remoteParent(fullPath)
    };

    const json = await requestJson(urlWithParams(BaiduClient.PRECREATE, this.commonParams()), {
      method: "POST",
      headers: this.headers,
      body: formBody(data),
      dispatcher: this.dispatcher,
      timeoutMs: this.timeoutMs
    });

    if (json?.errno === 0 && json?.uploadid) return json.uploadid;
    return null;
  }

  async rapidUpload(uploadId, fileInfo, sliceMd5, chunkB64, offset, ts, relativePath) {
    const fullPath = this.resolvePath(relativePath, fileInfo.file_name);
    const data = {
      uploadid: uploadId,
      path: fullPath,
      "content-length": String(fileInfo.size),
      "content-md5": BaiduClient.encMd5Simulator(fileInfo.md5),
      "slice-md5": BaiduClient.encMd5Simulator(sliceMd5),
      target_path: remoteParent(fullPath),
      local_mtime: String(ts),
      data_time: String(ts),
      data_offset: String(offset),
      data_content: chunkB64
    };

    const json = await requestJson(urlWithParams(BaiduClient.RAPID, this.commonParams({ rtype: "1" })), {
      method: "POST",
      headers: this.headers,
      body: formBody(data),
      dispatcher: this.dispatcher,
      timeoutMs: this.timeoutMs
    });

    if (json?.errno === 0) return { ok: true, message: "rapid upload success" };
    return { ok: false, message: `errno ${json?.errno ?? "unknown"}` };
  }

  async uploadFile(localPath, relativePath, filename) {
    const fullPath = this.resolvePath(relativePath, filename);
    const stat = await fs.stat(localPath);
    const size = stat.size;
    const blockMd5s = await BaiduClient.fileBlockMd5s(localPath);
    if (!blockMd5s.length) blockMd5s.push(crypto.createHash("md5").update("").digest("hex"));

    const preData = {
      path: fullPath,
      size: String(size),
      isdir: "0",
      autoinit: "1",
      rtype: "1",
      block_list: JSON.stringify(blockMd5s),
      target_path: remoteParent(fullPath)
    };
    const pre = await requestJson(urlWithParams(BaiduClient.PRECREATE, this.commonParams()), {
      method: "POST",
      headers: this.headers,
      body: formBody(preData),
      dispatcher: this.dispatcher,
      timeoutMs: this.timeoutMs
    });

    if (pre?.errno !== 0) return { ok: false, message: `precreate errno ${pre?.errno ?? "unknown"}` };
    if (pre?.return_type === 2) return { ok: true, message: "server-side dedupe success" };
    if (!pre?.uploadid) return { ok: false, message: "precreate did not return uploadid" };

    const neededBlocks = Array.isArray(pre.block_list) && pre.block_list.length
      ? new Set(pre.block_list.map((value) => Number(value)))
      : new Set(blockMd5s.map((_, index) => index));

    await this.uploadNeededBlocks(localPath, fullPath, filename, pre.uploadid, blockMd5s.length, neededBlocks);

    const createData = {
      path: fullPath,
      size: String(size),
      isdir: "0",
      rtype: "1",
      uploadid: pre.uploadid,
      block_list: JSON.stringify(blockMd5s),
      target_path: remoteParent(fullPath)
    };
    const created = await requestJson(urlWithParams(BaiduClient.CREATE, this.commonParams()), {
      method: "POST",
      headers: this.headers,
      body: formBody(createData),
      dispatcher: this.dispatcher,
      timeoutMs: this.timeoutMs
    });

    if (created?.errno === 0) return { ok: true, message: "fallback upload success" };
    return { ok: false, message: `create errno ${created?.errno ?? "unknown"}` };
  }

  async uploadNeededBlocks(localPath, fullPath, filename, uploadId, blockCount, neededBlocks) {
    const handle = await fs.open(localPath, "r");
    try {
      for (let index = 0; index < blockCount; index += 1) {
        const position = index * BAIDU_UPLOAD_BLOCK_SIZE;
        const buffer = Buffer.alloc(BAIDU_UPLOAD_BLOCK_SIZE);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!neededBlocks.has(index)) continue;

        const form = new FormData();
        form.set("file", new Blob([buffer.subarray(0, bytesRead)], { type: "application/octet-stream" }), filename);
        const json = await requestJson(urlWithParams(BaiduClient.UPLOAD, {
          method: "upload",
          type: "tmpfile",
          app_id: "250528",
          path: fullPath,
          uploadid: uploadId,
          partseq: String(index)
        }), {
          method: "POST",
          headers: this.headers,
          body: form,
          dispatcher: this.dispatcher,
          timeoutMs: Math.max(this.timeoutMs, 120_000)
        });

        if (json?.error_code || json?.errno) {
          throw new Error(`block ${index} upload failed: ${json.error_code || json.errno}`);
        }
      }
    } finally {
      await handle.close();
    }
  }

  static encMd5Simulator(md5) {
    const temp = md5.slice(8, 16) + md5.slice(0, 8) + md5.slice(24, 32) + md5.slice(16, 24);
    const transformed = [...temp].map((char, index) => {
      const digit = Number.parseInt(char, 16);
      return (digit ^ (15 & index)).toString(16);
    });
    if (transformed.length > 9) {
      transformed[9] = String.fromCharCode(Number.parseInt(transformed[9], 16) + "g".charCodeAt(0));
    }
    return transformed.join("");
  }

  static calculateOffset(uk, md5, ts, size, chunkSize) {
    const encMd5 = BaiduClient.encMd5Simulator(md5);
    const hex = crypto.createHash("md5").update(`${uk}${encMd5}${ts}`).digest("hex").slice(0, 8);
    const maxOffset = Number(size) - Number(chunkSize);
    if (maxOffset < 0) return 0;
    return Number.parseInt(hex, 16) % (maxOffset + 1);
  }

  static async fileBlockMd5s(localPath, blockSize = BAIDU_UPLOAD_BLOCK_SIZE) {
    const result = [];
    const handle = await fs.open(localPath, "r");
    try {
      let position = 0;
      while (true) {
        const buffer = Buffer.alloc(blockSize);
        const { bytesRead } = await handle.read(buffer, 0, blockSize, position);
        if (!bytesRead) break;
        result.push(crypto.createHash("md5").update(buffer.subarray(0, bytesRead)).digest("hex"));
        position += bytesRead;
      }
    } finally {
      await handle.close();
    }
    return result;
  }
}
