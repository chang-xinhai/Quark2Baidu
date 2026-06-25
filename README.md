# Q2B - Quark2Baidu

> A careful cross-platform CLI for moving files from Quark Cloud Drive to Baidu Netdisk.

Q2B starts as a focused Quark -> Baidu transfer tool and is being shaped into a clean cloud-to-cloud migration project. It is designed for two audiences at once: non-developers who want a guided command, and developers who want a readable, testable codebase.

[Project page](https://chang-xinhai.github.io/Quark2Baidu/) · [Issues](https://github.com/chang-xinhai/Quark2Baidu/issues) · [License](./LICENSE)

## What It Does

- Transfers selected files from Quark Cloud Drive to Baidu Netdisk.
- Uses Baidu rapid upload first when the server-side cache can match the file.
- Falls back to normal multipart upload when rapid upload misses, unless disabled.
- Preserves folder structure when selecting folders recursively.
- Stores cookies locally in the operating system user config directory.
- Runs on Windows, macOS, and Linux with Node.js and npm.

## Install

Until this package is published to the npm registry, install directly from GitHub:

```bash
npm install -g github:chang-xinhai/Quark2Baidu
```

After registry publication, the command will be:

```bash
npm install -g quark2baidu
```

You can also run from source:

```bash
git clone https://github.com/chang-xinhai/Quark2Baidu.git
cd Quark2Baidu
npm install
npm link
q2b doctor
```

## Quick Start

1. Save cookies and defaults:

   ```bash
   q2b setup
   ```

2. Verify the local environment and current login state:

   ```bash
   q2b doctor --online
   ```

3. Start the interactive transfer flow:

   ```bash
   q2b
   ```

The CLI will open a Quark file picker, let you select files or folders, then transfer to your configured Baidu target folder.

## Getting Cookies

Q2B talks directly to Quark and Baidu from your machine, so it needs your browser cookies.

Recommended browser extension flow:

1. Install Cookie-Editor for Chrome or Edge.
2. Log in to [Quark Cloud Drive](https://pan.quark.cn) and [Baidu Netdisk](https://pan.baidu.com).
3. Open Cookie-Editor on each site.
4. Export as `Header String`.
5. Paste the full string into `q2b setup`.

Developer tools flow:

1. Log in to the target website.
2. Open DevTools, then the Network panel.
3. Refresh the page.
4. Select a list/sort request.
5. Copy the full `Cookie` request header value.

## Commands

```bash
q2b                     # choose files and start transfer
q2b transfer            # same as q2b
q2b setup               # save cookies and defaults
q2b doctor              # inspect local config
q2b doctor --online     # validate Quark and Baidu login state
q2b config path         # print active config file path
q2b config show         # print redacted config
```

Useful flags:

```bash
q2b --target /Q2B/Archive/
q2b --concurrency 5
q2b --no-fallback-upload
q2b --config ./local.config.json
```

## Configuration

Default config locations:

- macOS: `~/Library/Application Support/q2b/config.json`
- Windows: `%APPDATA%\q2b\config.json`
- Linux: `~/.config/q2b/config.json`

The config file is written with restrictive permissions where the operating system supports it.

Environment variable overrides:

```bash
Q2B_QUARK_COOKIE="..." Q2B_BAIDU_COOKIE="..." q2b doctor --online
Q2B_CONFIG=/path/to/config.json q2b
Q2B_DEBUG=1 q2b
```

Config shape:

```json
{
  "quarkCookie": "",
  "baiduCookie": "",
  "targetPath": "/Q2B/",
  "concurrency": 3,
  "chunkSize": 262144,
  "fallbackUpload": true,
  "verifySsl": true
}
```

## Safety Model

Q2B is local-first:

- It does not run a hosted backend.
- It does not collect telemetry.
- It does not send cookies anywhere except Quark and Baidu requests made by your local process.
- Diagnostic output redacts cookie values.
- Remote paths are normalized and checked before upload requests.
- Temporary fallback-upload files are deleted after each task.

Important limits:

- Cookies are sensitive credentials. Treat them like passwords.
- Baidu rapid upload depends on server-side file availability and can fail for normal reasons.
- Fallback upload may download the source file to local temporary storage before uploading it to Baidu.
- Platform APIs and web cookies can change without notice.

## Developer Workflow

```bash
npm install
npm run check
npm test
node ./bin/q2b.js --help
```

Project layout:

```text
bin/q2b.js              npm executable entry
src/cli.js              command routing
src/transfer.js         interactive picker and transfer orchestration
src/clients/quark.js    Quark API client
src/clients/baidu.js    Baidu API client
src/config.js           config loading, saving, redaction
src/paths.js            remote path validation helpers
docs/                   GitHub Pages product site
Q2B.py                  legacy Python implementation
```

## Legacy Python Entry

The original Python script is still kept for users who already rely on it:

```bash
pip install httpx prompt_toolkit tqdm
python Q2B.py
```

New development should target the npm CLI unless a change specifically concerns the legacy Python path.

## Roadmap

- Current: stable Quark -> Baidu CLI with recursive selection and fallback upload.
- Next: resumable transfer state, richer retry policy, and structured transfer reports.
- Later: provider adapter interfaces for more netdisks.
- Long term: migration between any two supported cloud drives.

## Disclaimer

This project is for personal data migration, learning, and interoperability experiments. Use it only with files and accounts you are allowed to operate. Follow Quark, Baidu, and local law/service terms. You are responsible for account, data, and copyright risk.

## License

MIT. See [LICENSE](./LICENSE).
