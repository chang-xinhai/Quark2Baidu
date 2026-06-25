import process from "node:process";
import { Command, Option } from "commander";
import { BaiduClient } from "./clients/baidu.js";
import { QuarkClient } from "./clients/quark.js";
import { loadConfig, publicConfig, resolveConfigPath, saveConfig, withEnvOverrides } from "./config.js";
import { transfer } from "./transfer.js";
import { printConfig, runSetupWizard, ui } from "./ui.js";

async function setupCommand(configPath) {
  ui.banner();
  const current = await loadConfig(configPath);
  const next = await runSetupWizard(current);
  const saved = await saveConfig(configPath, next);
  ui.success(`Configuration saved to ${configPath}`);
  printConfig(saved, configPath);
}

async function doctorCommand(configPath, options = {}) {
  ui.banner();
  const config = withEnvOverrides(await loadConfig(configPath));
  console.log(`Node: ${process.version}`);
  console.log(`Config: ${configPath}`);
  console.log(`Quark cookie: ${config.quarkCookie ? "configured" : "missing"}`);
  console.log(`Baidu cookie: ${config.baiduCookie ? "configured" : "missing"}`);
  console.log(`Target: ${config.targetPath}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Fallback upload: ${config.fallbackUpload ? "enabled" : "disabled"}`);

  if (!options.online) return;

  if (!config.quarkCookie || !config.baiduCookie) {
    ui.warning("Skipping online checks because cookies are missing.");
    return;
  }

  const quark = new QuarkClient({ cookie: config.quarkCookie, verifySsl: config.verifySsl });
  const baidu = new BaiduClient({ cookie: config.baiduCookie, targetRoot: config.targetPath, verifySsl: config.verifySsl });
  try {
    const quarkOk = await quark.checkAlive();
    console.log(`Quark login: ${quarkOk ? "ok" : "failed"}`);
    await baidu.initUserInfo();
    console.log(`Baidu login: ok (UK ${baidu.uk})`);
  } finally {
    await Promise.allSettled([quark.close(), baidu.close()]);
  }
}

export async function run(argv = process.argv) {
  const program = new Command();
  program
    .name("q2b")
    .description("Quark Cloud Drive -> Baidu Netdisk transfer CLI")
    .version("2.0.0")
    .option("--config <path>", "use a custom config file")
    .option("-y, --yes", "skip confirmation prompts")
    .option("-t, --target <path>", "Baidu target folder")
    .option("-c, --concurrency <count>", "concurrent transfers", (value) => Number.parseInt(value, 10))
    .addOption(new Option("--fallback-upload", "enable normal upload fallback when rapid transfer misses").default(undefined))
    .addOption(new Option("--no-fallback-upload", "disable normal upload fallback when rapid transfer misses").default(undefined))
    .option("--insecure", "disable HTTPS certificate verification")
    .action(async (options) => {
      const configPath = resolveConfigPath(options.config);
      await transfer(configPath, {
        yes: options.yes,
        target: options.target,
        concurrency: options.concurrency,
        fallbackUpload: options.fallbackUpload,
        verifySsl: options.insecure ? false : undefined
      });
    });

  program
    .command("transfer")
    .description("choose files and start a transfer")
    .option("-y, --yes", "skip confirmation prompts")
    .option("-t, --target <path>", "Baidu target folder")
    .option("-c, --concurrency <count>", "concurrent transfers", (value) => Number.parseInt(value, 10))
    .addOption(new Option("--fallback-upload", "enable normal upload fallback when rapid transfer misses").default(undefined))
    .addOption(new Option("--no-fallback-upload", "disable normal upload fallback when rapid transfer misses").default(undefined))
    .option("--insecure", "disable HTTPS certificate verification")
    .action(async (options, command) => {
      const globalOptions = command.parent.opts();
      const configPath = resolveConfigPath(globalOptions.config);
      await transfer(configPath, {
        yes: options.yes || globalOptions.yes,
        target: options.target || globalOptions.target,
        concurrency: options.concurrency || globalOptions.concurrency,
        fallbackUpload: options.fallbackUpload !== undefined ? options.fallbackUpload : globalOptions.fallbackUpload,
        verifySsl: options.insecure || globalOptions.insecure ? false : undefined
      });
    });

  program
    .command("setup")
    .description("save cookies and default transfer settings")
    .action(async (_options, command) => {
      const configPath = resolveConfigPath(command.parent.opts().config);
      await setupCommand(configPath);
    });

  program
    .command("doctor")
    .description("check local setup; add --online to validate cookies")
    .option("--online", "also validate Quark and Baidu logins")
    .action(async (options, command) => {
      const configPath = resolveConfigPath(command.parent.opts().config);
      await doctorCommand(configPath, options);
    });

  const config = program.command("config").description("inspect q2b configuration");
  config
    .command("path")
    .description("print the active config path")
    .action((_options, command) => {
      console.log(resolveConfigPath(command.parent.parent.opts().config));
    });
  config
    .command("show")
    .description("print redacted configuration")
    .action(async (_options, command) => {
      const configPath = resolveConfigPath(command.parent.parent.opts().config);
      const loaded = withEnvOverrides(await loadConfig(configPath));
      console.log(JSON.stringify({ path: configPath, ...publicConfig(loaded) }, null, 2));
    });

  await program.parseAsync(argv);
}
