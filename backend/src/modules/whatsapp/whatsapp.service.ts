import { AppError } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const BRIDGE_PORT = 18765;
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;

let bridgeProcess: any = null;

function resolveBridgeDir(): string {
  // If running from backend/ directory:
  const p1 = path.resolve(process.cwd(), '../whatsapp_bridge');
  if (fs.existsSync(p1)) return p1;
  // If running from root:
  const p2 = path.resolve(process.cwd(), 'whatsapp_bridge');
  if (fs.existsSync(p2)) return p2;
  return p1;
}

export function ensureBridgeRunning(): void {
  if (bridgeProcess && !bridgeProcess.killed) return;
  const bridgeDir = resolveBridgeDir();
  const startFile = path.join(bridgeDir, 'start.mjs');
  if (!fs.existsSync(startFile)) return;

  try {
    bridgeProcess = spawn('node', ['start.mjs'], {
      cwd: bridgeDir,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    // `killed` only says whether WE asked it to stop. A bridge that dies or is
    // stopped from outside left this reference in place, so the backend
    // believed it was still running and never started another — the status
    // then sat at DISCONNECTED until the whole backend was restarted.
    bridgeProcess.once('exit', () => {
      bridgeProcess = null;
    });
    bridgeProcess.unref();
  } catch (err) {
    console.error('[WhatsApp Bridge] Failed to auto-start bridge:', err);
  }
}

export async function getBridgeStatus(): Promise<{
  state: 'CONNECTED' | 'QR' | 'CONNECTING' | 'LOGGED_OUT' | 'DISCONNECTED' | 'ERROR';
  qr?: string;
  phone?: string;
  error?: string;
  updated_at?: number;
}> {
  try {
    const res = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      return (await res.json()) as any;
    }
  } catch {
    // If bridge is down, trigger auto-start
    ensureBridgeRunning();
  }
  return { state: 'DISCONNECTED', qr: '', phone: '', error: '' };
}

export async function startBridgeSocket(): Promise<{
  state: string;
  qr?: string;
  phone?: string;
  error?: string;
}> {
  ensureBridgeRunning();
  try {
    const res = await fetch(`${BRIDGE_URL}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      return (await res.json()) as any;
    }
  } catch {
    // Bridge might be booting
  }
  return await getBridgeStatus();
}

export async function logoutBridge(): Promise<{ ok: boolean; state: string }> {
  const data = await callBridge<{ ok?: boolean; state: string }>('/logout', {}, 15_000);
  return { ok: data.ok ?? true, state: data.state };
}

/**
 * One way to talk to the bridge, so every call gets the same three things the
 * individual fetches used to skip:
 *
 *  - a timeout — a hung bridge held the bill-send request open indefinitely;
 *  - a clear message when the bridge is not running at all, instead of Node's
 *    "fetch failed" surfacing as a bare 500;
 *  - the bridge's own error text passed through as a 422/503 the screen can
 *    show, rather than a plain Error the central handler turns into a
 *    generic "something went wrong".
 */
async function callBridge<T>(route: string, body: unknown, timeoutMs: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BRIDGE_URL}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    ensureBridgeRunning();
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new AppError(
      503,
      'WHATSAPP_UNAVAILABLE',
      timedOut
        ? 'WhatsApp ne jawab nahi diya. Thodi der baad dubara bhejiye.'
        : 'WhatsApp bridge chal nahi raha. WhatsApp Connect khol kar dobara jodiye.',
    );
  }

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new AppError(422, 'WHATSAPP_SEND_FAILED', data.error || 'WhatsApp par nahi bheja ja saka.');
  }
  return data;
}

/**
 * Refuses up front when the linked phone is not connected. The bridge keeps
 * a socket object around while it is still connecting or showing a QR, and a
 * send in that state either fails with an internal Baileys error or queues
 * silently — the counter was told "sent" for bills that never left.
 */
/**
 * While WHATSAPP_ALLOWED_NUMBERS is set, only those numbers can be messaged.
 *
 * The demo data is full of plausible-looking mobile numbers, and one of them
 * is the shop's own linked phone; a bill sent to any of the others would land
 * on a stranger. Every send goes through here, so nothing can slip past it.
 */
export function assertAllowedRecipient(phone: string): void {
  const allowed = env.whatsappAllowedNumbers;
  if (allowed.length === 0) return;
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (!allowed.includes(digits)) {
    throw new AppError(
      403,
      'WHATSAPP_RECIPIENT_BLOCKED',
      `Abhi sirf test number par WhatsApp jaata hai (${allowed.join(', ')}). ${digits} par nahi bheja.`,
    );
  }
}

async function assertConnected(): Promise<void> {
  const status = await getBridgeStatus();
  if (status.state !== 'CONNECTED') {
    throw new AppError(
      409,
      'WHATSAPP_NOT_CONNECTED',
      'WhatsApp juda nahi hai. WhatsApp Connect par QR scan karke phir bhejiye.',
      { state: status.state },
    );
  }
}

export async function sendTextMessage(phone: string, text: string): Promise<{ id: string }> {
  assertAllowedRecipient(phone);
  await assertConnected();
  return callBridge('/send', { phone, text }, 20_000);
}

export async function sendImageMessage(
  phone: string,
  imageBase64: string,
  caption?: string,
  mimetype?: string,
): Promise<{ id: string }> {
  assertAllowedRecipient(phone);
  await assertConnected();
  const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
  return callBridge(
    '/send-image',
    { phone, image_base64: cleanBase64, caption, mimetype: mimetype || 'image/png' },
    45_000,
  );
}

export async function sendDocumentMessage(
  phone: string,
  documentBase64: string,
  filename: string,
  caption?: string,
  mimetype?: string,
): Promise<{ id: string }> {
  assertAllowedRecipient(phone);
  await assertConnected();
  const cleanBase64 = documentBase64.replace(/^data:application\/[a-zA-Z0-9+.-]+;base64,/, '');
  return callBridge(
    '/send-document',
    {
      phone,
      document_base64: cleanBase64,
      filename,
      caption,
      mimetype: mimetype || 'application/pdf',
    },
    45_000,
  );
}
