"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/** Sign-in and sign-up. Plain fetch (not the cached API store): these run before a session exists. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [f, setF] = useState({ email: "", password: "", name: "", workspaceName: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const body = mode === "login" ? { email: f.email, password: f.password } : f;
      const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        const err = j?.error ?? {};
        setErrors(err.fields && Object.keys(err.fields).length ? err.fields : { _form: err.message ?? "Something went wrong. Try again." });
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      // Only same-site relative paths: never redirect to another origin.
      window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/overview");
    } catch {
      setErrors({ _form: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-[380px] rounded-[12px] border border-hairline bg-panel px-6 py-7" noValidate>
        <h1 className="text-[20px] font-[590] tracking-[-0.015em] text-figure">{mode === "login" ? "Sign in to Landed" : "Create a workspace"}</h1>
        <p className="mt-1 text-[13px] text-meta">
          {mode === "login" ? "Estimate, compare and reconcile what a supplier receives. Landed never moves money." : "Your workspace starts with labelled sample data so you can try every feature. Nothing here is live provider data."}
        </p>
        <div className="mt-5 flex flex-col gap-3">
          {mode === "signup" && (
            <>
              <Field label="Your name" htmlFor="a-name" error={errors.name}>
                <Input id="a-name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </Field>
              <Field label="Workspace name" htmlFor="a-ws" error={errors.workspaceName}>
                <Input id="a-ws" placeholder="Northstar Imports" value={f.workspaceName} onChange={(e) => setF({ ...f, workspaceName: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="Email" htmlFor="a-email" error={errors.email}>
            <Input id="a-email" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Password" htmlFor="a-pw" error={errors.password} hint={mode === "signup" ? "At least 12 characters." : undefined}>
            <Input id="a-pw" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
        </div>
        {errors._form && (
          <p role="alert" className="mt-3 text-[13px] text-bad-text">
            {errors._form}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} className="mt-5 w-full justify-center">
          {mode === "login" ? "Sign in" : "Create workspace"}
        </Button>
        <p className="mt-4 text-center text-[13px] text-meta">
          {mode === "login" ? (
            <>
              No account? <Link href="/signup" className="text-label underline">Create a workspace</Link>
            </>
          ) : (
            <>
              Already registered? <Link href="/login" className="text-label underline">Sign in</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
