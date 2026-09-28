import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { piDataDir } from "./paths";

/** This extension's own file, in pi's agent directory. Still read, as the last resort. */
export const CONFIG_FILE_NAME = "pi-fff.json";
/** pi's native extension-config tree: `<agentDir>/extension-configs/<dir>/<file>.jsonc`. */
export const EXTENSION_CONFIG_DIR = "pi-fff";
export const EXTENSION_CONFIG_FILE = "fff.jsonc";
/** The name that convention implies, taken as well: every other pi-native extension is `<dir>/<dir>.jsonc`. */
export const EXTENSION_CONFIG_FILE_ALT = "pi-fff.jsonc";

/**
 * The config files this extension reads, in order; the first one that exists wins.
 *
 * The extension-config tree first, because that is where a pi-native extension's knobs live in the
 * workspace this fork serves; `pi-fff.json` last, so an upstream user's existing file keeps working.
 */
export function configPaths(agentDir: string = piDataDir()): string[] {
  return [
    join(agentDir, "extension-configs", EXTENSION_CONFIG_DIR, EXTENSION_CONFIG_FILE),
    join(agentDir, "extension-configs", EXTENSION_CONFIG_DIR, EXTENSION_CONFIG_FILE_ALT),
    join(agentDir, CONFIG_FILE_NAME),
  ];
}
export const VALID_MODES = ["tools-and-ui", "tools-only", "override", "engine-only"] as const;

export type FffMode = (typeof VALID_MODES)[number];

export interface FffConfig {
  $schema?: string;
  mode?: FffMode;
  frecencyDbPath?: string;
  historyDbPath?: string;
  enableFsRootScanning?: boolean;
  enableHomeDirScanning?: boolean;
  warnOnHomeDirScan?: boolean;
  followSymlinks?: boolean;
}

const CONFIG_KEYS = new Set<keyof FffConfig>([
  "$schema",
  "mode",
  "frecencyDbPath",
  "historyDbPath",
  "enableFsRootScanning",
  "enableHomeDirScanning",
  "warnOnHomeDirScan",
  "followSymlinks",
]);

export function loadConfig(agentDir = piDataDir()): FffConfig {
  const configPath = configPaths(agentDir).find((candidate) => existsSync(candidate));
  if (!configPath) return {};

  let contents: string;

  try {
    contents = readFileSync(configPath, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `Could not read pi-fff config at ${configPath}: ${errorMessage(error)}`,
    );
  }

  let parsed: unknown;
  try {
    // A `.jsonc` file may carry comments and trailing commas; a strict JSON file is valid input to the
    // same reader, so one parse path serves every location.
    parsed = JSON.parse(stripJsonc(contents));
  } catch (error: unknown) {
    throw invalidConfig(configPath, `not valid JSON (${errorMessage(error)})`);
  }

  if (!isRecord(parsed)) {
    throw invalidConfig(configPath, "expected a JSON object");
  }

  for (const key of Object.keys(parsed)) {
    if (!CONFIG_KEYS.has(key as keyof FffConfig)) {
      throw invalidConfig(configPath, `unknown option "${key}"`);
    }
  }

  if (parsed.mode !== undefined && !VALID_MODES.includes(parsed.mode as FffMode)) {
    throw invalidConfig(configPath, `"mode" must be one of ${VALID_MODES.join(", ")}`);
  }

  validateString(configPath, parsed, "$schema");
  validateString(configPath, parsed, "frecencyDbPath");
  validateString(configPath, parsed, "historyDbPath");
  validateBoolean(configPath, parsed, "enableFsRootScanning");
  validateBoolean(configPath, parsed, "enableHomeDirScanning");
  validateBoolean(configPath, parsed, "warnOnHomeDirScan");
  validateBoolean(configPath, parsed, "followSymlinks");

  return parsed as FffConfig;
}

function invalidConfig(configPath: string, reason: string): Error {
  return new Error(`Invalid pi-fff config at ${configPath}: ${reason}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateString(
  configPath: string,
  config: Record<string, unknown>,
  key: "$schema" | "frecencyDbPath" | "historyDbPath",
): void {
  const value = config[key];
  if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
    throw invalidConfig(configPath, `"${key}" must be a non-empty string`);
  }
}

function validateBoolean(
  configPath: string,
  config: Record<string, unknown>,
  key:
    | "enableFsRootScanning"
    | "enableHomeDirScanning"
    | "warnOnHomeDirScan"
    | "followSymlinks",
): void {
  const value = config[key];
  if (value !== undefined && typeof value !== "boolean") {
    throw invalidConfig(configPath, `"${key}" must be a boolean`);
  }
}

/**
 * JSON with comments and trailing commas → JSON. String-aware, so `//` and `,}` inside a string survive.
 */
export function stripJsonc(text: string): string {
  let out = "";
  let inString = false;
  let pendingComma = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;

    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (pendingComma) {
      if (ch === "}" || ch === "]") {
        pendingComma = false;
        out += ch;
        continue;
      }
      if (/\s/.test(ch)) continue;
      out += ",";
      pendingComma = false;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }

    if (ch === ",") {
      pendingComma = true;
      continue;
    }

    out += ch;
  }

  return out;
}
