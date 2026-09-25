"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/auth-context";
import {
  listUserDevices,
  createCampaign,
  listCampaigns,
  campaignStats,
  stopCampaign,
  deleteCampaign,
  setCampaignCompleted,
  listCampaignNumbers,
} from "@/lib/data";
import type {
  CampaignRecord,
  DeviceRecord,
  MessageStatus,
} from "@/types/pb";

function fieldClass() {
  return "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
}

function deviceLabel(d: DeviceRecord) {
  const key = (d.expand?.api_key as { name?: string } | undefined)?.name ?? "";
  const name = d.name || d.carrier || `SIM ${d.sim_slot ?? "?"}`;
  return key ? `${name} · ${key}` : name;
}

export default function CampaignsPage() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // form
  const [name, setName] = useState("");
  const [recipients, setRecipients] = useState("");
  const [addPlus, setAddPlus] = useState(true);
  const [prefix, setPrefix] = useState("");
  const [roundRobin, setRoundRobin] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [rate, setRate] = useState("60");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    if (!user?.id) return;
    setCampaigns(await listCampaigns(user.id));
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;
    listUserDevices(user.id).then((devs) => {
      setDevices(devs);
      if (devs[0]) setDeviceId(devs[0].id);
    });
    loadCampaigns();
  }, [user, loadCampaigns]);

  // Refresh campaign progress periodically while any is running.
  useEffect(() => {
    const anyRunning = campaigns.some((c) => c.status === "running");
    if (!anyRunning) return;
    const t = setInterval(loadCampaigns, 8000);
    return () => clearInterval(t);
  }, [campaigns, loadCampaigns]);

  const parsedRecipients = () =>
    recipients
      .split(/[\n,;]+/)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        let n = r;
        if (prefix && !n.startsWith("+") && !n.startsWith(prefix)) {
          n = prefix + n.replace(/^0+/, "");
        }
        if (addPlus && !n.startsWith("+")) n = "+" + n;
        return n;
      });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const nums = text
      .split(/\r?\n/)
      .map((line) => line.split(",")[0].trim())
      .filter(Boolean);
    setRecipients((prev) => (prev ? prev + "\n" : "") + nums.join("\n"));
    if (fileRef.current) fileRef.current.value = "";
  };

  const start = async () => {
    const targets = roundRobin
      ? devices.filter((d) => selected.includes(d.id))
      : devices.filter((d) => d.id === deviceId);
    const nums = parsedRecipients();
    const r = Number(rate) || 0;
    if (!name.trim() || targets.length === 0 || nums.length === 0 || !body.trim() || r <= 0) {
      setResult("Fill in a name, recipients, a SIM, a rate > 0, and a message.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await createCampaign({
        name: name.trim(),
        body,
        ratePerMin: r,
        devices: targets,
        recipients: nums,
      });
      const mins = Math.ceil(nums.length / r);
      setResult(
        `Campaign started: ${nums.length} numbers at ${r}/min (~${mins} min) across ${targets.length} SIM${targets.length > 1 ? "s" : ""}.`
      );
      setName("");
      setRecipients("");
      setBody("");
      loadCampaigns();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Failed to start campaign.");
    } finally {
      setBusy(false);
    }
  };

  const nums = parsedRecipients();
  const rateNum = Number(rate) || 0;
  const noDevices = devices.length === 0;

  const activeTargets = roundRobin
    ? devices.filter((d) => selected.includes(d.id))
    : devices.filter((d) => d.id === deviceId);
  const lowTargets = activeTargets.filter(
    (d) => (d.low_balance ?? 0) > 0 && (d.balance ?? 0) <= (d.low_balance ?? 0)
  );

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Campaigns
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Paste a big list and drip it out at a fixed rate. Stop any time — sent
          and not-sent numbers are tracked.
        </p>
      </div>

      {noDevices ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Connect a phone first (a device must exist to send from).
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Campaign name (e.g. October promo)"
            className={fieldClass() + " mb-4"}
          />

          <label className="mb-1 flex items-center justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <span>Recipients (one per line)</span>
            <button
              onClick={() => fileRef.current?.click()}
              className="text-xs font-normal text-indigo-600 hover:underline"
            >
              Upload .txt / .csv
            </button>
          </label>
          <textarea
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            rows={6}
            placeholder={"5551234567\n5559876543\n… paste up to thousands"}
            className={fieldClass()}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            onChange={onFile}
            className="hidden"
          />
          <div className="mt-2 flex items-center gap-2">
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="Prefix (e.g. 1 or 44)"
              className="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <span className="text-xs text-zinc-400">{nums.length} recipients</span>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={addPlus} onChange={(e) => setAddPlus(e.target.checked)} />
            Add “+” to numbers that don&apos;t have one
          </label>

          <div className="mt-4">
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={roundRobin} onChange={(e) => setRoundRobin(e.target.checked)} />
              Round-robin across multiple SIMs
            </label>
            {roundRobin ? (
              <div className="space-y-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                {devices.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={() =>
                        setSelected((p) => (p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id]))
                      }
                    />
                    {deviceLabel(d)}
                  </label>
                ))}
              </div>
            ) : (
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className={fieldClass()}>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deviceLabel(d)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Rate — numbers per minute
            </label>
            <input
              type="number"
              min={1}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className={fieldClass()}
            />
            <p className="mt-1 text-xs text-zinc-400">
              {rateNum > 0
                ? `≈ one every ${(60 / rateNum).toFixed(1)}s${
                    nums.length ? ` · ${nums.length} numbers → ~${Math.ceil(nums.length / rateNum)} min` : ""
                  }`
                : "Set a rate greater than 0."}
            </p>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Your message…"
              className={fieldClass()}
            />
          </div>

          {lowTargets.length > 0 && (
            <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              ⚠ Low balance:{" "}
              {lowTargets
                .map((d) => `${d.name || d.carrier || "SIM"} (${(d.balance ?? 0).toFixed(2)})`)
                .join(", ")}
              . You can still run the campaign.
            </div>
          )}

          {result && (
            <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {result}
            </div>
          )}

          <button
            onClick={start}
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Starting…" : `Start campaign${nums.length ? ` (${nums.length})` : ""}`}
          </button>
        </div>
      )}

      {/* Campaign list */}
      <div className="mt-8 space-y-4">
        {campaigns.map((c) => (
          <CampaignRow key={c.id} campaign={c} onChanged={loadCampaigns} />
        ))}
      </div>
    </div>
  );
}

function CampaignRow({
  campaign,
  onChanged,
}: {
  campaign: CampaignRecord;
  onChanged: () => void;
}) {
  const [stats, setStats] = useState<Record<MessageStatus, number> | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const s = await campaignStats(campaign.id);
    setStats(s);
    // Auto-complete when nothing is left to send.
    const left = (s.pending ?? 0) + (s.scheduled ?? 0) + (s.sending ?? 0);
    const processed = (s.sent ?? 0) + (s.failed ?? 0) + (s.cancelled ?? 0);
    if (campaign.status === "running" && left === 0 && processed > 0) {
      try {
        await setCampaignCompleted(campaign.id);
        onChanged();
      } catch {}
    }
  }, [campaign.id, campaign.status, onChanged]);

  useEffect(() => {
    refresh();
    if (campaign.status === "running") {
      const t = setInterval(refresh, 8000);
      return () => clearInterval(t);
    }
  }, [refresh, campaign.status]);

  const sent = stats?.sent ?? 0;
  const failed = stats?.failed ?? 0;
  const cancelled = stats?.cancelled ?? 0;
  const remaining = (stats?.pending ?? 0) + (stats?.scheduled ?? 0) + (stats?.sending ?? 0);
  const total = campaign.total ?? 0;
  const done = sent + failed + cancelled;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const onStop = async () => {
    if (!confirm("Stop this campaign? Un-sent numbers will be cancelled.")) return;
    setBusy(true);
    try {
      await stopCampaign(campaign.id);
      onChanged();
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!confirm("Delete this campaign and all its queued messages?")) return;
    setBusy(true);
    try {
      await deleteCampaign(campaign.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const download = async (which: "sent" | "notsent") => {
    const statuses: MessageStatus[] =
      which === "sent" ? ["sent"] : ["failed", "cancelled", "pending", "scheduled"];
    const rows = await listCampaignNumbers(campaign.id, statuses);
    const text = rows
      .map((m) => (m.error ? `${m.to},${m.status},${m.error}` : `${m.to},${m.status}`))
      .join("\n");
    const blob = new Blob([text || ""], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${campaign.name.replace(/\s+/g, "_")}_${which}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor =
    campaign.status === "running"
      ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
      : campaign.status === "completed"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{campaign.name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
              {campaign.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {total} recipients · {campaign.rate_per_min}/min
          </p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "running" && (
            <button
              onClick={onStop}
              disabled={busy}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Stop
            </button>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {expanded ? "Hide" : "Details"}
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
          >
            Delete
          </button>
        </div>
      </div>

      {/* progress bar */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-zinc-500">
          <span>
            {done}/{total} processed
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full bg-indigo-600" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <span className="text-emerald-600">✓ {sent} sent</span>
          <span className="text-red-600">✕ {failed} failed</span>
          <span className="text-amber-600">◷ {remaining} remaining</span>
          {cancelled > 0 && <span className="text-zinc-500">⊘ {cancelled} cancelled</span>}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 flex gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <button
            onClick={() => download("sent")}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Download sent
          </button>
          <button
            onClick={() => download("notsent")}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Download not-sent
          </button>
        </div>
      )}
    </div>
  );
}
