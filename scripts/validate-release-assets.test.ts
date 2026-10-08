import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateManifest, verifyArtifactSignature } from "./validate-release-assets";
import { observeApplication, prepareMacWindowObserver } from "./smoke-release-artifact";

const assets = ["aproprose.app.tar.gz", "aproprose.AppImage", "aproprose-setup.exe", "aproprose.pkg.tar.zst"];
const platforms = ["darwin-aarch64", "linux-x86_64", "windows-x86_64"];
function manifest() {
  return { version: "1.2.3", notes: "Release notes", platforms: Object.fromEntries(platforms.map((platform, i) => [platform, {
    signature: Buffer.from("untrusted comment: signature\nencoded\ntrusted comment: timestamp\nencoded\n").toString("base64"),
    url: `https://github.com/jparr721/aproprose/releases/download/v1.2.3/${assets[i]}`,
  }])) };
}
describe("release updater gate", () => {
  it("binds every supported platform to an attached asset on the exact release", () => {
    expect(validateManifest(manifest(), "1.2.3", "jparr721/aproprose", assets)).toHaveLength(3);
  });
  it("rejects version drift, missing platforms, empty notes, signatures, foreign URLs, and absent assets", () => {
    expect(() => validateManifest(manifest(), "1.2.4", "jparr721/aproprose", assets)).toThrow(/version/);
    const missing = manifest(); delete missing.platforms["linux-x86_64"];
    expect(() => validateManifest(missing, "1.2.3", "jparr721/aproprose", assets)).toThrow(/linux/);
    expect(() => validateManifest({ ...manifest(), notes: "" }, "1.2.3", "jparr721/aproprose", assets)).toThrow(/notes/);
    const unsigned = manifest(); unsigned.platforms["darwin-aarch64"].signature = "";
    expect(() => validateManifest(unsigned, "1.2.3", "jparr721/aproprose", assets)).toThrow(/signature/);
    const foreign = manifest(); foreign.platforms["darwin-aarch64"].url = "https://evil.example/asset";
    expect(() => validateManifest(foreign, "1.2.3", "jparr721/aproprose", assets)).toThrow(/URL/);
    expect(() => validateManifest(manifest(), "1.2.3", "jparr721/aproprose", assets.slice(1))).toThrow(/attached/);
  });
  it("rejects an attached signed artifact assigned to the wrong platform", () => {
    const swapped = manifest();
    swapped.platforms["linux-x86_64"].url = swapped.platforms["windows-x86_64"].url;
    expect(() => validateManifest(swapped, "1.2.3", "jparr721/aproprose", assets)).toThrow(/platform/);
  });
  it("rejects encoded directory traversal and URLs for another tag", () => {
    const traversal = manifest();
    traversal.platforms["darwin-aarch64"].url = "https://github.com/jparr721/aproprose/releases/download/v1.2.3/nested%2faproprose.app.tar.gz";
    expect(() => validateManifest(traversal, "1.2.3", "jparr721/aproprose", assets)).toThrow(/attached/);
    const wrongTag = manifest();
    wrongTag.platforms["darwin-aarch64"].url = "https://github.com/jparr721/aproprose/releases/download/v1.2.4/aproprose.app.tar.gz";
    expect(() => validateManifest(wrongTag, "1.2.3", "jparr721/aproprose", assets)).toThrow(/URL/);
  });
  it("rejects placeholder notes, missing Arch packages, and URL query overrides", () => {
    expect(() => validateManifest({ ...manifest(), notes: "See the assets to download this version and install." }, "1.2.3", "jparr721/aproprose", assets)).toThrow(/placeholder/);
    expect(() => validateManifest(manifest(), "1.2.3", "jparr721/aproprose", assets.slice(0, 3))).toThrow(/Arch/);
    const query = manifest();
    query.platforms["darwin-aarch64"].url += "?download=another-asset";
    expect(() => validateManifest(query, "1.2.3", "jparr721/aproprose", assets)).toThrow(/URL/);
  });
});
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
it("cryptographically rejects an altered updater artifact", () => {
  const directory = mkdtempSync(join(tmpdir(), "aproprose-signature-")); directories.push(directory);
  const artifact = join(directory, "artifact");
  const publicKey = join(directory, "public.key");
  const secretKey = join(directory, "secret.key");
  execFileSync("minisign", ["-G", "-W", "-p", publicKey, "-s", secretKey]);
  writeFileSync(artifact, "original updater artifact");
  execFileSync("minisign", ["-S", "-s", secretKey, "-m", artifact]);
  const key = readFileSync(publicKey).toString("base64");
  const signature = readFileSync(`${artifact}.minisig`).toString("base64");
  expect(() => verifyArtifactSignature(artifact, key, signature)).not.toThrow();
  writeFileSync(artifact, "tampered updater artifact");
  expect(() => verifyArtifactSignature(artifact, key, signature)).toThrow(/signature/);
});

describe("artifact launch observation", () => {
  it.runIf(process.platform === "darwin")("prepares a compiled observer before inspecting the application", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aproprose-window-observer-"));
    directories.push(directory);
    const observeWindow = await prepareMacWindowObserver(directory);
    expect(readFileSync(join(directory, "window-observer")).byteLength).toBeGreaterThan(0);
    await expect(observeWindow(process.pid)).resolves.toBe(false);
    await expect(observeWindow(process.pid)).resolves.toBe(false);
  }, 120_000);

  it("fails when the launched process exits before the settle interval", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(7)"], { stdio: "ignore" });
    await expect(observeApplication(child, async () => true, 1_000, 400)).rejects.toThrow(/exited/);
  });

  it("fails a live process that never creates a visible window", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" });
    try {
      await expect(observeApplication(child, async () => false, 100, 10)).rejects.toThrow(/window/);
    } finally { child.kill(); }
  });

  it("accepts a visible window only while its process remains alive", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" });
    try {
      await expect(observeApplication(child, async () => true, 500, 30)).resolves.toBeUndefined();
    } finally { child.kill(); }
  });

  it("rejects process exit while confirming the settled window", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" });
    let probes = 0;
    try {
      await expect(observeApplication(child, async () => {
        probes += 1;
        if (probes === 2) {
          child.kill();
          await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
        }
        return true;
      }, 1_000, 10)).rejects.toThrow(/exited/);
    } finally { child.kill(); }
  });
});
