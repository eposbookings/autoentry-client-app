import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, Save, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";

const roleLabels = {
  practice_admin: "Practice administrator",
  practice_manager: "Manager",
  practice_staff: "Staff",
  practice_readonly: "Read only",
  admin: "Practice administrator",
};

const permissionLabels = {
  "clients.manage": "Client accounts",
  "submitted_items.manage": "Submitted items",
  "accounting.manage": "Native accounting",
  "integrations.manage": "Client connections",
  "automation.manage": "Automation",
  "practice_settings.manage": "Practice profile",
  "practice_members.manage": "Practice users",
};

const emptyMember = {
  first_name: "", last_name: "", email: "", password: "",
  role: "practice_staff", job_title: "", permissions: [],
};

export default function AdminPractice() {
  const { user } = useAuth();
  const permissions = useMemo(() => new Set(user?.permissions || []), [user]);
  const canEdit = permissions.has("practice_settings.manage");
  const canManageMembers = permissions.has("practice_members.manage");
  const [practice, setPractice] = useState(null);
  const [members, setMembers] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [memberForm, setMemberForm] = useState(emptyMember);
  const [showMember, setShowMember] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/practice");
      setPractice(data);
      setForm({ name: data.name || "", email: data.email || "", phone: data.phone || "" });
      setCatalog(data.permission_catalog || []);
      if (canManageMembers) {
        const memberResponse = await api.get("/admin/practice/members");
        setMembers(memberResponse.data.rows || []);
        setCatalog(memberResponse.data.permission_catalog || data.permission_catalog || []);
      }
    } catch (error) {
      toast.error(formatApiError(error));
    }
  }, [canManageMembers]);

  useEffect(() => { load(); }, [load]);

  async function savePractice(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.put("/admin/practice", form);
      toast.success("Practice profile saved");
      await load();
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setBusy(false);
    }
  }

  function togglePermission(permission) {
    const current = new Set(memberForm.permissions);
    if (current.has(permission)) current.delete(permission); else current.add(permission);
    setMemberForm({ ...memberForm, permissions: Array.from(current) });
  }

  async function createMember(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post("/admin/practice/members", memberForm);
      toast.success("Practice user created");
      setMemberForm(emptyMember);
      setShowMember(false);
      await load();
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setBusy(false);
    }
  }

  if (!practice) return <div className="p-6 text-stone-500">Loading practice account…</div>;

  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-emerald-50 p-3 text-emerald-700"><Building2 className="h-6 w-6" /></div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Practice account</div>
            <h1 className="font-display text-3xl font-bold text-stone-950">{practice.name}</h1>
            <p className="text-stone-600">Practice identity, users and permissions. Client records are visible only to this practice.</p>
          </div>
        </div>
      </header>

      <form onSubmit={savePractice} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-stone-900">Practice profile</h2>
          <div className="flex gap-4 text-sm text-stone-600">
            <span>{practice.client_count} clients</span><span>{practice.member_count} users</span>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div><Label>Practice name</Label><Input disabled={!canEdit} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Practice email</Label><Input disabled={!canEdit} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label>Phone</Label><Input disabled={!canEdit} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        {canEdit && <div className="mt-4 flex justify-end"><Button type="submit" disabled={busy} className="gap-2"><Save className="h-4 w-4" /> Save profile</Button></div>}
      </form>

      {canManageMembers && (
        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-display text-xl font-bold text-stone-900"><Users className="h-5 w-5 text-emerald-700" /> Practice users</h2>
              <p className="text-sm text-stone-600">Give each user only the operational areas they need.</p>
            </div>
            <Button onClick={() => setShowMember((value) => !value)} className="gap-2"><Plus className="h-4 w-4" /> Add user</Button>
          </div>

          {showMember && (
            <form onSubmit={createMember} className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div><Label>First name</Label><Input required value={memberForm.first_name} onChange={(e) => setMemberForm({ ...memberForm, first_name: e.target.value })} /></div>
                <div><Label>Last name</Label><Input required value={memberForm.last_name} onChange={(e) => setMemberForm({ ...memberForm, last_name: e.target.value })} /></div>
                <div><Label>Email</Label><Input required type="email" value={memberForm.email} onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} /></div>
                <div><Label>Temporary password</Label><Input required minLength={8} type="password" value={memberForm.password} onChange={(e) => setMemberForm({ ...memberForm, password: e.target.value })} /></div>
                <div><Label>Job title</Label><Input value={memberForm.job_title} onChange={(e) => setMemberForm({ ...memberForm, job_title: e.target.value })} /></div>
                <div>
                  <Label>Role</Label>
                  <select className="mt-0 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={memberForm.role} onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}>
                    {Object.entries(roleLabels).filter(([key]) => key !== "admin").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </div>
              </div>
              {memberForm.role !== "practice_admin" && (
                <div className="mt-4">
                  <Label>Permissions</Label>
                  <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {catalog.map((permission) => (
                      <label key={permission} className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white p-3 text-sm">
                        <input type="checkbox" checked={memberForm.permissions.includes(permission)} onChange={() => togglePermission(permission)} />
                        {permissionLabels[permission] || permission}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowMember(false)}>Cancel</Button>
                <Button type="submit" disabled={busy}>Create practice user</Button>
              </div>
            </form>
          )}

          <div className="mt-4 divide-y divide-stone-200 rounded-xl border border-stone-200">
            {members.map((member) => (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-semibold text-stone-900">{member.first_name} {member.last_name}</div>
                  <div className="text-sm text-stone-500">{member.email}{member.job_title ? ` · ${member.job_title}` : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  {["admin", "practice_admin"].includes(member.role) && <ShieldCheck className="h-4 w-4 text-emerald-700" />}
                  <span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">{roleLabels[member.role] || member.role}</span>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${member.status === "inactive" ? "bg-stone-200 text-stone-600" : "bg-emerald-100 text-emerald-800"}`}>{member.status}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
