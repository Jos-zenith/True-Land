"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError, useApi } from "@/hooks/use-api";

type Member = { id: string; email: string | null; name: string; access: "admin" | "member" | "viewer"; title: string; canSignIn: boolean };

const ACCESS_HELP = {
  admin: "Everything, including fee schedules, members and demo reset.",
  member: "Create and work checks, enter rates and run receipt checks.",
  viewer: "Read and export only.",
} as const;

/** Workspace members. Adding members is admin-only and enforced by the server. */
export function MembersSection({ canManage }: { canManage: boolean }) {
  const { data } = useApi<{ items: Member[] }>("/api/workspace/members");
  const toast = useToast();
  const [f, setF] = useState({ email: "", name: "", title: "", password: "", access: "member" as Member["access"] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    setErrors({});
    try {
      await apiSend("POST", "/api/workspace/members", f);
      toast.success(`${f.name} added as ${f.access}. Share the initial password with them securely.`);
      setF({ email: "", name: "", title: "", password: "", access: "member" });
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(Object.keys(e.fields).length ? e.fields : { _form: e.message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="members-h">
      <h2 id="members-h" className="mb-2 text-[13px] text-meta">Members</h2>
      <ul className="divide-y divide-hairline rounded-[9px] border border-hairline">
        {(data?.items ?? []).map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
            <span className="min-w-0 truncate text-label">
              {m.name} <span className="text-meta">· {m.title}{m.email ? ` · ${m.email}` : " · sample persona, cannot sign in"}</span>
            </span>
            <span className="shrink-0 text-meta">{m.access}</span>
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="m-name" error={errors.name}>
            <Input id="m-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Email" htmlFor="m-email" error={errors.email}>
            <Input id="m-email" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Job title" htmlFor="m-title" error={errors.title}>
            <Input id="m-title" placeholder="AP clerk" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Access" htmlFor="m-access" hint={ACCESS_HELP[f.access]}>
            <Select id="m-access" value={f.access} onChange={(e) => setF({ ...f, access: e.target.value as Member["access"] })}>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Administrator</option>
            </Select>
          </Field>
          <Field label="Initial password" htmlFor="m-pw" error={errors.password} hint="At least 12 characters. No email is sent.">
            <Input id="m-pw" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button loading={busy} onClick={add}>
              Add member
            </Button>
          </div>
          {errors._form && <p className="text-[13px] text-bad-text sm:col-span-2">{errors._form}</p>}
        </div>
      )}
    </section>
  );
}
