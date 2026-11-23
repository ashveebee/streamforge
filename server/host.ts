import os from 'node:os';
import si from 'systeminformation';
import { config } from './config.js';

/*
 * Metrics for the machine running the StreamForge backend. When StreamForge
 * is deployed on the media server itself (the common case), this is the
 * server's CPU/RAM/network.
 */

interface HostSample {
  t: number;
  cpu: number;
  mem: number;
  rx: number;
  tx: number;
}

const history: HostSample[] = [];
const MAX = 120;
let static_: { hostname: string; platform: string; distro?: string; cpuModel: string; cores: number; memTotal: number } | undefined;
let latest: {
  cpu: number;
  perCore: number[];
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  rx: number;
  tx: number;
  load: number[];
  uptime: number;
  temperature?: number;
} | undefined;
let filesystems: { mount: string; fs: string; type: string; size: number; used: number; available: number; usage: number }[] = [];
let lastError: string | undefined;

async function sample() {
  try {
    const [load, mem, net, temp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.networkStats('*'),
      si.cpuTemperature().catch(() => undefined),
    ]);
    const physical = net.filter((n) => n.iface !== 'lo' && !n.iface.startsWith('veth'));
    const rx = Math.max(0, physical.reduce((a, n) => a + (n.rx_sec ?? 0), 0));
    const tx = Math.max(0, physical.reduce((a, n) => a + (n.tx_sec ?? 0), 0));
    latest = {
      cpu: load.currentLoad,
      perCore: load.cpus.map((c) => c.load),
      memUsed: mem.active,
      memTotal: mem.total,
      swapUsed: mem.swapused,
      swapTotal: mem.swaptotal,
      rx,
      tx,
      load: os.loadavg(),
      uptime: os.uptime(),
      temperature: temp?.main ?? undefined,
    };
    history.push({ t: Date.now(), cpu: load.currentLoad, mem: mem.active / mem.total, rx, tx });
    if (history.length > MAX) history.shift();
    lastError = undefined;
  } catch (err) {
    lastError = (err as Error).message;
  }
}

async function sampleDisks() {
  try {
    const list = await si.fsSize();
    const seen = new Set<string>();
    filesystems = list
      .filter((f) => f.size > 1e9 && !/^(tmpfs|overlay|squashfs|devtmpfs)$/.test(f.type))
      .filter((f) => !seen.has(f.fs) && seen.add(f.fs))
      .map((f) => ({
        mount: f.mount,
        fs: f.fs,
        type: f.type,
        size: f.size,
        used: f.used,
        available: f.available,
        usage: f.size ? f.used / f.size : 0,
      }));
  } catch {
    /* keep previous */
  }
}

export function hostSnapshot() {
  return {
    enabled: config.hostMetrics,
    info: static_,
    current: latest,
    history,
    filesystems,
    error: lastError,
  };
}

export async function startHostMetrics() {
  if (!config.hostMetrics) return;
  const [osInfo, cpu] = await Promise.all([si.osInfo().catch(() => undefined), si.cpu().catch(() => undefined)]);
  static_ = {
    hostname: os.hostname(),
    platform: os.platform(),
    distro: osInfo ? `${osInfo.distro} ${osInfo.release}`.trim() : undefined,
    cpuModel: cpu ? `${cpu.manufacturer} ${cpu.brand}`.trim() : (os.cpus()[0]?.model ?? 'CPU'),
    cores: os.cpus().length,
    memTotal: os.totalmem(),
  };
  await sample();
  await sampleDisks();
  setInterval(() => void sample(), config.hostMetricsIntervalMs).unref();
  setInterval(() => void sampleDisks(), 60_000).unref();
}
