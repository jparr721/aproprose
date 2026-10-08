import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { z } from "zod";

const manifestSchema = z.object({
  version: z.string().min(1),
  notes: z.string().trim().min(1),
  platforms: z.record(z.string(), z.object({ url: z.url(), signature: z.string().min(1) })),
});
const requiredPlatforms = ["darwin-aarch64", "linux-x86_64", "windows-x86_64"];
const platformExtensions: Record<string, string> = { "darwin-aarch64": ".app.tar.gz", "linux-x86_64": ".AppImage", "windows-x86_64": ".exe" };
interface ReleaseArtifact { platform: string; name: string; signature: string }

export function validateManifest(input: unknown, version: string, repository: string, assets: string[]): ReleaseArtifact[] {
  const manifest = manifestSchema.parse(input);
  if (manifest.version !== version) throw new Error(`Updater version ${manifest.version} differs from tagged version ${version}`);
  if (manifest.notes === "See the assets to download this version and install.") throw new Error("Updater notes contain the default placeholder");
  if (!assets.some((name) => name.endsWith(".pkg.tar.zst"))) throw new Error("Arch package is not attached");
  return requiredPlatforms.map((platform) => {
    const entry = manifest.platforms[platform];
    if (entry === undefined) throw new Error(`Updater platform ${platform} is missing`);
    const url = new URL(entry.url);
    const prefix = `https://github.com/${repository}/releases/download/v${version}/`;
    if (!url.href.startsWith(prefix) || url.search !== "" || url.hash !== "") throw new Error(`Updater URL for ${platform} does not belong to the tagged release: ${entry.url}`);
    const name = decodeURIComponent(url.pathname.slice(new URL(prefix).pathname.length));
    if (name !== basename(name) || name.includes("\\") || !assets.includes(name)) throw new Error(`Updater asset ${name} is not attached to this release`);
    if (!name.endsWith(platformExtensions[platform])) throw new Error(`Updater artifact ${name} does not match platform ${platform}`);
    return { platform, name, signature: entry.signature };
  });
}

export function verifyArtifactSignature(artifact: string, publicKey: string, signature: string): void {
  const directory = mkdtempSync(join(tmpdir(), "aproprose-verify-"));
  try {
    const keyPath = join(directory, "public.key");
    const signaturePath = join(directory, "signature.minisig");
    writeFileSync(keyPath, Buffer.from(publicKey, "base64"));
    writeFileSync(signaturePath, Buffer.from(signature, "base64"));
    try {
      execFileSync("minisign", ["-Vm", artifact, "-p", keyPath, "-x", signaturePath], { stdio: "pipe", timeout: 30_000 });
    } catch (error) {
      throw new Error(`Updater signature verification failed for ${artifact}`, { cause: error });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function main(): void {
  const [directory, version, repository] = process.argv.slice(2);
  if (!directory || !version || !repository) throw new Error("Usage: bun scripts/validate-release-assets.ts <download-directory> <version> <owner/repo>");
  const config = z.object({ plugins: z.object({ updater: z.object({ pubkey: z.string() }) }) }).parse(JSON.parse(readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8")));
  const manifest: unknown = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
  const artifacts = validateManifest(manifest, version, repository, readdirSync(directory));
  for (const artifact of artifacts) verifyArtifactSignature(join(directory, artifact.name), config.plugins.updater.pubkey, artifact.signature);
  console.log(`Validated updater version, URLs, assets, and ${artifacts.length} cryptographic signatures`);
}
if (import.meta.main) main();
