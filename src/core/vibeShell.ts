/**
 * Мини-шелл для project: локальные команды над файлами (expo-file-system)
 * + агентные `ai`/`run` (стримят ответ через gateway).
 *
 * Безопасность: все команды работают ТОЛЬКО внутри documentDirectory/vibe/<id>.
 * Пути нормализуются; `..` и абсолютные пути запрещены (safeRel).
 */
import { Directory, Paths } from "expo-file-system";
import * as vib from "./vibeLocal";

export type ShellLine = { kind: "out" | "err"; text: string };

export interface ExecResult {
  /** готовые строки вывода (локальные команды) */
  lines: ShellLine[];
  /** команда агента — UI продолжит стримить */
  agent?: { cmd: "ai" | "run"; arg: string };
  /** маркер "clear" в тексте строки — терминал очистится */
}

const HELP: ShellLine[] = [
  { kind: "out", text: "Команды:" },
  { kind: "out", text: "  help / pwd / ls [путь] / ll / tree" },
  { kind: "out", text: "  cat <файл> · mkdir <путь> · touch <файл>" },
  { kind: "out", text: "  rm <файл> · rm -r <папка> · mv <a> <b> · cp <a> <b>" },
  { kind: "out", text: "  ai <вопрос> — спроси агента по проекту" },
  { kind: "out", text: "  run <файл> — агент проанализирует файл" },
  { kind: "out", text: "  clear" },
];

/** Разрешает относительный путь от cwd, не выходя за пределы проекта. */
export function resolvePath(cwd: string, input: string): string {
  const p = input.trim().startsWith("/")
    ? input.trim().slice(1)
    : (cwd + "/" + input.trim()).replace(/\/+/g, "/");
  const segments = p.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.some((s) => s === "..")) {
    throw new Error("Путь вне проекта запрещён");
  }
  return segments.join("/");
}

export function cwdLabel(projectId: string, cwd: string): string {
  return `~/vibe/${projectId.slice(-6)}${cwd ? "/" + cwd : ""}`;
}

function dirAt(projectId: string, rel: string): Directory {
  const root = new Directory(Paths.document, "vibe", projectId);
  const parts = rel.split("/").filter(Boolean);
  return parts.length ? new Directory(root, ...parts) : root;
}

function err(m: unknown): ExecResult {
  return { lines: [{ kind: "err", text: String((m as Error)?.message || m) }] };
}

/** Обработка локальной команды. */
export async function runShell(projectId: string, cwd: string, raw: string): Promise<ExecResult> {
  const cmd = raw.trim();
  const parts = cmd.split(/\s+/);
  const name = (parts[0] || "").toLowerCase();
  const args = parts.slice(1);

  const ok = (text = "ok") => ({ lines: [{ kind: "out" as const, text }] });

  switch (name) {
    case "": return { lines: [] };
    case "help": return { lines: HELP };
    case "pwd": return { lines: [{ kind: "out", text: cwdLabel(projectId, cwd) }] };
    case "clear": return { lines: [{ kind: "out", text: "\u0000CLEAR" }] };
    case "ls":
    case "ll": {
      const target = args[0] || ".";
      let rel: string;
      try { rel = resolvePath(cwd, target); } catch (e: any) { return err(e); }
      const d = dirAt(projectId, rel);
      if (!d.exists) return err(`нет такой папки: ${target}`);
      const names = d.list().map((i) => i.name).sort((a, b) => a.localeCompare(b));
      return { lines: [{ kind: "out", text: names.length ? names.join("\t") : "(пусто)" }] };
    }
    case "tree":
      return { lines: [{ kind: "out", text: await vib.treeFiles(projectId) }] };
    case "cat": {
      if (!args[0]) return err("usage: cat <файл>");
      try { return { lines: [{ kind: "out", text: await vib.readFile(projectId, resolvePath(cwd, args[0])) }] }; }
      catch (e: any) { return err(e); }
    }
    case "mkdir": {
      if (!args[0]) return err("usage: mkdir <путь>");
      try { await vib.createDir(projectId, resolvePath(cwd, args[0])); return ok(); } catch (e: any) { return err(e); }
    }
    case "touch": {
      if (!args[0]) return err("usage: touch <файл>");
      try { await vib.writeFile(projectId, resolvePath(cwd, args[0]), ""); return ok(); } catch (e: any) { return err(e); }
    }
    case "rm": {
      if (!args[0]) return err("usage: rm [(-r|-R)] <файл|папка>");
      if (args[0] === "-r" || args[0] === "-R") {
        if (!args[1]) return err("usage: rm -r <папка>");
        try { await vib.deleteDirRecursive(projectId, resolvePath(cwd, args[1])); return ok(); } catch (e: any) { return err(e); }
      }
      try { await vib.deleteFile(projectId, resolvePath(cwd, args[0])); return ok(); } catch (e: any) { return err(e); }
    }
    case "mv": {
      if (args.length < 2) return err("usage: mv <файл> <файл|папка>");
      try { await vib.renameFile(projectId, resolvePath(cwd, args[0]), args[1].split("/").pop() || args[1]); return ok(); } catch (e: any) { return err(e); }
    }
    case "cp": {
      if (args.length < 2) return err("usage: cp <src> <dst>");
      try { await vib.copyFile(projectId, resolvePath(cwd, args[0]), resolvePath(cwd, args[1])); return ok(); } catch (e: any) { return err(e); }
    }
    case "ai": {
      const arg = args.join(" ");
      if (!arg) return err("usage: ai <вопрос>");
      return { lines: [], agent: { cmd: "ai", arg } };
    }
    case "run": {
      if (!args[0]) return err("usage: run <файл>");
      return { lines: [], agent: { cmd: "run", arg: args[0] } };
    }
    default:
      return err(`команда не найдена: ${name} — введи "help"`);
  }
}