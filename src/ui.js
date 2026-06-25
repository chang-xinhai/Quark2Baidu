import { confirm, input, password, select } from "@inquirer/prompts";
import { DEFAULT_CONCURRENCY, publicConfig } from "./config.js";

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const color = {
  blue: useColor ? "\u001b[34m" : "",
  green: useColor ? "\u001b[32m" : "",
  yellow: useColor ? "\u001b[33m" : "",
  red: useColor ? "\u001b[31m" : "",
  bold: useColor ? "\u001b[1m" : "",
  reset: useColor ? "\u001b[0m" : ""
};

export const ui = {
  banner() {
    console.log(`\n${color.bold}Q2B${color.reset}  Quark Cloud Drive -> Baidu Netdisk`);
    console.log("A careful cross-platform CLI for cloud file migration.\n");
  },
  info(message) {
    console.log(`${color.blue}info${color.reset} ${message}`);
  },
  success(message) {
    console.log(`${color.green}done${color.reset} ${message}`);
  },
  warning(message) {
    console.log(`${color.yellow}warn${color.reset} ${message}`);
  },
  error(message) {
    console.error(`${color.red}error${color.reset} ${message}`);
  }
};

export async function runSetupWizard(currentConfig) {
  const next = { ...currentConfig };
  const hasQuark = Boolean(next.quarkCookie);
  const hasBaidu = Boolean(next.baiduCookie);

  const quarkCookie = await password({
    message: `Quark Cookie${hasQuark ? " (press enter to keep current)" : ""}`,
    mask: "*"
  });
  if (quarkCookie.trim()) next.quarkCookie = quarkCookie.trim();

  const baiduCookie = await password({
    message: `Baidu Cookie${hasBaidu ? " (press enter to keep current)" : ""}`,
    mask: "*"
  });
  if (baiduCookie.trim()) next.baiduCookie = baiduCookie.trim();

  next.targetPath = await input({
    message: "Baidu target folder",
    default: next.targetPath || "/Q2B/"
  });

  const concurrency = await input({
    message: "Concurrent transfers",
    default: String(next.concurrency || DEFAULT_CONCURRENCY),
    validate(value) {
      const parsed = Number.parseInt(value, 10);
      return parsed >= 1 && parsed <= 20 ? true : "Use a number from 1 to 20.";
    }
  });
  next.concurrency = Number.parseInt(concurrency, 10);

  next.fallbackUpload = await confirm({
    message: "Fallback to normal upload when rapid transfer misses?",
    default: next.fallbackUpload !== false
  });

  next.verifySsl = await confirm({
    message: "Verify HTTPS certificates?",
    default: next.verifySsl !== false
  });

  return next;
}

export function printConfig(config, configPath) {
  console.log(JSON.stringify({
    path: configPath,
    ...publicConfig(config)
  }, null, 2));
}

export async function chooseDirectoryAction(item, isRecursive, isSelectedDir) {
  return select({
    message: item.name,
    choices: [
      { name: "Open folder", value: "open" },
      { name: isRecursive ? "Remove recursive selection" : "Select folder recursively", value: "recursive" },
      { name: isSelectedDir ? "Unselect folder" : "Select folder", value: "toggle-dir" },
      { name: "Back", value: "back" }
    ]
  });
}
