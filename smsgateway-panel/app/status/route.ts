import { authenticate, unauthorized } from "@/lib/api-auth";
import type { DeviceRecord, MessageRecord } from "@/types/pb";

export const dynamic = "force-dynamic";

// POST /status  { id, status: "sent"|"failed", error? }
// The phone reports the outcome of a message it picked up from /outgoing.
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();
  const { pb, apiKey } = auth;

  let body: { id?: string; status?: string; error?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { id, status, error } = body;
  if (!id || (status !== "sent" && status !== "failed")) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    // Ownership check: the message must belong to a device under this key.
    const msg = await pb
      .collection("messages")
      .getOne<MessageRecord>(id, { expand: "device" });
    const device = msg.expand?.device as DeviceRecord | undefined;
    if (device?.api_key !== apiKey.id) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    await pb.collection("messages").update(id, {
      status,
      error: status === "failed" ? error || "unknown error" : "",
    });

    // On a successful send, deduct the SIM's per-SMS cost from its balance and
    // add to its running spend — but only the first time this message is sent
    // (don't double-charge if a duplicate status arrives).
    if (status === "sent" && device && msg.status !== "sent") {
      const cost = device.sms_cost ?? 0;
      if (cost > 0) {
        await pb.collection("devices").update(device.id, {
          balance: (device.balance ?? 0) - cost,
          spent: (device.spent ?? 0) + cost,
        });
      }
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
