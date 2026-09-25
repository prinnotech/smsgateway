"use client";

import { createClient } from "@/lib/pb";
import type {
  ApiKeyRecord,
  CampaignRecord,
  DeviceRecord,
  MessageRecord,
  MessageStatus,
} from "@/types/pb";

const pb = createClient();

function simOfDevice(d: DeviceRecord): number | undefined {
  return d.subscription_id ?? d.sim_slot ?? undefined;
}

// PocketBase datetime format.
function pbDate(d: Date) {
  return d.toISOString().replace("T", " ");
}

// A reasonably long, URL-safe random token for a phone's API key.
export function generateKey(): string {
  const bytes = new Uint8Array(30);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36])
    .join("");
}

// ---- API keys -------------------------------------------------------------

export function listApiKeys(userId: string) {
  return pb.collection("api_keys").getFullList<ApiKeyRecord>({
    filter: `user = "${userId}"`,
    sort: "-created",
  });
}

export function createApiKey(userId: string, name: string) {
  return pb.collection("api_keys").create<ApiKeyRecord>({
    user: userId,
    name,
    key: generateKey(),
  });
}

export function deleteApiKey(id: string) {
  return pb.collection("api_keys").delete(id);
}

// ---- Devices --------------------------------------------------------------

export function listDevices(apiKeyId: string) {
  return pb.collection("devices").getFullList<DeviceRecord>({
    filter: `api_key = "${apiKeyId}"`,
    sort: "sim_slot",
  });
}

// All devices belonging to the current user (across every key).
export function listUserDevices(userId: string) {
  return pb.collection("devices").getFullList<DeviceRecord>({
    filter: `api_key.user = "${userId}"`,
    sort: "-created",
    expand: "api_key",
  });
}

export function createDevice(data: Partial<DeviceRecord>) {
  return pb.collection("devices").create<DeviceRecord>(data);
}

export function updateDevice(id: string, data: Partial<DeviceRecord>) {
  return pb.collection("devices").update<DeviceRecord>(id, data);
}

export function deleteDevice(id: string) {
  return pb.collection("devices").delete(id);
}

// ---- Messages -------------------------------------------------------------

export interface MessageFilters {
  direction?: "out" | "in";
  status?: MessageStatus;
  search?: string;
}

export function listMessages(
  userId: string,
  filters: MessageFilters = {},
  page = 1,
  perPage = 50
) {
  const parts = [`device.api_key.user = "${userId}"`];
  if (filters.direction) parts.push(`direction = "${filters.direction}"`);
  if (filters.status) parts.push(`status = "${filters.status}"`);
  if (filters.search) {
    const s = filters.search.replace(/"/g, '');
    parts.push(`(to ~ "${s}" || from ~ "${s}" || body ~ "${s}")`);
  }
  return pb.collection("messages").getList<MessageRecord>(page, perPage, {
    filter: parts.join(" && "),
    sort: "-created",
    expand: "device,device.api_key",
  });
}

// Build the same filter listMessages uses (for fetching all matching rows).
function messageFilter(userId: string, filters: MessageFilters) {
  const parts = [`device.api_key.user = "${userId}"`];
  if (filters.direction) parts.push(`direction = "${filters.direction}"`);
  if (filters.status) parts.push(`status = "${filters.status}"`);
  if (filters.search) {
    const s = filters.search.replace(/"/g, "");
    parts.push(`(to ~ "${s}" || from ~ "${s}" || body ~ "${s}")`);
  }
  return parts.join(" && ");
}

// All rows matching the current filter (across every page). Used by "copy
// numbers" and "retry all".
export function listAllMessages(userId: string, filters: MessageFilters = {}) {
  return pb.collection("messages").getFullList<MessageRecord>({
    filter: messageFilter(userId, filters),
    sort: "-created",
    expand: "device",
  });
}

export interface NewMessage {
  device: string;
  to: string;
  body: string;
  sim?: number;
  sendAt?: string; // ISO string; when set the message is scheduled
}

export function createMessage(m: NewMessage) {
  const scheduled = Boolean(m.sendAt);
  return pb.collection("messages").create<MessageRecord>({
    device: m.device,
    direction: "out",
    to: m.to,
    body: m.body,
    sim: m.sim,
    status: scheduled ? "scheduled" : "pending",
    send_at: m.sendAt || "",
  });
}

// Re-queue an existing message on the SAME record (increments its retry count)
// rather than creating a duplicate. Optionally send from a different device.
export function resendMessage(
  m: MessageRecord,
  target?: { device: string; sim?: number }
) {
  return pb.collection("messages").update<MessageRecord>(m.id, {
    device: target?.device ?? m.device,
    sim: target ? target.sim : m.sim,
    status: "pending",
    error: "",
    retries: (m.retries ?? 0) + 1,
    send_at: "",
  });
}

// Re-queue many messages (e.g. "retry all failed").
export async function resendMany(
  list: MessageRecord[],
  target?: { device: string; sim?: number }
) {
  const results = await Promise.allSettled(
    list.map((m) => resendMessage(m, target))
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  return { ok, failed: results.length - ok };
}

// Create many outgoing messages efficiently (bulk send).
export async function createMessages(list: NewMessage[]) {
  const results = await Promise.allSettled(list.map((m) => createMessage(m)));
  const ok = results.filter((r) => r.status === "fulfilled").length;
  return { ok, failed: results.length - ok };
}

// ---- Stats ----------------------------------------------------------------

export async function countMessages(
  userId: string,
  status?: MessageStatus,
  direction?: "out" | "in"
) {
  const parts = [`device.api_key.user = "${userId}"`];
  if (status) parts.push(`status = "${status}"`);
  if (direction) parts.push(`direction = "${direction}"`);
  const res = await pb.collection("messages").getList<MessageRecord>(1, 1, {
    filter: parts.join(" && "),
    fields: "id",
  });
  return res.totalItems;
}

// ---- Campaigns ------------------------------------------------------------

export interface NewCampaign {
  name: string;
  body: string;
  ratePerMin: number; // total messages released per minute
  devices: DeviceRecord[]; // one or more targets (round-robin)
  recipients: string[];
}

// Create a campaign and queue all its messages, staggering send_at so the
// phone releases them at ~ratePerMin. Uses PocketBase's batch API for speed.
export async function createCampaign(c: NewCampaign) {
  const campaign = await pb.collection("campaigns").create<CampaignRecord>({
    name: c.name,
    device: c.devices[0]?.id,
    body: c.body,
    rate_per_min: c.ratePerMin,
    status: "running",
    total: c.recipients.length,
  });

  const start = Date.now();
  const spacingMs = c.ratePerMin > 0 ? 60000 / c.ratePerMin : 0;
  const CHUNK = 500;

  for (let i = 0; i < c.recipients.length; i += CHUNK) {
    const batch = pb.createBatch();
    for (let j = i; j < Math.min(i + CHUNK, c.recipients.length); j++) {
      const d = c.devices[j % c.devices.length];
      const due = start + Math.floor(j) * spacingMs;
      const scheduled = spacingMs > 0 && due > Date.now();
      batch.collection("messages").create({
        device: d.id,
        campaign: campaign.id,
        direction: "out",
        to: c.recipients[j],
        body: c.body,
        sim: simOfDevice(d),
        status: scheduled ? "scheduled" : "pending",
        send_at: scheduled ? pbDate(new Date(due)) : "",
      });
    }
    await batch.send();
  }

  return campaign;
}

export function listCampaigns(userId: string) {
  return pb.collection("campaigns").getFullList<CampaignRecord>({
    filter: `device.api_key.user = "${userId}"`,
    sort: "-created",
    expand: "device",
  });
}

export async function campaignStats(campaignId: string) {
  const statuses: MessageStatus[] = [
    "sent",
    "failed",
    "pending",
    "sending",
    "scheduled",
    "cancelled",
  ];
  const entries = await Promise.all(
    statuses.map(async (s) => {
      const res = await pb.collection("messages").getList<MessageRecord>(1, 1, {
        filter: `campaign = "${campaignId}" && status = "${s}"`,
        fields: "id",
      });
      return [s, res.totalItems] as const;
    })
  );
  return Object.fromEntries(entries) as Record<MessageStatus, number>;
}

// Stop a running campaign: mark it stopped and cancel everything not yet sent
// (pending / scheduled), so those numbers count as "not sent".
export async function stopCampaign(campaignId: string) {
  const pending = await pb.collection("messages").getFullList<MessageRecord>({
    filter: `campaign = "${campaignId}" && (status = "pending" || status = "scheduled")`,
    fields: "id",
  });
  for (let i = 0; i < pending.length; i += 500) {
    const batch = pb.createBatch();
    for (const m of pending.slice(i, i + 500)) {
      batch.collection("messages").update(m.id, { status: "cancelled", send_at: "" });
    }
    await batch.send();
  }
  return pb.collection("campaigns").update<CampaignRecord>(campaignId, {
    status: "stopped",
  });
}

export function deleteCampaign(id: string) {
  return pb.collection("campaigns").delete(id);
}

export function setCampaignCompleted(id: string) {
  return pb
    .collection("campaigns")
    .update<CampaignRecord>(id, { status: "completed" });
}

// Recipients of a campaign filtered by outcome, for the sent / not-sent lists.
export function listCampaignNumbers(
  campaignId: string,
  statuses: MessageStatus[]
) {
  const statusFilter = statuses.map((s) => `status = "${s}"`).join(" || ");
  return pb.collection("messages").getFullList<MessageRecord>({
    filter: `campaign = "${campaignId}" && (${statusFilter})`,
    fields: "to,status,error",
    sort: "created",
  });
}
