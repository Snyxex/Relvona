"use client";

import { useCallback, useEffect, useState } from "react";
import { UsersRound } from "lucide-react";
import {
  AdminButton,
  AdminEmpty,
  AdminHeader,
  AdminNotice,
  AdminPage,
  AdminPanel,
  adminControlClassName,
} from "@/components/admin/admin-ui";
import { api } from "@/lib/api";

type Team = {
  id: string;
  name: string;
  description: string | null;
  requiredSkills: string[];
  enabled: boolean;
  leadUserId: string | null;
  members: string[];
};
type Agent = { userId: string; name: string; role: string };
type SlaConfig = {
  enabled: boolean;
  warningMinutes: number;
  autoRaisePriority: boolean;
};

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [skills, setSkills] = useState("");
  const [lead, setLead] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updatingMember, setUpdatingMember] = useState<string | null>(null);
  const [savingSla, setSavingSla] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<SlaConfig>({
    enabled: true,
    warningMinutes: 15,
    autoRaisePriority: false,
  });

  const load = useCallback(async () => {
    const [teamsResult, membersResult, configResult] = await Promise.all([
      api.get("/support-teams"),
      api.get("/admin/employees"),
      api.get("/support-teams/sla-escalations"),
    ]);
    setTeams(teamsResult.data);
    setMembers(membersResult.data.members);
    setConfig(configResult.data);
  }, []);

  useEffect(() => {
    void load()
      .catch(() => setError("Teamdaten konnten nicht geladen werden."))
      .finally(() => setLoading(false));
  }, [load]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      await api.post("/support-teams", {
        name,
        requiredSkills: skills
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean),
        leadUserId: lead || null,
      });
      setName("");
      setSkills("");
      setLead("");
      await load();
    } catch (caught: unknown) {
      const response = caught as { response?: { data?: { error?: string } } };
      setError(
        response.response?.data?.error || "Team konnte nicht erstellt werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleMember(team: Team, userId: string) {
    setError("");
    setUpdatingMember(userId);
    try {
      const userIds = team.members.includes(userId)
        ? team.members.filter((id) => id !== userId)
        : [...team.members, userId];
      await api.put("/support-teams/" + team.id + "/members", { userIds });
      await load();
    } catch (caught: unknown) {
      const response = caught as { response?: { data?: { error?: string } } };
      setError(
        response.response?.data?.error ||
          "Mitglied konnte nicht geändert werden.",
      );
    } finally {
      setUpdatingMember(null);
    }
  }

  async function saveSla() {
    setError("");
    setSavingSla(true);
    try {
      await api.put("/support-teams/sla-escalations", config);
      await load();
    } catch (caught: unknown) {
      const response = caught as { response?: { data?: { error?: string } } };
      setError(
        response.response?.data?.error ||
          "SLA-Einstellungen konnten nicht gespeichert werden.",
      );
    } finally {
      setSavingSla(false);
    }
  }

  return (
    <AdminPage>
      <AdminHeader
        eyebrow="Arbeitsbereich / Support"
        title="Support-Teams & Routing"
        description="Neue Tickets werden nach Skills, Status und Auslastung freien Teammitgliedern zugeordnet. Manuell zugewiesene Tickets bleiben unverändert."
        icon={UsersRound}
      />
      {error && <AdminNotice tone="error">{error}</AdminNotice>}
      <AdminPanel
        title="Team erstellen"
        description="Erstelle ein Team mit optionalen Skills und Teamleitung."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block space-y-2 text-sm text-[#536584]">
            <span>Teamname</span>
            <input
              aria-label="Teamname"
              placeholder="Teamname"
              className={adminControlClassName}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block space-y-2 text-sm text-[#536584]">
            <span>Skills</span>
            <input
              aria-label="Skills"
              placeholder="Skills, kommagetrennt"
              className={adminControlClassName}
              value={skills}
              onChange={(event) => setSkills(event.target.value)}
            />
          </label>
          <label className="block space-y-2 text-sm text-[#536584]">
            <span>Teamleitung</span>
            <select
              aria-label="Teamleitung"
              className={adminControlClassName}
              value={lead}
              onChange={(event) => setLead(event.target.value)}
            >
              <option value="">Keine Teamleitung</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name} ({member.role})
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end">
          <AdminButton
            disabled={!name.trim() || busy || loading}
            onClick={() => void create()}
          >
            {busy ? "Erstelle …" : "Team erstellen"}
          </AdminButton>
        </div>
      </AdminPanel>

      {loading ? (
        <AdminPanel>
          <p role="status" className="text-sm text-[#667694]">
            Teamdaten werden geladen …
          </p>
        </AdminPanel>
      ) : teams.length === 0 ? (
        <AdminPanel>
          <AdminEmpty
            icon={UsersRound}
            title="Noch keine Support-Teams"
            description="Erstelle ein Team, um Skills und Zuständigkeiten festzulegen."
          />
        </AdminPanel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((team) => (
            <AdminPanel
              key={team.id}
              title={team.name}
              description={team.description || undefined}
            >
              <div className="space-y-1 text-sm text-[#667694]">
                <p>Skills: {team.requiredSkills.join(", ") || "Keine"}</p>
                <p>
                  Teamleitung:{" "}
                  {members.find((member) => member.userId === team.leadUserId)
                    ?.name || "Nicht gesetzt"}
                </p>
              </div>
              <div className="max-h-60 space-y-3 overflow-auto border-t border-[#edf0f6] pt-4">
                {members.map((member) => (
                  <label
                    key={member.userId}
                    className="flex items-center gap-3 text-sm text-[#263954]"
                  >
                    <input
                      type="checkbox"
                      checked={team.members.includes(member.userId)}
                      disabled={updatingMember !== null}
                      onChange={() => void toggleMember(team, member.userId)}
                    />
                    {member.name} ({member.role})
                  </label>
                ))}
              </div>
            </AdminPanel>
          ))}
        </div>
      )}

      <AdminPanel
        title="SLA-Eskalationen"
        description="Lege fest, wann Mitarbeiter und Teamleitungen vor SLA-Verstößen gewarnt werden."
      >
        <label className="flex items-center gap-3 text-sm font-medium text-[#263954]">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) =>
              setConfig({ ...config, enabled: event.target.checked })
            }
          />
          Automatische Warnungen aktivieren
        </label>
        <label className="block max-w-xs space-y-2 text-sm text-[#536584]">
          <span>Warnung vor Ablauf (Minuten)</span>
          <input
            type="number"
            min={1}
            max={1440}
            className={adminControlClassName}
            value={config.warningMinutes}
            onChange={(event) =>
              setConfig({
                ...config,
                warningMinutes: Number(event.target.value),
              })
            }
          />
        </label>
        <p className="text-xs text-[#667694]">
          Bei SLA-Verstößen werden zuständige Agenten, Teamleitung und
          Administratoren informiert.
        </p>
        <div className="flex justify-end border-t border-[#edf0f6] pt-4">
          <AdminButton
            disabled={savingSla || loading}
            onClick={() => void saveSla()}
          >
            {savingSla ? "Speichere …" : "SLA-Einstellungen speichern"}
          </AdminButton>
        </div>
      </AdminPanel>
    </AdminPage>
  );
}
