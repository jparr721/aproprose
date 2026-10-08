import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

async function runCommand(program: string, args: string[], timeout: number): Promise<string> {
  try {
    const result = await executeFile(program, args, { timeout, maxBuffer: 1_048_576 });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`Artifact smoke command failed: ${program} ${args.join(" ")}: ${String(error)}`, { cause: error });
  }
}

function findArtifact(directory: string, extension: string): string {
  const matches = readdirSync(directory).filter((name) => name.endsWith(extension));
  if (matches.length !== 1) throw new Error(`Expected one ${extension} artifact in ${directory}, found ${matches.length}`);
  return join(directory, matches[0]);
}

async function runNsis(executable: string, args: string[], timeout: number): Promise<void> {
  const executableLiteral = executable.replaceAll("'", "''");
  const argumentLiterals = args.map((argument) => `'${argument.replaceAll("'", "''")}'`).join(", ");
  // Start-Process joins these literals without adding quotes around NSIS's final directory argument.
  const command = `$installer = Start-Process -FilePath '${executableLiteral}' -ArgumentList @(${argumentLiterals}) -PassThru; try { if (-not $installer.WaitForExit(${timeout})) { throw 'NSIS installer timed out' }; $installer.Refresh(); if ($installer.ExitCode -ne 0) { throw ('NSIS installer exited ' + $installer.ExitCode) } } finally { if (-not $installer.HasExited) { Stop-Process -Id $installer.Id -Force } }`;
  await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], timeout + 10_000);
}

async function prepareExecutable(bundleDirectory: string, directory: string): Promise<string> {
  switch (process.platform) {
    case "linux": {
      const artifact = findArtifact(join(bundleDirectory, "deb"), ".deb");
      await runCommand("dpkg-deb", ["--extract", artifact, directory], 60_000);
      const executable = join(directory, "usr", "bin", "aproprose");
      if (!existsSync(executable)) throw new Error(`Debian artifact does not contain ${executable}`);
      return executable;
    }
    case "darwin": {
      const artifact = findArtifact(join(bundleDirectory, "macos"), ".app");
      const application = join(directory, basename(artifact));
      cpSync(artifact, application, { recursive: true });
      const executableName = await runCommand("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", join(application, "Contents", "Info.plist")], 10_000);
      if (executableName === "" || basename(executableName) !== executableName) throw new Error("Invalid CFBundleExecutable in packaged app");
      const executable = join(application, "Contents", "MacOS", executableName);
      if (!existsSync(executable)) throw new Error(`Packaged app does not contain ${executable}`);
      return executable;
    }
    case "win32": {
      const artifact = findArtifact(join(bundleDirectory, "nsis"), ".exe");
      const installation = join(directory, "installed");
      // NSIS consumes the last /D argument verbatim, including spaces.
      await runNsis(artifact, ["/S", `/D=${installation}`], 120_000);
      const executable = join(installation, "aproprose.exe");
      if (!existsSync(executable)) throw new Error(`NSIS installer did not install ${executable}`);
      return executable;
    }
    default:
      throw new Error(`Artifact smoke does not support ${process.platform}`);
  }
}

const macWindowProbe = `
import CoreGraphics
import Foundation
guard let pid = Int32(CommandLine.arguments[1]),
      let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { exit(2) }
let visible = windows.contains { window in
  guard let owner = window[kCGWindowOwnerPID as String] as? Int32,
        let layer = window[kCGWindowLayer as String] as? Int,
        let bounds = window[kCGWindowBounds as String] as? [String: CGFloat],
        let width = bounds["Width"], let height = bounds["Height"] else { return false }
  return owner == pid && layer == 0 && width >= 360 && height >= 240
}
print(visible ? "visible" : "missing")
`;

async function hasVisibleWindow(pid: number): Promise<boolean> {
  switch (process.platform) {
    case "linux":
      try {
        const result = await executeFile("xdotool", ["search", "--onlyvisible", "--pid", String(pid)], { timeout: 5_000 });
        return result.stdout.trim() !== "";
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === 1) return false;
        throw error;
      }
    case "darwin":
      return await runCommand("swift", ["-e", macWindowProbe, String(pid)], 15_000) === "visible";
    case "win32":
      return await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$app = Get-Process -Id ${pid} -ErrorAction Stop; $app.Refresh(); if ($app.MainWindowHandle -ne 0 -and -not $app.HasExited) { 'visible' } else { 'missing' }`], 5_000) === "visible";
    default:
      throw new Error(`Window observation does not support ${process.platform}`);
  }
}

export async function observeApplication(
  child: ChildProcess,
  probeWindow: () => Promise<boolean>,
  timeoutMs: number,
  settleMs: number,
): Promise<void> {
  let failure: Error | null = null;
  const onError = (error: Error): void => { failure = error; };
  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    failure = new Error(`Packaged application exited before smoke completed: code=${code}, signal=${signal}`);
  };
  child.on("error", onError);
  child.on("exit", onExit);
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (failure !== null) throw failure;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Packaged application exited before smoke completed");
      const visible = await probeWindow();
      if (failure !== null) throw failure;
      if (visible) {
        await delay(settleMs);
        if (failure !== null) throw failure;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("Packaged application exited during settle interval");
        if (!await probeWindow()) throw new Error("Packaged application window disappeared during settle interval");
        if (failure !== null) throw failure;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("Packaged application exited while confirming the settled window");
        return;
      }
      await delay(250);
    }
    throw new Error(`Packaged application did not create a visible window within ${timeoutMs}ms`);
  } finally {
    child.off("error", onError);
    child.off("exit", onExit);
  }
}

async function stopApplication(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    if (child.exitCode === null && child.signalCode === null) await runCommand("taskkill.exe", ["/PID", String(pid), "/T", "/F"], 10_000);
    return;
  }
  try { process.kill(-pid, "SIGTERM"); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
  await delay(500);
  try { process.kill(-pid, "SIGKILL"); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

async function main(): Promise<void> {
  const [bundleArgument] = process.argv.slice(2);
  if (bundleArgument === undefined) throw new Error("Usage: bun scripts/smoke-release-artifact.ts <bundle-directory>");
  const directory = mkdtempSync(join(tmpdir(), "aproprose-artifact-smoke-"));
  let child: ChildProcess | null = null;
  const output: string[] = [];
  try {
    const executable = await prepareExecutable(resolve(bundleArgument), directory);
    child = spawn(executable, [], {
      detached: process.platform !== "win32",
      stdio: "pipe",
      env: { ...process.env, XDG_CONFIG_HOME: join(directory, "config"), XDG_DATA_HOME: join(directory, "data"), XDG_CACHE_HOME: join(directory, "cache"), APPDATA: join(directory, "appdata"), LOCALAPPDATA: join(directory, "localappdata"), CFFIXED_USER_HOME: join(directory, "profile") },
    });
    const launched = child;
    launched.stdout?.on("data", (data: Buffer) => output.push(data.toString()));
    launched.stderr?.on("data", (data: Buffer) => output.push(data.toString()));
    await new Promise<void>((resolveSpawn, reject) => { launched.once("spawn", resolveSpawn); launched.once("error", reject); });
    const pid = launched.pid;
    if (pid === undefined) throw new Error("Packaged application started without a process ID");
    await observeApplication(launched, () => hasVisibleWindow(pid), 30_000, 3_000);
    console.log(`Packaged application launched with a visible window: ${executable}`);
  } catch (error) {
    throw new Error(`Packaged application smoke failed. Output: ${output.join("")}`, { cause: error });
  } finally {
    try {
      if (child !== null) await stopApplication(child);
      const uninstaller = join(directory, "installed", "uninstall.exe");
      if (process.platform === "win32" && existsSync(uninstaller)) await runNsis(uninstaller, ["/S", `_?=${join(directory, "installed")}`], 60_000);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
}

if (import.meta.main) await main();
