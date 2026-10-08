/** Codex 工作台检查入口。只使用 Node 标准库；不安装依赖或重生成 CSV。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = ["start", "setup-engine", "brainstorm", "design-system",
  "create-architecture", "dev-story", "smoke-check", "gate-check"];
const ROLES = ["game-designer", "systems-designer", "unity-specialist",
  "gameplay-programmer", "qa-tester", "producer"];

/** 检查实际入口、元数据与可移植引用，不依赖学习目录的完整克隆。 */
export function inspectInstallation(root = ROOT) {
  const errors = [];
  const required = ["AGENTS.md", ".agentlens/INDEX.md", "studio/README.md",
    "studio/project-context.md", "studio/UPSTREAM.md", "studio/LICENSE",
    "studio/templates/story.md", ...ROLES.map(n => `studio/roles/${n}.md`)];
  for (const rel of required) {
    if (!fs.existsSync(path.join(root, rel))) errors.push(`Missing: ${rel}`);
  }
  for (const name of SKILLS) {
    const file = path.join(root, ".agents", "skills", name, "SKILL.md");
    if (!fs.existsSync(file)) { errors.push(`Missing skill: ${name}`); continue; }
    const text = fs.readFileSync(file, "utf8");
    const meta = text.match(/^---\nname: ([a-z0-9-]+)\ndescription: ("[^\n]+")\n---\n/);
    if (!meta || meta[1] !== name) errors.push(`Invalid frontmatter: ${name}`);
    else {
      try {
        const description = JSON.parse(meta[2]);
        if (!description.trim() || description.length > 1024 || /[<>]/.test(description)) {
          errors.push(`Invalid description: ${name}`);
        }
      } catch { errors.push(`Invalid quoted description: ${name}`); }
    }
    const links = [...text.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)/g)];
    if (!links.length) errors.push(`No project references: ${name}`);
    for (const [, target] of links) {
      if (/^https?:/.test(target)) continue;
      const dest = path.resolve(path.dirname(file), target);
      if (!dest.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(dest)) {
        errors.push(`Broken or external reference: ${name} -> ${target}`);
      }
    }
  }
  return { status: errors.length ? "FAIL" : "PASS", errors,
    output: errors.length ? errors.join("\n") : "8 skills, 6 role references, project entrypoints and skill links verified." };
}

/** spawnSync 不经 shell，避免参数插值；失败和未执行不会被后续命令的成功掩盖。 */
export function runCheck(label, command, args, cwd = ROOT) {
  const start = Date.now();
  const result = spawnSync(command, args, {
    cwd, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  return { label, command: [command, ...args], status: result.error?.code === "ENOENT"
    ? "NOT RUN" : result.status === 0 && !result.error ? "PASS" : "FAIL",
  exitCode: result.status, durationMs: Date.now() - start,
  output: [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n") };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: node Tools/studio_check.mjs [--mode install|smoke|gate]\nReports: production/qa/ (unique filenames); smoke/gate rebuild web/dist only.");
    return 0;
  }
  if (args.length && !(args.length === 2 && args[0] === "--mode")) {
    console.error("Invalid arguments; use --help."); return 2;
  }
  const mode = args[1] ?? "smoke";
  if (!["install", "smoke", "gate"].includes(mode)) {
    console.error(`Unknown mode: ${mode}`); return 2;
  }
  const install = inspectInstallation();
  const checks = [{ label: "Studio installation", command: ["internal", "inspectInstallation"],
    ...install, exitCode: install.status === "PASS" ? 0 : 1 }];
  if (mode !== "install") {
    const python = process.env.STUDIO_PYTHON || "python3";
    const tests = fs.readdirSync(path.join(ROOT, "tests"))
      .filter(n => n.endsWith(".test.ts")).sort().map(n => `tests/${n}`);
    const commands = [
      ["Node tests", process.execPath, ["--test", ...tests]],
      ["Config development", python, ["Tools/check_config.py"]],
      ["Config validator regression", python, ["Tools/test_check_config.py"]],
      ["Document links", python, ["Tools/check_links.py"]],
      ["Web build", process.execPath, ["Tools/build_web.mjs"]],
      ["Browser bundle syntax", process.execPath, ["--check", "web/dist/app.bundle.js"]],
      ["Git diff whitespace", "git", ["diff", "--check"]],
    ];
    if (mode === "gate") commands.push(
      ["Existing CI motif check", python, ["Tools/motif_check.py"]],
      ["Config delivery", python, ["Tools/check_config.py", "--delivery"]],
    );
    for (const [label, command, argv] of commands) {
      if (label === "Browser bundle syntax" && checks.find(c => c.label === "Web build")?.status !== "PASS") {
        checks.push({ label, command: [command, ...argv], status: "NOT RUN", exitCode: null,
          output: "Skipped because the current build did not pass; do not validate a stale bundle." });
      } else {
        console.log(`Running: ${label}`);
        checks.push(runCheck(label, command, argv));
      }
    }
  }
  const success = checks.every(c => c.status === "PASS");
  const timestamp = new Date().toISOString();
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const gitState = spawnSync("git", ["status", "--short"], { cwd: ROOT, encoding: "utf8" });
  const bundle = path.join(ROOT, "web/dist/app.bundle.js");
  const bundleHash = mode !== "install" && checks.find(c => c.label === "Web build")?.status === "PASS"
    ? createHash("sha256").update(fs.readFileSync(bundle)).digest("hex") : "not built in this run";
  const lines = ["# Studio 自动检查报告", "", `- UTC 时间：${timestamp}`,
    `- 模式：${mode}`, `- 自动检查结论：${success ? "PASS" : "FAIL"}`,
    `- HEAD：${revision.status === 0 ? revision.stdout.trim() : "unavailable"}（具体工作树差异见末尾）`,
    `- Node：${process.version}`, `- 本次构建包 SHA-256：${bundleHash}`, "",
    "浏览器交互／游戏内实测：NOT RUN（本脚本不执行）。发布就绪：NOT ASSESSED。",
    "命令 PASS 只代表退出码为零；配置警告、历史母题的适用性和既有缺口仍需阅读具体输出。", "",
    "| 检查 | 状态 | 退出码 |", "|---|---|---|",
    ...checks.map(c => `| ${c.label} | ${c.status} | ${c.exitCode ?? "—"} |`), ""];
  for (const check of checks) {
    const output = check.output || "(no output)";
    const longest = Math.max(0, ...[...output.matchAll(/~+/g)].map(m => m[0].length));
    const fence = "~".repeat(Math.max(3, longest + 1));
    lines.push(`## ${check.label}`, "", "命令参数（JSON 数组）：", "",
      `${fence}text`, JSON.stringify(check.command), fence, "", `${fence}text`, output.trimEnd(), fence, "");
  }
  lines.push("## 检查时的工作树", "", "```text", gitState.stdout?.trimEnd() || "(clean or unavailable)", "```", "");
  const folder = path.join(ROOT, "production", "qa");
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `studio-${mode}-${timestamp.replace(/[:.]/g, "-")}-${process.pid}.md`);
  fs.writeFileSync(file, lines.join("\n"), { flag: "wx" });
  console.log(`Automatic checks: ${success ? "PASS" : "FAIL"}\nReport: ${file}`);
  return success ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
