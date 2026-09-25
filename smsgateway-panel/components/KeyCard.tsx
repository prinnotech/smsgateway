"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  listDevices,
  createDevice,
  updateDevice,
  deleteDevice,
  deleteApiKey,
} from "@/lib/data";
import type { ApiKeyRecord, DeviceRecord } from "@/types/pb";

function fieldClass() {
  return "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
}

export default function KeyCard({
  apiKey,
  onDeleted,
}: {
  apiKey: ApiKeyRecord;
  onDeleted: (id: string) => void;
}) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showQr, setShowQr] = useState(false);
  const [host, setHost] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);

  // Add-device form state
  const [dName, setDName] = useState("");
  const [dSlot, setDSlot] = useState("");
  const [dSub, setDSub] = useState("");
  const [dCarrier, setDCarrier] = useState("");
  const [dNumber, setDNumber] = useState("");
  const [dRate, setDRate] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setHost(window.location.origin);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      setDevices(await listDevices(apiKey.id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey.id]);

  const qrPayload = JSON.stringify({
    host: host.replace(/\/+$/, ""),
    apiKey: apiKey.key,
  });

  const copyKey = async () => {
    await navigator.clipboard.writeText(apiKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onAddDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await createDevice({
        api_key: apiKey.id,
        name: dName || undefined,
        sim_slot: dSlot ? Number(dSlot) : undefined,
        subscription_id: dSub ? Number(dSub) : undefined,
        carrier: dCarrier || undefined,
        number: dNumber || undefined,
        rate_limit_per_min: dRate ? Number(dRate) : undefined,
      });
      setDName("");
      setDSlot("");
      setDSub("");
      setDCarrier("");
      setDNumber("");
      setDRate("");
      await load();
    } finally {
      setAdding(false);
    }
  };

  const onRateChange = async (d: DeviceRecord, value: string) => {
    const rate = value ? Number(value) : 0;
    await updateDevice(d.id, { rate_limit_per_min: rate });
    setDevices((prev) =>
      prev.map((x) => (x.id === d.id ? { ...x, rate_limit_per_min: rate } : x))
    );
  };

  const onFieldChange = async (
    d: DeviceRecord,
    field: "name" | "number",
    value: string
  ) => {
    const trimmed = value.trim();
    if (trimmed === (d[field] || "")) return;
    await updateDevice(d.id, { [field]: trimmed });
    setDevices((prev) =>
      prev.map((x) => (x.id === d.id ? { ...x, [field]: trimmed } : x))
    );
  };

  const onNumChange = async (
    d: DeviceRecord,
    field: "balance" | "sms_cost" | "low_balance",
    value: string
  ) => {
    const num = value === "" ? 0 : Number(value);
    if (Number.isNaN(num) || num === (d[field] ?? 0)) return;
    await updateDevice(d.id, { [field]: num });
    setDevices((prev) =>
      prev.map((x) => (x.id === d.id ? { ...x, [field]: num } : x))
    );
  };

  // "Check connection" — re-reads the device to get its latest last_seen.
  const onCheck = async (d: DeviceRecord) => {
    const fresh = await listDevices(apiKey.id);
    setDevices(fresh);
    const cur = fresh.find((x) => x.id === d.id);
    const online =
      cur?.last_seen && Date.now() - new Date(cur.last_seen).getTime() < 20000;
    alert(online ? "✓ Online — polling now." : "✕ Offline — last seen: " + (cur?.last_seen ? new Date(cur.last_seen).toLocaleString() : "never"));
  };

  const onDeleteDevice = async (id: string) => {
    if (!confirm("Remove this device? Its messages will also be deleted.")) return;
    await deleteDevice(id);
    await load();
  };

  const onDeleteKey = async () => {
    if (
      !confirm(
        `Delete API key "${apiKey.name}"? This removes its devices and all their messages.`
      )
    )
      return;
    await deleteApiKey(apiKey.id);
    onDeleted(apiKey.id);
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {apiKey.name}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
              {showKey ? apiKey.key : "•".repeat(12)}
            </code>
            <button
              onClick={() => setShowKey((s) => !s)}
              className="text-indigo-600 hover:underline"
            >
              {showKey ? "hide" : "show"}
            </button>
            <button onClick={copyKey} className="text-indigo-600 hover:underline">
              {copied ? "copied!" : "copy"}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowQr((s) => !s)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {showQr ? "Hide QR" : "Generate QR"}
          </button>
          <button
            onClick={onDeleteKey}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            Delete
          </button>
        </div>
      </div>

      {showQr && (
        <div className="mt-4 flex flex-col items-start gap-4 rounded-lg bg-zinc-50 p-4 sm:flex-row sm:items-center dark:bg-zinc-950">
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={qrPayload} size={160} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Panel URL (the phone will call this)
            </label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="https://your-panel.example.com"
              className={fieldClass()}
            />
            <p className="mt-2 text-xs text-zinc-500">
              Scan this in the app to connect the phone. Make sure the URL is
              reachable from the phone (public HTTPS in production).
            </p>
          </div>
        </div>
      )}

      {/* Devices */}
      <div className="mt-5">
        <h4 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Devices / SIMs
        </h4>
        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No devices yet. Add one below, or the phone can register itself on
            connect.
          </p>
        ) : (
          <div className="space-y-3">
            {devices.map((d) => {
              const online =
                d.last_seen &&
                Date.now() - new Date(d.last_seen).getTime() < 20000;
              const balance = d.balance ?? 0;
              const low = d.low_balance ?? 0;
              const isLow = low > 0 && balance <= low;
              const numInput =
                "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950";
              return (
                <div
                  key={d.id}
                  className={`rounded-lg border p-3 ${
                    isLow
                      ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        title={online ? "Online" : "Offline"}
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                          online ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
                        }`}
                      />
                      <input
                        type="text"
                        defaultValue={d.name ?? ""}
                        placeholder="Name"
                        onBlur={(e) => onFieldChange(d, "name", e.target.value)}
                        className="w-36 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium text-zinc-800 hover:border-zinc-300 focus:border-indigo-500 focus:bg-white focus:outline-none dark:text-zinc-200 dark:hover:border-zinc-700 dark:focus:bg-zinc-950"
                      />
                      <span className="truncate text-xs text-zinc-400">
                        {[d.manufacturer, d.model].filter(Boolean).join(" ")}
                        {d.sim_slot != null && ` · slot ${d.sim_slot}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onCheck(d)}
                        className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        Check connection
                      </button>
                      <button
                        onClick={() => onDeleteDevice(d.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        remove
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <label className="text-xs text-zinc-500">
                      Carrier
                      <div className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
                        {d.carrier || "—"}
                      </div>
                    </label>
                    <label className="text-xs text-zinc-500">
                      Number
                      <input
                        type="text"
                        defaultValue={d.number ?? ""}
                        placeholder="—"
                        onBlur={(e) => onFieldChange(d, "number", e.target.value)}
                        className={numInput + " mt-0.5"}
                      />
                    </label>
                    <label className="text-xs text-zinc-500">
                      Rate/min
                      <input
                        type="number"
                        min={0}
                        defaultValue={d.rate_limit_per_min ?? ""}
                        onBlur={(e) => onRateChange(d, e.target.value)}
                        placeholder="∞"
                        className={numInput + " mt-0.5"}
                      />
                    </label>
                    <label className="text-xs text-zinc-500">
                      Android
                      <div className="mt-0.5 truncate text-sm text-zinc-700 dark:text-zinc-300">
                        {d.android || "—"}
                      </div>
                    </label>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-3 sm:grid-cols-4 dark:border-zinc-800">
                    <label className="text-xs text-zinc-500">
                      Balance
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={d.balance ?? ""}
                        placeholder="0.00"
                        onBlur={(e) => onNumChange(d, "balance", e.target.value)}
                        className={numInput + " mt-0.5"}
                      />
                    </label>
                    <label className="text-xs text-zinc-500">
                      Cost / SMS
                      <input
                        type="number"
                        step="0.001"
                        defaultValue={d.sms_cost ?? ""}
                        placeholder="0.00"
                        onBlur={(e) => onNumChange(d, "sms_cost", e.target.value)}
                        className={numInput + " mt-0.5"}
                      />
                    </label>
                    <label className="text-xs text-zinc-500">
                      Warn at ≤
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={d.low_balance ?? ""}
                        placeholder="off"
                        onBlur={(e) => onNumChange(d, "low_balance", e.target.value)}
                        className={numInput + " mt-0.5"}
                      />
                    </label>
                    <label className="text-xs text-zinc-500">
                      Spent
                      <div className="mt-0.5 py-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {(d.spent ?? 0).toFixed(2)}
                      </div>
                    </label>
                  </div>

                  {isLow && (
                    <div className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                      ⚠ Low balance ({balance.toFixed(2)}) — at or below your warning threshold.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add device */}
        <form
          onSubmit={onAddDevice}
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          <input
            value={dName}
            onChange={(e) => setDName(e.target.value)}
            placeholder="Name (e.g. Work SIM)"
            className={fieldClass()}
          />
          <input
            value={dSlot}
            onChange={(e) => setDSlot(e.target.value)}
            placeholder="SIM slot (0/1)"
            type="number"
            className={fieldClass()}
          />
          <input
            value={dSub}
            onChange={(e) => setDSub(e.target.value)}
            placeholder="Subscription ID"
            type="number"
            className={fieldClass()}
          />
          <input
            value={dCarrier}
            onChange={(e) => setDCarrier(e.target.value)}
            placeholder="Carrier"
            className={fieldClass()}
          />
          <input
            value={dNumber}
            onChange={(e) => setDNumber(e.target.value)}
            placeholder="Number (optional)"
            className={fieldClass()}
          />
          <input
            value={dRate}
            onChange={(e) => setDRate(e.target.value)}
            placeholder="Rate/min (blank = ∞)"
            type="number"
            className={fieldClass()}
          />
          <button
            type="submit"
            disabled={adding}
            className="col-span-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 sm:col-span-3 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {adding ? "Adding…" : "Add device"}
          </button>
        </form>
      </div>
    </div>
  );
}
