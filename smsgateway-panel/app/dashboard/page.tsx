"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import {
  countMessages,
  listUserDevices,
  listMessages,
  spentInRange,
  type DateRange,
} from "@/lib/data";
import type { DeviceRecord, MessageRecord } from "@/types/pb";

function timeAgo(iso?: string) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ONLINE_MS = 2 * 60 * 1000; // seen within 2 min = online

type Preset = "today" | "yesterday" | "7d" | "30d" | "all" | "custom";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// "YYYY-MM-DD" from an <input type="date"> as local midnight.
function parseDay(v: string) {
  const [y, m, d] = v.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
}

function toDayInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Day boundaries are in the browser's local time zone.
function presetRange(preset: Preset, from: string, to: string): DateRange | undefined {
  const today = startOfDay(new Date());
  switch (preset) {
    case "today":
      return { from: today, to: addDays(today, 1) };
    case "yesterday":
      return { from: addDays(today, -1), to: today };
    case "7d":
      return { from: addDays(today, -6), to: addDays(today, 1) };
    case "30d":
      return { from: addDays(today, -29), to: addDays(today, 1) };
    case "custom": {
      const f = parseDay(from);
      const t = parseDay(to);
      return { from: f, to: t ? addDays(t, 1) : undefined };
    }
    default:
      return undefined;
  }
}

export default function OverviewPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    sent: 0,
    failed: 0,
    received: 0,
    pending: 0,
    sending: 0,
    scheduled: 0,
  });
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [recent, setRecent] = useState<MessageRecord[]>([]);
  const [rangeSpent, setRangeSpent] = useState<number | null>(null);
  const [preset, setPreset] = useState<Preset>("all");
  const [customFrom, setCustomFrom] = useState(() => toDayInput(new Date()));
  const [customTo, setCustomTo] = useState(() => toDayInput(new Date()));

  useEffect(() => {
    if (!user?.id) return;
    const range = presetRange(preset, customFrom, customTo);
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [sent, failed, received, pending, sending, scheduled, devs, recentMsgs] =
          await Promise.all([
            countMessages(user.id, "sent", undefined, range),
            countMessages(user.id, "failed", undefined, range),
            countMessages(user.id, "received", undefined, range),
            countMessages(user.id, "pending", undefined, range),
            countMessages(user.id, "sending", undefined, range),
            countMessages(user.id, "scheduled", undefined, range),
            listUserDevices(user.id),
            listMessages(user.id, { range }, 1, 6),
          ]);
        // "All time" uses each device's running total; a window is computed
        // from the messages charged inside it.
        const spent = range ? await spentInRange(devs, range) : null;
        if (cancelled) return;
        setStats({ sent, failed, received, pending, sending, scheduled });
        setDevices(devs);
        setRecent(recentMsgs.items);
        setRangeSpent(spent);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, preset, customFrom, customTo]);

  const online = devices.filter(
    (d) => d.last_seen && Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS
  ).length;
  const totalSpent =
    rangeSpent ?? devices.reduce((a, d) => a + (d.spent ?? 0), 0);
  const totalBalance = devices.reduce((a, d) => a + (d.balance ?? 0), 0);

  const cards = [
    { label: "Sent", value: stats.sent, tone: "text-emerald-600" },
    { label: "Sending", value: stats.sending, tone: "text-sky-600" },
    { label: "Pending", value: stats.pending, tone: "text-amber-600" },
    { label: "Failed", value: stats.failed, tone: "text-red-600" },
    { label: "Received", value: stats.received, tone: "text-indigo-600" },
    { label: "Spent", value: totalSpent.toFixed(2), tone: "text-zinc-800 dark:text-zinc-100" },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Overview
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {online} of {devices.length}{" "}
            {devices.length === 1 ? "device" : "devices"} online
            {stats.scheduled > 0 && ` · ${stats.scheduled} scheduled`}
          </p>
        </div>
        <Link
          href="/dashboard/send"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Send a message
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPreset(p.value)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              preset === p.value
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <label className="sr-only" htmlFor="range-from">From</label>
            <input
              id="range-from"
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
            />
            <span>to</span>
            <label className="sr-only" htmlFor="range-to">To</label>
            <input
              id="range-to"
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              {c.label}
            </div>
            <div className={`mt-1 text-2xl font-semibold ${c.tone}`}>
              {loading ? "—" : c.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Devices
          </h2>
          {devices.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No devices yet.{" "}
              <Link href="/dashboard/keys" className="text-indigo-600">
                Create an API key
              </Link>{" "}
              and connect your phone.
            </p>
          ) : (
            <ul className="space-y-2">
              {devices.map((d) => {
                const isOnline =
                  d.last_seen &&
                  Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS;
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          isOnline ? "bg-emerald-500" : "bg-zinc-300"
                        }`}
                      />
                      {d.name || d.carrier || `SIM ${d.sim_slot ?? "?"}`}
                      {(d.low_balance ?? 0) > 0 &&
                        (d.balance ?? 0) <= (d.low_balance ?? 0) && (
                          <span className="text-amber-600" title="Low balance">
                            ⚠
                          </span>
                        )}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-zinc-400">
                      {(d.balance ?? 0) > 0 || (d.spent ?? 0) > 0 ? (
                        <span className="text-zinc-500">
                          bal {(d.balance ?? 0).toFixed(2)}
                        </span>
                      ) : null}
                      {timeAgo(d.last_seen)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Recent activity
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing yet.</p>
          ) : (
            <ul className="space-y-2">
              {recent.map((m) => (
                <li key={m.id} className="flex items-center gap-3 text-sm">
                  <span
                    className={`shrink-0 text-xs ${
                      m.direction === "in"
                        ? "text-indigo-600"
                        : "text-zinc-400"
                    }`}
                  >
                    {m.direction === "in" ? "IN" : "OUT"}
                  </span>
                  <span className="truncate text-zinc-700 dark:text-zinc-300">
                    {m.direction === "in" ? m.from : m.to} — {m.body}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
