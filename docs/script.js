const commands = {
  npm: "npm install -g quark2baidu",
  npx: "npx quark2baidu",
  source: "git clone https://github.com/chang-xinhai/Quark2Baidu.git\ncd Quark2Baidu\nnpm install\nnpm link\nq2b doctor"
};

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const item of document.querySelectorAll(".tab")) item.classList.remove("active");
    tab.classList.add("active");
    document.getElementById("install-command").textContent = commands[tab.dataset.command];
  });
}

async function copyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    return true;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    const ok = await copyText(target.textContent);
    const previous = button.textContent;
    button.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => {
      button.textContent = previous;
    }, 1200);
  });
}
