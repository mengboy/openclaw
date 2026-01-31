import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type AuthProfileCredential =
  | {
      type: "api_key";
      provider: string;
      key: string;
      email?: string;
    }
  | {
      type: "token";
      provider: string;
      token: string;
      expires?: number;
      email?: string;
    }
  | {
      type: "oauth";
      provider: string;
      access: string;
      refresh: string;
      expires: number;
      accountId?: string;
      email?: string;
      clientId?: string;
      enterpriseUrl?: string;
      projectId?: string;
    };

type AuthProfileStore = {
  version: number;
  profiles: Record<string, AuthProfileCredential>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
  usageStats?: Record<string, unknown>;
};

type Args = {
  authPath?: string;
  codexHome?: string;
  agentDir?: string;
  profileId?: string;
  email?: string;
  dryRun?: boolean;
};

function printUsage(): void {
  const lines = [
    "Usage: bun scripts/import-codex-auth.ts [options]",
    "",
    "Options:",
    "  --auth-path <path>   Path to Codex auth.json (default: ~/.codex/auth.json)",
    "  --codex-home <path>  Use Codex home dir; auth.json is resolved under it",
    "  --agent-dir <path>   Target agent dir (default: resolveOpenClawAgentDir())",
    "  --profile-id <id>    Auth profile id (default: openai-codex:<email|default>)",
    "  --email <email>      Optional email to attach + derive profile id",
    "  --dry-run            Print what would be written, but do not write",
    "  -h, --help           Show this help",
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }
    const next = argv[i + 1];
    if (arg === "--auth-path" && next) {
      args.authPath = next;
      i += 1;
      continue;
    }
    if (arg === "--codex-home" && next) {
      args.codexHome = next;
      i += 1;
      continue;
    }
    if (arg === "--agent-dir" && next) {
      args.agentDir = next;
      i += 1;
      continue;
    }
    if (arg === "--profile-id" && next) {
      args.profileId = next;
      i += 1;
      continue;
    }
    if (arg === "--email" && next) {
      args.email = next;
      i += 1;
      continue;
    }
  }
  return args;
}

function resolveAuthPath(args: Args): string {
  if (args.authPath) return resolveUserPath(args.authPath);
  const codexHome = args.codexHome ?? process.env.CODEX_HOME ?? "~/.codex";
  return path.join(resolveUserPath(codexHome), "auth.json");
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

function resolveStateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  const home = os.homedir();
  const newDir = path.join(home, ".openclaw");
  const legacyDirs = [".clawdbot", ".moltbot", ".moldbot"].map((dir) => path.join(home, dir));
  if (fs.existsSync(newDir)) return newDir;
  const existingLegacy = legacyDirs.find((dir) => {
    try {
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  });
  return existingLegacy ?? newDir;
}

function resolveOpenClawAgentDir(): string {
  const override =
    process.env.OPENCLAW_AGENT_DIR?.trim() || process.env.PI_CODING_AGENT_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(resolveStateDir(), "agents", "main", "agent");
}

function loadAuthProfileStore(authPath: string): AuthProfileStore {
  if (!fs.existsSync(authPath)) {
    return { version: 1, profiles: {} };
  }
  const raw = fs.readFileSync(authPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<AuthProfileStore>;
  if (!parsed || typeof parsed !== "object" || !parsed.profiles) {
    return { version: 1, profiles: {} };
  }
  return {
    version: typeof parsed.version === "number" ? parsed.version : 1,
    profiles: parsed.profiles ?? {},
    order: parsed.order,
    lastGood: parsed.lastGood,
    usageStats: parsed.usageStats,
  };
}

function saveAuthProfileStore(authPath: string, store: AuthProfileStore): void {
  const payload: AuthProfileStore = {
    version: 1,
    profiles: store.profiles,
    order: store.order,
    lastGood: store.lastGood,
    usageStats: store.usageStats,
  };
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readCodexAuth(authPath: string): {
  access: string;
  refresh: string;
  accountId?: string;
  expires: number;
} {
  const raw = fs.readFileSync(authPath, "utf8");
  const data = JSON.parse(raw) as Record<string, unknown>;
  const tokens = data.tokens as Record<string, unknown> | undefined;
  if (!tokens || typeof tokens !== "object") {
    throw new Error("Invalid auth.json: missing tokens object.");
  }
  const access = tokens.access_token;
  const refresh = tokens.refresh_token;
  if (typeof access !== "string" || !access) {
    throw new Error("Invalid auth.json: missing tokens.access_token.");
  }
  if (typeof refresh !== "string" || !refresh) {
    throw new Error("Invalid auth.json: missing tokens.refresh_token.");
  }

  let expires: number;
  try {
    const stat = fs.statSync(authPath);
    expires = stat.mtimeMs + 60 * 60 * 1000;
  } catch {
    expires = Date.now() + 60 * 60 * 1000;
  }

  const accountId = typeof tokens.account_id === "string" ? tokens.account_id : undefined;
  return { access, refresh, accountId, expires };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const authPath = resolveAuthPath(args);
  if (!fs.existsSync(authPath)) {
    throw new Error(`Codex auth file not found: ${authPath}`);
  }

  const { access, refresh, accountId, expires } = readCodexAuth(authPath);
  const email = args.email?.trim();
  const profileId =
    args.profileId?.trim() ?? `openai-codex:${email && email.length > 0 ? email : "default"}`;

  const credential: AuthProfileCredential = {
    type: "oauth",
    provider: "openai-codex",
    access,
    refresh,
    expires,
    ...(accountId ? { accountId } : {}),
    ...(email ? { email } : {}),
  };

  const agentDir = args.agentDir ? resolveUserPath(args.agentDir) : resolveOpenClawAgentDir();
  const authProfilesPath = path.join(agentDir, "auth-profiles.json");

  if (args.dryRun) {
    const payload = {
      agentDir,
      profileId,
      credential,
      authPath,
      authProfilesPath,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const store = loadAuthProfileStore(authProfilesPath);
  store.profiles[profileId] = credential;
  saveAuthProfileStore(authProfilesPath, store);
  // eslint-disable-next-line no-console
  console.log(
    `Imported Codex auth into ${authProfilesPath} as ${profileId}.`,
  );
}

try {
  main();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
