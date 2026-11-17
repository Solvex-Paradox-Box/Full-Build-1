import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface SandboxLimits {
  timeoutMs?: number;
  memoryBytes?: number;
  cpuCount?: number;
  pidsLimit?: number;
  maxOutputBytes?: number;
}
export interface SandboxResult {
  passed: boolean;
  containerId: string;
  exitCode: number | null;
  timedOut: boolean;
  oomKilled: boolean;
  memoryLimitBytes: number;
  output: string;
  error?: string;
}

/** Executes only in a digest-pinned, networkless, read-only Docker container.
 * Missing Docker, an unpinned image, timeout, OOM, or nonzero exit all fail closed.
 */
export class IsolatedExecutionSandbox {
  static async execute(image: string, argv: string[], input: string, limits: SandboxLimits = {}): Promise<SandboxResult> {
    if (!/^(?:[^\s@]+@)?sha256:[a-f0-9]{64}$/i.test(image)) throw new Error('Sandbox image must be pinned by immutable sha256 digest or local image ID.');
    if (!Array.isArray(argv) || argv.length === 0 || argv.some(a => typeof a !== 'string' || a.length > 4096)) throw new Error('Sandbox argv is invalid.');
    const timeoutMs = Math.min(Math.max(limits.timeoutMs ?? 15_000, 100), 120_000);
    const memoryBytes = Math.min(Math.max(limits.memoryBytes ?? 256 * 1024 * 1024, 32 * 1024 * 1024), 2 * 1024 * 1024 * 1024);
    const cpuCount = Math.min(Math.max(limits.cpuCount ?? 1, 0.1), 2);
    const pidsLimit = Math.min(Math.max(Math.floor(limits.pidsLimit ?? 64), 8), 256);
    const maxOutputBytes = Math.min(Math.max(limits.maxOutputBytes ?? 256 * 1024, 1024), 2 * 1024 * 1024);
    const name = 'solvex-sandbox-' + randomUUID();
    const args = ['run', '-i', '--name', name, '--network=none', '--read-only', '--memory', String(memoryBytes),
      '--memory-swap', String(memoryBytes), '--cpus', String(cpuCount), '--pids-limit', String(pidsLimit),
      '--user', '65534:65534', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m', '--pull=never', image, ...argv];
    let output = '';
    let timedOut = false;
    let overflow = false;
    let exitCode: number | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
        let killRequested = false;
        const terminateContainer = () => {
          if (killRequested) return;
          killRequested = true;
          const killer = spawn('docker', ['kill', '--signal=KILL', name], { stdio: 'ignore' });
          killer.on('error', () => child.kill('SIGKILL'));
          killer.on('close', () => child.kill('SIGKILL'));
        };
        const timer = setTimeout(() => { timedOut = true; terminateContainer(); }, timeoutMs);
        const append = (chunk: Buffer) => {
          if (Buffer.byteLength(output) + chunk.length > maxOutputBytes) { overflow = true; terminateContainer(); return; }
          output += chunk.toString('utf8');
        };
        child.stdout.on('data', append);
        child.stderr.on('data', append);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => { clearTimeout(timer); exitCode = code; resolve(); });
        child.stdin.end(input);
      });
    } catch (error) {
      return { passed: false, containerId: name, exitCode, timedOut, oomKilled: false, memoryLimitBytes: memoryBytes, output,
        error: error instanceof Error ? error.message : String(error) };
    }
    let oomKilled = false;
    try {
      const inspected = await new Promise<string>((resolve, reject) => {
        const child = spawn('docker', ['inspect', '--format', '{{.State.OOMKilled}}', name], { stdio: ['ignore', 'pipe', 'pipe'] });
        let data = ''; child.stdout.on('data', b => data += b.toString());
        child.on('error', reject); child.on('close', code => code === 0 ? resolve(data.trim()) : reject(new Error('docker inspect failed')));
      });
      oomKilled = inspected === 'true';
    } catch { /* container may not have been created; result remains failed */ }
    await new Promise<void>(resolve => {
      const child = spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
      child.on('error', () => resolve()); child.on('close', () => resolve());
    });
    const passed = exitCode === 0 && !timedOut && !oomKilled && !overflow;
    return { passed, containerId: name, exitCode, timedOut, oomKilled, memoryLimitBytes: memoryBytes, output,
      ...(!passed ? { error: timedOut ? 'Sandbox timeout' : oomKilled ? 'Sandbox memory limit exceeded' : overflow ? 'Sandbox output limit exceeded' : 'Sandbox command failed' } : {}) };
  }
}