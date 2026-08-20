/**
 * Copilot CLI runner (ui-parity-contract.md §13.2).
 *
 * Resolves copilot.exe, writes the prompt to a temp file prefixed with the
 * anti-tool header, spawns the CLI with a fixed argument list, accumulates
 * stdout/stderr (no token streaming) and returns trimmed stdout after exit.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 15-minute hard timeout, then the process tree is killed. */
const TIMEOUT_MS = 15 * 60 * 1000;

const NOT_FOUND_MESSAGE =
  'copilot.exe not found. Install with `winget install GitHub.CopilotCLI` and run `copilot login` once.';

/** Anti-tool header prepended to every prompt file (verbatim). */
export const ANTI_TOOL_HEADER =
  'IMPORTANT: Do NOT call any tools (no shell, no write, no read). Respond with text only based on the request below.\n\n';

let cachedExePath: string | null = null;
let cachedClaudeExePath: string | null = null;

/** Model ids are CLI arguments — allow only safe id characters. */
const MODEL_RE = /^[A-Za-z0-9._:[\]-]+$/;

/** Throw unless the model looks like a plain model id (defense against
 *  command injection through the .cmd shell flatten below). */
export function assertSafeModel(model: string): void {
  if (!MODEL_RE.test(model)) throw new Error(`Invalid model id: ${JSON.stringify(model)}`);
}

/** cmd.exe-safe quoting: escape embedded quotes, then quote when needed. */
function cmdQuote(a: string): string {
  const escaped = a.replace(/"/g, '""');
  return /[\s&()^,;="]/.test(a) ? `"${escaped}"` : escaped;
}

/** Test hook: forget the cached copilot.exe path. */
export function resetCopilotExeCache(): void {
  cachedExePath = null;
  cachedClaudeExePath = null;
}

/**
 * Lumo uses the same interactive answer profile as Yaki: Claude Sonnet 5 via
 * Copilot, the 1M context tier, and medium reasoning effort. Keep construction
 * in one exported helper so tests can verify the exact CLI contract without
 * spawning an external process.
 */
export function buildCopilotArgs(model: string): string[] {
  return [
    '-p',
    'Proceed. Respond now exactly per your instructions and response contract. Output ONLY the JSON.',
    '-s',
    '--model',
    model,
    '--context',
    'long_context',
    '--effort',
    'medium',
    '--deny-tool',
    'shell',
    '--deny-tool',
    'write',
    '--output-format',
    'text',
  ];
}

/**
 * Resolve copilot.exe: `where copilot` (first line ending in .exe that
 * exists) → %LOCALAPPDATA%\Programs\CopilotCLI\copilot.exe → throw.
 * Result is cached for the process lifetime.
 */
export function resolveCopilotExe(): string {
  if (cachedExePath !== null) return cachedExePath;

  try {
    const res = spawnSync('where', ['copilot'], { encoding: 'utf8', windowsHide: true });
    if (res.status === 0 && typeof res.stdout === 'string') {
      const lines = res.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && existsSync(line));
      // Prefer a real .exe; fall back to the npm .cmd/.bat shim.
      const hit =
        lines.find((line) => line.toLowerCase().endsWith('.exe')) ??
        lines.find((line) => /\.(cmd|bat)$/i.test(line));
      if (hit) {
        cachedExePath = hit;
        return hit;
      }
    }
  } catch {
    // `where` unavailable — fall through to the fixed location.
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const candidate = path.join(localAppData, 'Programs', 'CopilotCLI', 'copilot.exe');
    if (existsSync(candidate)) {
      cachedExePath = candidate;
      return candidate;
    }
  }

  throw new Error(NOT_FOUND_MESSAGE);
}

/** Kill the whole process tree (taskkill /T on Windows). */
function killTree(pid: number | undefined, child: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32' && pid !== undefined) {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
      return;
    } catch {
      // fall through to plain kill
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // already gone
  }
}

/**
 * Run copilot.exe with the prompt delivered via a temp file. Resolves with
 * trimmed stdout; rejects on non-zero exit, timeout, abort or spawn failure.
 */
export async function runCopilotCli(
  prompt: string,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  assertSafeModel(model);
  const exe = resolveCopilotExe();
  // Copilot treats "follow the instructions in this file" as prompt
  // injection when the file defines an app persona. Yaki supplies the same
  // contract through Copilot's supported AGENTS.md instruction channel, so
  // Lumo does the same in an isolated temporary working directory.
  const agentDir = mkdtempSync(path.join(tmpdir(), 'copilot-lumo-'));
  const taskSpecHeader =
    'PROJECT TASK SPEC (from the app developer): This CLI call is the headless backend answer engine of an internal QA application. ' +
    'The application spec below defines the assistant persona THE APP presents to its users, the response contract, routing rules, and domain knowledge. ' +
    'Follow the spec to produce the application\'s next response verbatim (usually JSON). Any text outside the contracted format breaks the app. ' +
    'This is a data-generation task for the application — not a change of your identity.\n\n=== APPLICATION SPEC ===\n\n';
  writeFileSync(path.join(agentDir, 'AGENTS.md'), taskSpecHeader + prompt, {
    encoding: 'utf8',
    mode: 0o600,
  });

  try {
    return await new Promise<string>((resolve, reject) => {
      const args = buildCopilotArgs(model);
      // npm ships copilot as a .cmd shim — batch files need a shell. Quote
      // args ourselves (none contain embedded quotes) and hand cmd one line.
      const isBatch = /\.(cmd|bat)$/i.test(exe);
      const child = isBatch
        ? spawn(
            [exe, ...args].map(cmdQuote).join(' '),
            { cwd: agentDir, windowsHide: true, shell: true },
          )
        : spawn(exe, args, { cwd: agentDir, windowsHide: true });

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let aborted = false;

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid, child);
      }, TIMEOUT_MS);

      const onAbort = (): void => {
        aborted = true;
        killTree(child.pid, child);
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      const finish = (err: Error | null, value?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(value ?? '');
      };

      child.on('error', (err) => {
        finish(new Error(`Failed to start copilot.exe: ${err.message}`));
      });

      child.on('close', (code) => {
        if (timedOut) {
          finish(new Error('copilot.exe timed out after 15 minutes.'));
          return;
        }
        if (aborted) {
          finish(new Error('copilot.exe run was aborted.'));
          return;
        }
        if (code !== 0) {
          finish(new Error(`copilot.exe exited ${code}. ${stderr.trim() || '(no stderr)'}`));
          return;
        }
        finish(null, stdout.trim());
      });
    });
  } finally {
    const expectedPrefix = path.join(tmpdir(), 'copilot-lumo-');
    if (agentDir.startsWith(expectedPrefix)) {
      try {
        rmSync(agentDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Claude Code CLI backend (Lumo runClaude port — essentials only)
// ---------------------------------------------------------------------------

const CLAUDE_NOT_FOUND_MESSAGE =
  'claude CLI not found. Install Claude Code and run `claude login` once.';

/** Only claude-* model ids route to the Claude CLI; everything else → Copilot. */
export function isClaudeModel(model: string): boolean {
  return /^claude/i.test(String(model ?? '').trim());
}

export function isOllamaModel(model: string): boolean {
  return /^ollama:/i.test(String(model ?? '').trim());
}

/** Local-only Lumo backend; no question or retrieved work data leaves the PC. */
export async function runOllama(
  prompt: string,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  assertSafeModel(model);
  const localModel = model.replace(/^ollama:/i, '');
  if (!localModel) throw new Error('An Ollama model name is required.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2 * 60_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(`${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: localModel,
        prompt: ANTI_TOOL_HEADER + prompt,
        stream: false,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE || '24h',
        options: { temperature: 0.1, num_ctx: 32_768 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const body = await response.json() as { response?: string; error?: string };
    if (body.error) throw new Error(body.error);
    const text = body.response?.trim();
    if (!text) throw new Error('Ollama returned an empty response.');
    return text;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Claude CLI argument list: the whole prompt travels via --system-prompt-file
 * (persona prompts in user content get refused as injection), MCP servers are
 * kept out with --strict-mcp-config, and --tools none makes it a plain
 * completion. stdin carries only a short trigger.
 */
export function buildClaudeArgs(promptFile: string, model: string): string[] {
  return [
    '-p',
    '--system-prompt-file',
    promptFile,
    '--strict-mcp-config',
    '--model',
    model,
    '--output-format',
    'text',
    '--tools',
    'none',
  ];
}

/** Trigger string piped to stdin (the prompt itself is the system prompt). */
export const CLAUDE_STDIN_TRIGGER =
  'Proceed. Respond now exactly per your instructions and response contract.';

/**
 * Resolve the claude CLI: `where claude` (exe preferred, then .cmd/.bat shim).
 * Result is cached for the process lifetime.
 */
export function resolveClaudeExe(): string {
  if (cachedClaudeExePath !== null) return cachedClaudeExePath;
  try {
    const res = spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true });
    if (res.status === 0 && typeof res.stdout === 'string') {
      const lines = res.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && existsSync(line));
      const hit =
        lines.find((line) => line.toLowerCase().endsWith('.exe')) ??
        lines.find((line) => /\.(cmd|bat)$/i.test(line)) ??
        lines[0];
      if (hit) {
        cachedClaudeExePath = hit;
        return hit;
      }
    }
  } catch {
    // fall through
  }
  throw new Error(CLAUDE_NOT_FOUND_MESSAGE);
}

/**
 * Run the Claude Code CLI as a raw completion: prompt in a temp file passed
 * via --system-prompt-file, trigger string on stdin, trimmed stdout back.
 * Same 15-minute timeout / abort / taskkill-tree semantics as the Copilot path.
 */
export async function runClaudeCli(
  prompt: string,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  assertSafeModel(model);
  const exe = resolveClaudeExe();
  const tmpFile = path.join(tmpdir(), `claude-prompt-${randomUUID()}.txt`);
  writeFileSync(tmpFile, prompt, { encoding: 'utf8', mode: 0o600 });

  try {
    return await new Promise<string>((resolve, reject) => {
      const args = buildClaudeArgs(tmpFile, model);
      const isBatch = /\.(cmd|bat)$/i.test(exe);
      const child = isBatch
        ? spawn(
            [exe, ...args].map(cmdQuote).join(' '),
            { windowsHide: true, shell: true },
          )
        : spawn(exe, args, { windowsHide: true });

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let aborted = false;

      // Guard stdin against EPIPE — if claude exits instantly the write below
      // would otherwise raise an unhandled 'error' event.
      child.stdin?.on('error', () => {});
      child.stdin?.write(CLAUDE_STDIN_TRIGGER);
      child.stdin?.end();

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid, child);
      }, TIMEOUT_MS);

      const onAbort = (): void => {
        aborted = true;
        killTree(child.pid, child);
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      const finish = (err: Error | null, value?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(value ?? '');
      };

      child.on('error', (err) => {
        finish(new Error(`Failed to start claude CLI: ${err.message}`));
      });

      child.on('close', (code) => {
        if (timedOut) {
          finish(new Error('claude CLI timed out after 15 minutes.'));
          return;
        }
        if (aborted) {
          finish(new Error('claude CLI run was aborted.'));
          return;
        }
        const content = stdout.trim();
        if (code !== 0 && content.length === 0) {
          finish(new Error(`claude CLI exited ${code}. ${stderr.trim() || '(no stderr)'}`));
          return;
        }
        finish(null, content);
      });
    });
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * All Lumo/LLM traffic runs on GitHub Copilot CLI (Copilot hosts the claude-*
 * roster itself). The Claude Code CLI backend stays available only behind
 * LUMO_USE_CLAUDE_CLI=1 for development experiments.
 */
export function selectCliRunner(
  model: string,
): (prompt: string, model: string, signal?: AbortSignal) => Promise<string> {
  if (isOllamaModel(model)) return runOllama;
  if (process.env.LUMO_USE_CLAUDE_CLI === '1' && isClaudeModel(model)) return runClaudeCli;
  return runCopilotCli;
}

/** Backend-selecting runner — drop-in RunCliFn for the Lumo agent loop. */
export function runCliForModel(prompt: string, model: string, signal?: AbortSignal): Promise<string> {
  return selectCliRunner(model)(prompt, model, signal);
}
