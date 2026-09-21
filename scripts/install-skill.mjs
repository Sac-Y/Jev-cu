#!/usr/bin/env node
/**
 * 把项目里的 skill/jev-cu 安装到 Codex 技能目录。
 *
 *   node scripts/install-skill.mjs            # 复制安装（默认，稳定）
 *   node scripts/install-skill.mjs --link     # 软链安装（源文件始终以项目为准）
 *   node scripts/install-skill.mjs --uninstall
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(PROJECT_DIR, "skill", "jev-cu");
const DEST = path.join(os.homedir(), ".codex", "skills", "jev-cu");
const REPO_DIR_PLACEHOLDER = "{{REPO_DIR}}";
const uninstall = process.argv.includes("--uninstall");
const link = process.argv.includes("--link");

/** 把 skill 文本里的 {{REPO_DIR}} 替换成本机项目路径（复制安装时执行） */
function materializeRepoDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) materializeRepoDir(p);
    else if (entry.isFile()) {
      const text = fs.readFileSync(p, "utf8");
      const replaced = text.split(REPO_DIR_PLACEHOLDER).join(PROJECT_DIR);
      if (replaced !== text) fs.writeFileSync(p, replaced);
    }
  }
}

if (uninstall) {
  fs.rmSync(DEST, { recursive: true, force: true });
  console.log(`已卸载：${DEST}`);
  process.exit(0);
}

if (!fs.existsSync(path.join(SRC, "SKILL.md"))) {
  console.error(`源 skill 不存在：${SRC}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.rmSync(DEST, { recursive: true, force: true });
if (link) {
  fs.symlinkSync(SRC, DEST, "dir");
  console.log(`已软链安装：${DEST} → ${SRC}`);
} else {
  fs.cpSync(SRC, DEST, { recursive: true });
  materializeRepoDir(DEST);
  console.log(`已复制安装：${SRC} → ${DEST}`);
}
console.log("新会话生效；卸载：node scripts/install-skill.mjs --uninstall");
