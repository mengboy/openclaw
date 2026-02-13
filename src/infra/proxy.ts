import { ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("infra/proxy");

let appliedProxyUrl: string | null = null;

export function resolveProxyUrlFromEnv(env: NodeJS.ProcessEnv): string | null {
  const httpsProxy = env.HTTPS_PROXY?.trim() || env.https_proxy?.trim();
  if (httpsProxy) {
    return httpsProxy;
  }
  const httpProxy = env.HTTP_PROXY?.trim() || env.http_proxy?.trim();
  if (httpProxy) {
    return httpProxy;
  }
  const allProxy = env.ALL_PROXY?.trim() || env.all_proxy?.trim();
  if (allProxy) {
    return allProxy;
  }
  return null;
}

function maskProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? "user" : "";
      parsed.password = parsed.password ? "pass" : "";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function applyGlobalProxyFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const proxyUrl = resolveProxyUrlFromEnv(env);
  if (!proxyUrl) {
    return;
  }
  if (appliedProxyUrl === proxyUrl) {
    return;
  }

  try {
    const agent = new ProxyAgent(proxyUrl);
    const current = getGlobalDispatcher();
    if (current === agent) {
      return;
    }
    setGlobalDispatcher(agent);
    appliedProxyUrl = proxyUrl;
    log.info("applied global proxy agent", { proxy: maskProxyUrl(proxyUrl) });
  } catch (error) {
    log.warn("failed to apply global proxy agent", {
      proxy: maskProxyUrl(proxyUrl),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
