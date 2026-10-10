import { spawn } from "node:child_process";

const PROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$raw=[Console]::In.ReadToEnd()",
  "$bytes=[Text.Encoding]::UTF8.GetBytes($raw)",
  "$prot=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,'CurrentUser')",
  "[Console]::Out.Write([Convert]::ToBase64String($prot))",
].join("\n");

const UNPROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$raw=[Console]::In.ReadToEnd().Trim()",
  "$bytes=[Convert]::FromBase64String($raw)",
  "$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,'CurrentUser')",
  "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
].join("\n");

export async function protectSecret(secret: string): Promise<string> {
  if (process.platform !== "win32") {
    return `plain:${Buffer.from(secret, "utf8").toString("base64")}`;
  }
  return runPowerShell(PROTECT_SCRIPT, secret);
}

export async function unprotectSecret(protectedValue: string): Promise<string> {
  if (protectedValue.startsWith("plain:")) {
    return Buffer.from(protectedValue.slice("plain:".length), "base64").toString("utf8");
  }
  if (process.platform !== "win32") {
    throw new Error("DPAPI secrets can only be read on Windows");
  }
  return runPowerShell(UNPROTECT_SCRIPT, protectedValue);
}

function runPowerShell(script: string, input: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `powershell exited with code ${code}`));
      }
    });
    child.stdin.end(input, "utf8");
  });
}
