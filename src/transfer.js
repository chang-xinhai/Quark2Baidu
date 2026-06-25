import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cliProgress from "cli-progress";
import { confirm, select } from "@inquirer/prompts";
import { BaiduClient } from "./clients/baidu.js";
import { QuarkClient } from "./clients/quark.js";
import { DEFAULT_CHUNK_SIZE, loadConfig, normalizeConfig, saveConfig, withEnvOverrides } from "./config.js";
import { AuthError, Q2BError } from "./errors.js";
import { formatBytes } from "./paths.js";
import { chooseDirectoryAction, runSetupWizard, ui } from "./ui.js";

function itemName(item, selectedFiles, selectedDirs, recursiveDirs) {
  const marker = item.isDir
    ? recursiveDirs.has(item.fid)
      ? "[R]"
      : selectedDirs.has(item.fid)
        ? "[D]"
        : "[ ]"
    : selectedFiles.has(item.fid)
      ? "[x]"
      : "[ ]";
  const icon = item.isDir ? "dir " : "file";
  const size = item.isDir ? "" : ` ${formatBytes(item.size || 0)}`;
  return `${marker} ${icon} ${item.name}${size}`;
}

async function fetchDirectoryItems(quark, parentId) {
  const all = [];
  let page = 1;
  while (true) {
    const data = await quark.listFiles(parentId, { page, size: 200 });
    const list = data?.data?.list || [];
    if (!list.length) break;
    for (const raw of list) {
      all.push({
        fid: raw.fid,
        name: raw.file_name,
        isDir: Boolean(raw.dir) || raw.file_type === 0,
        size: Number(raw.size || 0)
      });
    }
    if (list.length < 200) break;
    page += 1;
  }
  return all.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, "zh-Hans-CN"));
}

export async function browseAndSelect(quark) {
  let currentFid = "0";
  let currentPath = "/";
  const stack = [];
  const selectedFiles = new Map();
  const selectedDirs = new Map();
  const recursiveDirs = new Map();

  while (true) {
    const items = await fetchDirectoryItems(quark, currentFid);
    const selectedCount = selectedFiles.size + selectedDirs.size;
    const choice = await select({
      message: `${currentPath}  selected: ${selectedFiles.size} files, ${selectedDirs.size} folders`,
      pageSize: 18,
      choices: [
        { name: selectedCount ? `Start transfer (${selectedCount} selected)` : "Start transfer", value: { type: "done" } },
        ...(stack.length ? [{ name: ".. Back", value: { type: "back" } }] : []),
        ...items.map((item) => ({
          name: itemName(item, selectedFiles, selectedDirs, recursiveDirs),
          value: { type: item.isDir ? "dir" : "file", item }
        }))
      ]
    });

    if (choice.type === "done") {
      return { selectedFiles, selectedDirs };
    }

    if (choice.type === "back") {
      const previous = stack.pop();
      currentFid = previous.fid;
      currentPath = previous.path;
      continue;
    }

    if (choice.type === "file") {
      const relativePath = currentPath;
      if (selectedFiles.has(choice.item.fid)) {
        selectedFiles.delete(choice.item.fid);
      } else {
        selectedFiles.set(choice.item.fid, { path: relativePath, name: choice.item.name });
      }
      continue;
    }

    if (choice.type === "dir") {
      const directoryPath = `${currentPath.replace(/\/$/, "")}/${choice.item.name}/`;
      const action = await chooseDirectoryAction(
        choice.item,
        recursiveDirs.has(choice.item.fid),
        selectedDirs.has(choice.item.fid)
      );

      if (action === "open") {
        stack.push({ fid: currentFid, path: currentPath });
        currentFid = choice.item.fid;
        currentPath = directoryPath;
      } else if (action === "toggle-dir") {
        if (selectedDirs.has(choice.item.fid)) {
          selectedDirs.delete(choice.item.fid);
        } else {
          selectedDirs.set(choice.item.fid, { path: directoryPath, name: choice.item.name });
        }
      } else if (action === "recursive") {
        if (recursiveDirs.has(choice.item.fid)) {
          for (const fid of recursiveDirs.get(choice.item.fid)) {
            selectedFiles.delete(fid);
          }
          recursiveDirs.delete(choice.item.fid);
        } else {
          ui.info(`Scanning ${choice.item.name} recursively...`);
          const files = await quark.listAllRecursive(choice.item.fid, directoryPath);
          const added = new Set();
          for (const file of files) {
            selectedFiles.set(file.fid, { path: file.path, name: file.file_name });
            added.add(file.fid);
          }
          recursiveDirs.set(choice.item.fid, added);
          ui.success(`Selected ${added.size} files from ${choice.item.name}.`);
        }
      }
    }
  }
}

async function expandSelectedDirs(quark, selectedFiles, selectedDirs) {
  for (const [fid, meta] of selectedDirs) {
    const files = await quark.listAllRecursive(fid, meta.path);
    for (const file of files) {
      if (!selectedFiles.has(file.fid)) {
        selectedFiles.set(file.fid, { path: file.path, name: file.file_name });
      }
    }
  }
  return selectedFiles;
}

async function getTaskInfo(quark, selectedFiles) {
  const fids = [...selectedFiles.keys()];
  const tasks = [];
  const batchSize = 100;
  for (let index = 0; index < fids.length; index += batchSize) {
    const batch = fids.slice(index, index + batchSize);
    const infos = await quark.getFileInfo(batch);
    for (const item of infos) {
      const selected = selectedFiles.get(item.fid);
      tasks.push({ ...item, path: selected?.path || "/" });
    }
  }
  return tasks;
}

async function runPool(items, concurrency, worker, onResult) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      const result = await worker(item);
      onResult(result);
    }
  });
  await Promise.all(workers);
}

async function processSingleTask(fileInfo, config, baiduSession) {
  const result = { name: fileInfo.file_name, status: "fail", message: "" };
  const quark = new QuarkClient({ cookie: config.quarkCookie, verifySsl: config.verifySsl });
  const baidu = new BaiduClient({
    cookie: config.baiduCookie,
    targetRoot: config.targetPath,
    verifySsl: config.verifySsl
  });
  baidu.uk = baiduSession.uk;
  baidu.bdstoken = baiduSession.bdstoken;

  try {
    const freshInfos = await quark.getFileInfo([fileInfo.fid]);
    if (!freshInfos.length) {
      result.message = "could not refresh signed download URL";
      return result;
    }

    const fresh = { ...freshInfos[0], path: fileInfo.path };
    result.name = fresh.file_name;
    if (!fresh.download_url || !fresh.md5) {
      result.message = "file detail is missing download_url or md5";
      return result;
    }

    const sliceMd5 = await quark.getSliceMd5(fresh.download_url, config.chunkSize);
    if (!sliceMd5) {
      result.message = "could not read verification slice";
      return result;
    }

    const ts = Math.floor(Date.now() / 1000);
    const offset = BaiduClient.calculateOffset(baidu.uk, fresh.md5, ts, fresh.size, config.chunkSize);
    const chunkB64 = await quark.downloadChunkB64(fresh.download_url, offset, config.chunkSize);
    if (!chunkB64) {
      result.message = "could not read Baidu verification chunk";
      return result;
    }

    const uploadId = await baidu.preCreate(fresh.path, fresh.file_name);
    if (uploadId) {
      const rapid = await baidu.rapidUpload(uploadId, fresh, sliceMd5, chunkB64, offset, ts, fresh.path);
      if (rapid.ok) {
        result.status = "success";
        result.message = rapid.message;
        return result;
      }
      result.message = `rapid transfer missed: ${rapid.message}`;
    } else {
      result.message = "rapid precreate failed";
    }

    if (!config.fallbackUpload) return result;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "q2b-"));
    const safeSuffix = path.extname(fresh.file_name).replace(/[^a-zA-Z0-9.]/g, "") || ".tmp";
    const tempPath = path.join(tempDir, `${crypto.randomUUID()}${safeSuffix}`);
    try {
      const downloaded = await quark.downloadToFile(fresh.download_url, tempPath);
      if (!downloaded) {
        result.message += "; fallback download failed";
        return result;
      }
      const uploaded = await baidu.uploadFile(tempPath, fresh.path, fresh.file_name);
      if (uploaded.ok) {
        result.status = "success";
        result.message = uploaded.message;
      } else {
        result.message += `; fallback upload failed: ${uploaded.message}`;
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    result.message = error?.message ? error.message.slice(0, 160) : String(error);
  } finally {
    await Promise.allSettled([quark.close(), baidu.close()]);
  }

  return result;
}

async function ensureConfigured(configPath, config, { interactive = true } = {}) {
  if (config.quarkCookie && config.baiduCookie) return config;
  if (!interactive) throw new Q2BError("Cookies are not configured. Run q2b setup first.");
  ui.warning("Cookie configuration is missing.");
  const configured = await runSetupWizard(config);
  return saveConfig(configPath, configured);
}

export async function transfer(configPath, options = {}) {
  ui.banner();
  let config = withEnvOverrides(await loadConfig(configPath));
  config = normalizeConfig({
    ...config,
    targetPath: options.target || config.targetPath,
    concurrency: options.concurrency || config.concurrency,
    fallbackUpload: options.fallbackUpload ?? config.fallbackUpload,
    verifySsl: options.verifySsl ?? config.verifySsl
  });
  config = await ensureConfigured(configPath, config);

  ui.info("Checking Quark login...");
  let quark = new QuarkClient({ cookie: config.quarkCookie, verifySsl: config.verifySsl });
  if (!(await quark.checkAlive())) {
    await quark.close();
    throw new AuthError("Quark cookie is invalid or expired. Run q2b setup.");
  }

  ui.info("Checking Baidu login...");
  const baidu = new BaiduClient({ cookie: config.baiduCookie, targetRoot: config.targetPath, verifySsl: config.verifySsl });
  await baidu.initUserInfo();
  const baiduSession = { uk: baidu.uk, bdstoken: baidu.bdstoken };
  await baidu.close();
  ui.success(`Baidu login ready (UK ${baiduSession.uk}).`);

  ui.info("Choose files from Quark Cloud Drive.");
  const { selectedFiles, selectedDirs } = await browseAndSelect(quark);
  await expandSelectedDirs(quark, selectedFiles, selectedDirs);

  if (!selectedFiles.size) {
    await quark.close();
    ui.warning("No files selected.");
    return { ok: true, results: [] };
  }

  ui.info(`Reading details for ${selectedFiles.size} files...`);
  let tasks = await getTaskInfo(quark, selectedFiles);
  await quark.close();

  if (!tasks.length) {
    throw new Q2BError("Could not read selected file details. The Quark cookie may be rate-limited or expired.");
  }

  const chunkSize = config.chunkSize || DEFAULT_CHUNK_SIZE;
  const skipped = [];
  tasks = tasks.filter((task) => {
    if (!config.fallbackUpload && Number(task.size) < chunkSize) {
      skipped.push(task);
      return false;
    }
    return true;
  });

  if (skipped.length) {
    ui.warning(`Skipped ${skipped.length} small files because fallback upload is disabled.`);
  }
  if (!tasks.length) {
    ui.warning("No transferable files remain.");
    return { ok: true, results: [] };
  }

  const totalSize = tasks.reduce((sum, task) => sum + Number(task.size || 0), 0);
  ui.info(`Ready: ${tasks.length} files, ${formatBytes(totalSize)}, target ${config.targetPath}`);

  if (!options.yes) {
    const shouldStart = await confirm({ message: "Start transfer?", default: true });
    if (!shouldStart) return { ok: true, results: [] };
  }

  const results = [];
  const bar = process.stdout.isTTY
    ? new cliProgress.SingleBar({
      format: "transfer [{bar}] {percentage}% | {value}/{total} | {status}",
      hideCursor: true
    }, cliProgress.Presets.shades_classic)
    : null;
  bar?.start(tasks.length, 0, { status: "starting" });

  await runPool(tasks, config.concurrency, (task) => processSingleTask(task, config, baiduSession), (result) => {
    results.push(result);
    bar?.increment(1, { status: result.status });
    if (!bar) {
      const prefix = result.status === "success" ? "OK" : "FAIL";
      console.log(`${prefix} ${result.name} ${result.message ? `- ${result.message}` : ""}`);
    }
  });
  bar?.stop();

  const success = results.filter((item) => item.status === "success").length;
  const failed = results.length - success;
  ui.info(`Finished: ${success} succeeded, ${failed} failed.`);
  if (failed) {
    for (const item of results.filter((entry) => entry.status !== "success")) {
      console.log(`- ${item.name}: ${item.message}`);
    }
  }
  return { ok: failed === 0, results };
}
