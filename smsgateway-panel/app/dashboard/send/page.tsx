"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { listUserDevices, createMessage, createMessages } from "@/lib/data";
import type { DeviceRecord } from "@/types/pb";

type Mode = "single" | "bulk";

function deviceLabel(d: DeviceRecord) {
  const key =
    (d.expand?.api_key as { name?: string } | undefined)?.name ?? "";
  const name = d.name || d.carrier || `SIM ${d.sim_slot ?? "?"}`;
  return key ? `${name} · ${key}` : name;
}

function simOf(d: DeviceRecord): number | undefined {
  return d.subscription_id ?? d.sim_slot ?? undefined;
}

function fieldClass() {
  return "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
}

export default function SendPage() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [mode, setMode] = useState<Mode>("single");
  const [body, setBody] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // single
  const [to, setTo] = useState("");
  const [deviceId, setDeviceId] = useState("");

  // bulk
  const [recipients, setRecipients] = useState("");
  const [prefix, setPrefix] = useState("");
  const [roundRobin, setRoundRobin] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  // Add a leading "+" to numbers that don't have one (leave "+" numbers alone).
  const [addPlus, setAddPlus] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const devs = await listUserDevices(user.id);
      setDevices(devs);
      if (devs[0]) setDeviceId(devs[0].id);
    })();
  }, [user]);

  const parsedRecipients = useMemo(() => {
    return recipients
      .split(/[\n,;]+/)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        let n = r;
        // Optional country prefix for bare local numbers.
        if (prefix && !n.startsWith("+") && !n.startsWith(prefix)) {
          n = prefix + n.replace(/^0+/, "");
        }
        // Add "+" when missing; leave numbers that already have one.
        if (addPlus && !n.startsWith("+")) n = "+" + n;
        return n;
      });
  }, [recipients, prefix, addPlus]);

  const scheduleIso = () =>
    schedule && sendAt ? new Date(sendAt).toISOString() : undefined;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    // Grab the first column of each line (handles plain txt and simple CSV).
    const nums = text
      .split(/\r?\n/)
      .map((line) => line.split(",")[0].trim())
      .filter(Boolean);
    setRecipients((prev) => (prev ? prev + "\n" : "") + nums.join("\n"));
    if (fileRef.current) fileRef.current.value = "";
  };

  const sendSingle = async () => {
    const d = devices.find((x) => x.id === deviceId);
    if (!d || !to.trim() || !body.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      let toNum = to.trim();
      if (addPlus && !toNum.startsWith("+")) toNum = "+" + toNum;
      await createMessage({
        device: d.id,
        to: toNum,
        body,
        sim: simOf(d),
        sendAt: scheduleIso(),
      });
      // Inputs are intentionally kept so you can change the number and resend
      // the same text without retyping it.
      setResult(schedule ? "Message scheduled." : `Message queued to ${toNum}.`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Failed to queue message.");
    } finally {
      setBusy(false);
    }
  };

  const sendBulk = async () => {
    const targets = roundRobin
      ? devices.filter((d) => selected.includes(d.id))
      : devices.filter((d) => d.id === deviceId);
    if (targets.length === 0 || parsedRecipients.length === 0 || !body.trim())
      return;
    setBusy(true);
    setResult(null);
    try {
      const iso = scheduleIso();
      const list = parsedRecipients.map((num, i) => {
        const d = targets[i % targets.length];
        return { device: d.id, to: num, body, sim: simOf(d), sendAt: iso };
      });
      const { ok, failed } = await createMessages(list);
      setResult(
        `${ok} ${schedule ? "scheduled" : "queued"}${
          failed ? `, ${failed} failed` : ""
        } across ${targets.length} SIM${targets.length > 1 ? "s" : ""}.`
      );
      // Inputs kept on purpose — change the numbers and reuse the same text.
    } finally {
      setBusy(false);
    }
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const noDevices = devices.length === 0;

  const activeTargets =
    mode === "bulk" && roundRobin
      ? devices.filter((d) => selected.includes(d.id))
      : devices.filter((d) => d.id === deviceId);
  const lowTargets = activeTargets.filter(
    (d) => (d.low_balance ?? 0) > 0 && (d.balance ?? 0) <= (d.low_balance ?? 0)
  );

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Send
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Queue outgoing messages. Your phone picks them up on its next poll.
        </p>
      </div>

      {noDevices ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No devices available. Add a device on the{" "}
          <a href="/dashboard/keys" className="text-indigo-600">
            API Keys
          </a>{" "}
          page (or connect a phone) first.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 inline-flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {(["single", "bulk"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setResult(null);
                }}
                className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                  mode === m
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
                    : "text-zinc-500"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {mode === "single" ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  To
                </label>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="+15551234567"
                  className={fieldClass()}
                />
              </div>
              <DeviceSelect
                devices={devices}
                value={deviceId}
                onChange={setDeviceId}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
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
                  rows={5}
                  placeholder={"5551234567\n5559876543"}
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
                  <span className="text-xs text-zinc-400">
                    {parsedRecipients.length} recipient
                    {parsedRecipients.length === 1 ? "" : "s"}
                    {prefix && " · prefix prepended to local numbers"}
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={roundRobin}
                    onChange={(e) => setRoundRobin(e.target.checked)}
                  />
                  Round-robin across multiple SIMs
                </label>
                {roundRobin ? (
                  <div className="space-y-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    {devices.map((d) => (
                      <label
                        key={d.id}
                        className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(d.id)}
                          onChange={() => toggleSelected(d.id)}
                        />
                        {deviceLabel(d)}
                      </label>
                    ))}
                  </div>
                ) : (
                  <DeviceSelect
                    devices={devices}
                    value={deviceId}
                    onChange={setDeviceId}
                  />
                )}
              </div>

            </div>
          )}

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Your message…"
              className={fieldClass()}
            />
            <div className="mt-1 text-right text-xs text-zinc-400">
              {body.length}/2000
            </div>
          </div>

          <div className="mt-3">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={addPlus}
                onChange={(e) => setAddPlus(e.target.checked)}
              />
              Add “+” to numbers that don&apos;t have one
            </label>
          </div>

          <div className="mt-2">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={schedule}
                onChange={(e) => setSchedule(e.target.checked)}
              />
              Schedule for later
            </label>
            {schedule && (
              <input
                type="datetime-local"
                value={sendAt}
                onChange={(e) => setSendAt(e.target.value)}
                className="mt-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            )}
          </div>

          {lowTargets.length > 0 && (
            <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              ⚠ Low balance:{" "}
              {lowTargets
                .map((d) => `${d.name || d.carrier || "SIM"} (${(d.balance ?? 0).toFixed(2)})`)
                .join(", ")}
              . You can still send.
            </div>
          )}

          {result && (
            <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {result}
            </div>
          )}

          <button
            onClick={mode === "single" ? sendSingle : sendBulk}
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy
              ? "Working…"
              : schedule
              ? "Schedule"
              : mode === "single"
              ? "Send"
              : `Send to ${parsedRecipients.length || 0}`}
          </button>
        </div>
      )}
    </div>
  );
}

function DeviceSelect({
  devices,
  value,
  onChange,
}: {
  devices: DeviceRecord[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        SIM / device
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass()}
      >
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {deviceLabel(d)}
          </option>
        ))}
      </select>
    </div>
  );
}
