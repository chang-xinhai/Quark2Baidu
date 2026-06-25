const commands = {
  npm: "npm install -g quark2baidu",
  npx: "npx quark2baidu",
  source: "git clone https://github.com/chang-xinhai/Quark2Baidu.git\ncd Quark2Baidu\nnpm install\nnpm link\nq2b doctor"
};

const copy = {
  en: {
    pageTitle: "Q2B - A calm Quark to Baidu CLI",
    pageDescription: "Q2B is a careful cross-platform npm CLI for moving files from Quark Cloud Drive to Baidu Netdisk.",
    brandTagline: "Quark2Baidu CLI",
    navFeatures: "Features",
    navInstall: "Install",
    navSafety: "Safety",
    navRoadmap: "Roadmap",
    heroTitle: "Move cloud files with one calm command",
    heroBody: "Q2B turns Quark-to-Baidu migration into a small, careful terminal workflow: npm install, local credentials, clear checks, and no extra backend.",
    heroPrimary: "Install from npm",
    heroSecondary: "Open GitHub",
    windowTitle: "q2b transfer session",
    visualFrom: "Quark Cloud",
    visualFromMeta: "source folders",
    visualTo: "Baidu Netdisk",
    visualToMeta: "target path",
    statusRapid: "Rapid upload check",
    statusFolders: "Folder structure",
    statusPreserved: "preserved",
    featuresTitle: "Designed for real migration days",
    featuresBody: "The interface stays tiny, while the transfer path handles the fussy parts: path safety, fallback behavior, login checks, and clear recovery.",
    featureRapidTitle: "Rapid upload first",
    featureRapidBody: "Q2B tries Baidu rapid upload before falling back to standard upload when the server-side cache misses.",
    featureFoldersTitle: "Keeps folders intact",
    featureFoldersBody: "Recursive selection preserves the source layout under the Baidu target path you choose.",
    featureSafetyTitle: "Safer by default",
    featureSafetyBody: "Diagnostics redact cookies, paths are normalized before requests, and failures are summarized for retries.",
    featureLocalTitle: "Local credential model",
    featureLocalBody: "Cookies stay in your user config directory or environment, and Q2B does not use a proxy service.",
    installTitle: "Install once, then run q2b anywhere",
    installBodyPrefix: "Install from npm, configure once, then use",
    installBodySuffix: "on Windows, macOS, or Linux with the same workflow.",
    installCommandLabel: "Recommended",
    installCommandTitle: "Global npm install",
    installMetaNpm: "npm package",
    installMetaNode: "Node 18+",
    installMetaLocal: "local config",
    installFlowLabel: "After install",
    installFlowTitle: "A three-step run path",
    tabSource: "source",
    copy: "Copy",
    copied: "Copied",
    selected: "Selected",
    copyFailed: "Copy failed",
    stepOneBefore: "Run",
    stepOneAfter: "and paste Quark/Baidu cookies.",
    stepTwoBefore: "Run",
    stepTwoAfter: "to verify login state.",
    stepThreeBefore: "Run",
    stepThreeAfter: ", choose files, and start the transfer.",
    cliTitle: "A small command surface",
    cliBody: "Enough structure for everyday use, without asking non-developers to learn a new toolchain.",
    refSetup: "Save cookies and defaults to a user-level config file.",
    refRun: "Open the interactive Quark file picker and transfer selected files.",
    refDoctor: "Check Node, config, and current Quark/Baidu login status.",
    refConfig: "Print redacted config for support and debugging.",
    safetyTitle: "Safety and privacy commitments",
    safetyOne: "Config is stored in the operating system user config directory, not inside the repo.",
    safetyTwo: "Cookie values are redacted in diagnostic output and can also be provided through environment variables.",
    safetyThree: "Remote paths are normalized and checked before requests are sent.",
    safetyFour: "No telemetry, proxy service, or third-party backend is used by Q2B.",
    roadmapTitle: "From one route to a migration engine",
    roadmapBody: "Q2B starts with Quark to Baidu, then grows toward provider adapters and two-way cloud migration workflows.",
    roadmapNowLabel: "Now",
    roadmapNowTitle: "Quark to Baidu",
    roadmapNowBody: "Cross-platform npm CLI, rapid transfer, fallback upload, and recursive selection.",
    roadmapNextLabel: "Next",
    roadmapNextTitle: "Reliability layer",
    roadmapNextBody: "Resume state, transfer reports, rate-limit handling, and richer retry policy.",
    roadmapLaterLabel: "Later",
    roadmapLaterTitle: "Provider adapters",
    roadmapLaterBody: "A provider interface for more netdisks and two-way migration workflows.",
    footerName: "Q2B (Quark2Baidu) - Open Source CLI"
  },
  zh: {
    pageTitle: "Q2B - 安静可靠的夸克到百度网盘 CLI",
    pageDescription: "Q2B 是一个严谨的跨平台 npm 命令行工具，用于将夸克网盘文件迁移到百度网盘。",
    brandTagline: "夸克到百度 CLI",
    navFeatures: "能力",
    navInstall: "安装",
    navSafety: "安全",
    navRoadmap: "路线图",
    heroTitle: "用一条安静的命令迁移网盘文件",
    heroBody: "Q2B 把夸克到百度网盘的迁移收进一个小而严谨的终端流程：npm 安装、本地凭据、清晰检查、没有额外后端。",
    heroPrimary: "从 npm 安装",
    heroSecondary: "打开 GitHub",
    windowTitle: "q2b 迁移会话",
    visualFrom: "夸克网盘",
    visualFromMeta: "源文件夹",
    visualTo: "百度网盘",
    visualToMeta: "目标路径",
    statusRapid: "秒传检测",
    statusFolders: "目录结构",
    statusPreserved: "已保留",
    featuresTitle: "为真实迁移场景设计",
    featuresBody: "界面保持很小，但迁移路径会处理麻烦的部分：路径安全、失败回退、登录检查和可恢复提示。",
    featureRapidTitle: "优先尝试秒传",
    featureRapidBody: "Q2B 会先尝试百度秒传；当服务端缓存未命中时，再回退到普通上传。",
    featureFoldersTitle: "保留目录结构",
    featureFoldersBody: "递归选择会把源目录布局保留到你选择的百度网盘目标路径下。",
    featureSafetyTitle: "默认更安全",
    featureSafetyBody: "诊断输出会隐藏 Cookie，远程路径会在请求前规范化，失败也会给出清晰总结。",
    featureLocalTitle: "本地凭据模型",
    featureLocalBody: "Cookie 保存在用户配置目录或环境变量中，Q2B 不使用代理服务。",
    installTitle: "安装一次，到处运行 q2b",
    installBodyPrefix: "从 npm 安装并配置一次，然后使用",
    installBodySuffix: "在 Windows、macOS、Linux 上保持同一套工作流。",
    installCommandLabel: "推荐",
    installCommandTitle: "全局 npm 安装",
    installMetaNpm: "npm 包",
    installMetaNode: "Node 18+",
    installMetaLocal: "本地配置",
    installFlowLabel: "安装之后",
    installFlowTitle: "三步开始迁移",
    tabSource: "源码",
    copy: "复制",
    copied: "已复制",
    selected: "已选中",
    copyFailed: "复制失败",
    stepOneBefore: "运行",
    stepOneAfter: "并粘贴夸克/百度 Cookie。",
    stepTwoBefore: "运行",
    stepTwoAfter: "确认登录状态。",
    stepThreeBefore: "运行",
    stepThreeAfter: "，选择文件并开始迁移。",
    cliTitle: "很小的命令表面",
    cliBody: "日常使用所需的结构都在，但不要求非开发者学习一套新工具链。",
    refSetup: "把 Cookie 和默认配置保存到用户级配置文件。",
    refRun: "打开交互式夸克文件选择器，并迁移选中的文件。",
    refDoctor: "检查 Node、配置，以及当前夸克/百度登录状态。",
    refConfig: "输出已脱敏的配置，方便支持和排查。",
    safetyTitle: "安全与隐私承诺",
    safetyOne: "配置保存在操作系统用户配置目录，不会写进仓库。",
    safetyTwo: "诊断输出会脱敏 Cookie，也可以通过环境变量提供凭据。",
    safetyThree: "远程路径会在发送请求前规范化和检查。",
    safetyFour: "Q2B 不使用遥测、代理服务或第三方后端。",
    roadmapTitle: "从一条路径走向迁移引擎",
    roadmapBody: "Q2B 从夸克到百度开始，再逐步扩展到 provider adapter 和双向网盘迁移流程。",
    roadmapNowLabel: "现在",
    roadmapNowTitle: "夸克到百度",
    roadmapNowBody: "跨平台 npm CLI、秒传、回退上传和递归选择。",
    roadmapNextLabel: "下一步",
    roadmapNextTitle: "可靠性层",
    roadmapNextBody: "断点状态、迁移报告、限流处理和更完整的重试策略。",
    roadmapLaterLabel: "之后",
    roadmapLaterTitle: "Provider adapters",
    roadmapLaterBody: "为更多网盘和双向迁移流程准备 provider 接口。",
    footerName: "Q2B (Quark2Baidu) - 开源命令行工具"
  }
};

let currentLanguage = "en";

function storedLanguage() {
  try {
    return window.localStorage.getItem("q2b-language");
  } catch {
    return null;
  }
}

function saveLanguage(language) {
  try {
    window.localStorage.setItem("q2b-language", language);
  } catch {
    // Local storage can be unavailable in hardened browser modes.
  }
}

function browserLanguage() {
  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function setLanguage(language) {
  currentLanguage = copy[language] ? language : "en";
  const dictionary = copy[currentLanguage];

  document.documentElement.lang = currentLanguage === "zh" ? "zh-Hans" : "en";
  document.title = dictionary.pageTitle;
  const description = document.querySelector('meta[name="description"]');
  const ogTitle = document.querySelector('meta[property="og:title"]');
  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (description) description.setAttribute("content", dictionary.pageDescription);
  if (ogTitle) ogTitle.setAttribute("content", dictionary.pageTitle);
  if (ogDescription) ogDescription.setAttribute("content", dictionary.pageDescription);

  for (const node of document.querySelectorAll("[data-i18n]")) {
    const value = dictionary[node.dataset.i18n];
    if (typeof value === "string") node.textContent = value;
  }

  for (const option of document.querySelectorAll("[data-lang]")) {
    const isActive = option.dataset.lang === currentLanguage;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-pressed", String(isActive));
  }

  saveLanguage(currentLanguage);
}

for (const option of document.querySelectorAll("[data-lang]")) {
  option.addEventListener("click", () => setLanguage(option.dataset.lang));
}

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const item of document.querySelectorAll(".tab")) {
      item.classList.remove("active");
      item.setAttribute("aria-selected", "false");
    }
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    document.getElementById("install-command").textContent = commands[tab.dataset.command];
  });
}

async function copyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    if (document.execCommand("copy")) return true;
  } catch {
    // The async Clipboard API below may still be available.
  } finally {
    textarea.remove();
  }

  if (!window.navigator.clipboard || !window.isSecureContext) return false;

  try {
    const permission = await window.navigator.permissions?.query({ name: "clipboard-write" });
    if (permission?.state === "denied") return false;
  } catch {
    // Some browsers do not expose clipboard-write permission queries.
  }

  try {
    await window.navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function selectElementText(element) {
  const selection = window.getSelection?.();
  if (!selection || !document.createRange) return false;

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.toString().length > 0;
}

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    const ok = await copyText(target.textContent);
    const dictionary = copy[currentLanguage];
    const selected = ok ? false : selectElementText(target);
    const label = button.querySelector("[data-copy-label]") || button;
    label.textContent = ok ? dictionary.copied : selected ? dictionary.selected : dictionary.copyFailed;
    setTimeout(() => {
      label.textContent = copy[currentLanguage].copy;
    }, 1200);
  });
}

setLanguage(storedLanguage() || browserLanguage());
