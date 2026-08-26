import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Client = { address: string; class: string; pid: number };

const decoder = new TextDecoder();
const binary = process.argv[2] ?? "src-tauri/target/release/aproprose";
const requiredDesktopVariables = [
  "XDG_RUNTIME_DIR",
  "WAYLAND_DISPLAY",
  "HYPRLAND_INSTANCE_SIGNATURE",
] as const;
if (!process.env.APROPROSE_SMOKE_PRIVATE_DBUS) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  env.APROPROSE_SMOKE_PRIVATE_DBUS = "1";
  const result = Bun.spawnSync(
    ["dbus-run-session", "--", process.execPath, import.meta.path, ...process.argv.slice(2)],
    { env, stderr: "pipe", stdout: "pipe" },
  );
  if (!result.success) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
  process.exit(result.exitCode);
}


function fail(message: string): never {
  throw new Error(message);
}

function command(cmd: string[], env: Record<string, string>): string {
  const result = Bun.spawnSync(cmd, { env, stderr: "pipe", stdout: "pipe" });
  if (!result.success) {
    fail(`${cmd.join(" ")} failed: ${decoder.decode(result.stderr).trim()}`);
  }
  return decoder.decode(result.stdout);
}

function hyprClients(env: Record<string, string>): Client[] {
  return JSON.parse(command(["hyprctl", "clients", "-j"], env)) as Client[];
}


async function waitFor<T>(get: () => T | undefined, description: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = get();
    if (value !== undefined) return value;
    await Bun.sleep(50);
  }
  fail(`timed out waiting for ${description}`);
}


function isolatedEnvironment(root: string): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  for (const variable of requiredDesktopVariables) {
    if (!env[variable]) fail(`missing required desktop environment variable ${variable}`);
  }
  for (const directory of ["config", "data", "state", "cache"]) {
    const path = join(root, directory);
    mkdirSync(path);
    env[`XDG_${directory.toUpperCase()}_HOME`] = path;
  }
  return env;
}

let first: Bun.Subprocess | undefined;
let second: Bun.Subprocess | undefined;
const root = mkdtempSync(join(tmpdir(), "aproprose-single-instance-"));

try {
  const env = isolatedEnvironment(root);
  first = Bun.spawn([binary], { env, stderr: "ignore", stdout: "ignore" });
  const firstClient = await waitFor(
    () => hyprClients(env).find((client) => client.pid === first?.pid),
    "the first Aproprose window",
  );

  second = Bun.spawn([binary], { env, stderr: "ignore", stdout: "ignore" });
  const clients = await waitFor(() => {
    const matching = hyprClients(env).filter(
      (client) => client.pid === first?.pid || client.pid === second?.pid,
    );
    return matching.length > 1 || second?.exitCode !== null ? matching : undefined;
  }, "the second launch to start or exit");

  if (clients.length !== 1 || clients[0].pid !== first.pid) {
    fail(`expected one client for the first launch, found ${JSON.stringify(clients)}`);
  }
  if (await waitFor(() => second?.exitCode ?? undefined, "the second launch to exit") !== 0) {
    fail("the second launch did not exit cleanly");
  }
  await waitFor(
    () =>
      (
        JSON.parse(command(["hyprctl", "activewindow", "-j"], env)) as Client
      ).pid === first?.pid
        ? true
        : undefined,
    "the existing Aproprose window to receive focus",
  );

  command(
    [
      "hyprctl",
      "eval",
      `return hl.dispatch(hl.dsp.window.close({ window = \"address:${firstClient.address}\" }))`,
    ],
    env,
  );
  if (await waitFor(() => first?.exitCode ?? undefined, "the focused Aproprose window to close") !== 0) {
    fail("the normal close dispatch did not exit Aproprose cleanly");
  }
} finally {
  if (second?.exitCode === null) second.kill("SIGTERM");
  if (first?.exitCode === null) first.kill("SIGTERM");
  if (second) await second.exited;
  if (first) await first.exited;
  rmSync(root, { force: true, recursive: true });
}
