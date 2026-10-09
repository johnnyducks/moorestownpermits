import type { Metadata } from "next";
import { SignIn } from "@/components/staff/SignIn";
import { StaffConsole } from "@/components/staff/StaffConsole";
import { reviewAvailable } from "@/lib/server/review";
import { isStaff, staffMode } from "@/lib/server/session";
import { storeKind } from "@/lib/server/store";

export const metadata: Metadata = { title: "Staff console · Moorestown Permits" };
export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const mode = staffMode();
  if (storeKind() === "none") {
    return (
      <div className="empty">
        <b>Storage isn&apos;t set up</b>
        <span>Add a Postgres database to this Vercel project (Storage → Neon, or set DATABASE_URL to a Supabase connection string), then redeploy.</span>
      </div>
    );
  }
  if (mode === "closed") {
    return (
      <div className="empty">
        <b>The staff console is turned off</b>
        <span>Set STAFF_ACCESS_KEY on the server to let Construction Office reviewers sign in.</span>
      </div>
    );
  }
  if (!(await isStaff())) return <SignIn />;
  return (
    <>
      {mode === "open" && <div className="banner">Development mode: the console is open to anyone who can reach this server. Set STAFF_ACCESS_KEY to require sign-in.</div>}
      <StaffConsole ai={reviewAvailable()} canSignOut={mode === "key"} />
    </>
  );
}
