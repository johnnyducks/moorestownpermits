import { NextResponse } from "next/server";
import { handled } from "@/app/api/handle";
import { exampleApplications } from "@/lib/permits/examples";
import { getStore } from "@/lib/server/store";
import { staffOnly } from "../guard";

export const dynamic = "force-dynamic";

/** Every application, newest first. */
export const GET = handled(async () => {
  const denied = await staffOnly();
  if (denied) return denied;
  return NextResponse.json({ applications: await getStore().listAll() });
});

/** { action: "examples" } adds the three example applications. */
export const POST = handled(async (req: Request) => {
  const denied = await staffOnly();
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "examples") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const store = getStore();
  for (const a of exampleApplications()) await store.put(a);
  return NextResponse.json({ applications: await store.listAll() });
});
