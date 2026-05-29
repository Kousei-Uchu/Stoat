import { Client } from 'discord-rpc';
import logger from '../logger';

const ActivityType = { Listening: 2 };

let discord: InstanceType<typeof Client> | null = null;
let isConnected = false;
let isConnecting = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastPayload: any = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const defaultPayload = {
  pid: process.pid,
  activity: {
    timestamps: { start: Date.now() },
    details: 'Nora',
    assets: {
      large_image: 'nora_logo',
      small_image: 'song_artwork',
    },
    instance: true,
    type: ActivityType.Listening,
  },
};

export function Initialize() {
  const DISCORD_CLIENT_ID = import.meta.env.MAIN_VITE_DISCORD_CLIENT_ID;
  if (!DISCORD_CLIENT_ID) {
    // No client ID configured — RPC is disabled; log once at debug level only
    logger.debug('Discord RPC: no client ID configured, skipping.');
    return;
  }

  if (discord || isConnecting) return;
  isConnecting = true;

  try {
    discord = new Client({ transport: 'ipc' });

    discord.on('ready', () => {
      isConnected = true;
      isConnecting = false;
      logger.debug('Discord RPC connected.');
      // Send any queued payload
      if (lastPayload) {
        try { discord?.request('SET_ACTIVITY', lastPayload); } catch { /* best-effort */ }
      }
    });

    discord.on('disconnected', () => {
      isConnected = false;
      isConnecting = false;
      discord = null;
      scheduleReconnect();
    });

    discord.on('error', (err) => {
      logger.debug('Discord RPC error', { err: String(err) });
      isConnected = false;
      isConnecting = false;
      discord = null;
      scheduleReconnect();
    });

    discord.login({ clientId: DISCORD_CLIENT_ID }).catch((err) => {
      logger.debug('Discord RPC login failed', { err: String(err) });
      isConnected = false;
      isConnecting = false;
      discord = null;
      scheduleReconnect();
    });
  } catch (err) {
    logger.debug('Discord RPC init error', { err: String(err) });
    isConnected = false;
    isConnecting = false;
    discord = null;
    scheduleReconnect();
  }
}

function scheduleReconnect(delayMs = 30_000) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    Initialize();
  }, delayMs).unref();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setDiscordRPC(data: any | null) {
  const payload = data
    ? {
        pid: process.pid,
        activity: {
          ...data,
          instance: true,
          type: ActivityType.Listening,
        },
      }
    : defaultPayload;

  lastPayload = payload;

  if (!isConnected || !discord) {
    // Not connected — store payload and try to connect
    Initialize();
    return;
  }

  try {
    discord.request('SET_ACTIVITY', payload);
    logger.debug('Discord RPC activity set.');
  } catch (err) {
    logger.debug('Discord RPC SET_ACTIVITY failed', { err: String(err) });
    isConnected = false;
    discord = null;
    scheduleReconnect(5_000);
  }
}

export function destroyDiscordRPC() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try { discord?.destroy(); } catch { /* best-effort */ }
  discord = null;
  isConnected = false;
  isConnecting = false;
}
