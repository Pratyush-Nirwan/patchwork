"use client";

import React,{ useState,useEffect,useCallback,useRef } from "react";
import { useRouter } from "next/navigation";
import { SetupWizardSkeleton } from "@/components/skeletons/SetupWizardSkeleton";
import {
DndContext,
PointerSensor,
KeyboardSensor,
useSensor,
useSensors,
type DragEndEvent,
} from "@dnd-kit/core";
import {
SortableContext,
horizontalListSortingStrategy,sortableKeyboardCoordinates,
arrayMove
} from "@dnd-kit/sortable";
import {
CheckCircle2,
Clock,
Shield,
Building2,
Users,
UserPlus,
FolderKanban,
Columns3,
FileSpreadsheet,
Download,
Upload,
Plus,
Trash2,
AlertTriangle,
KeyRound,
LogOut,
ArrowRight,
ArrowLeft,
Sparkles,Eye,
EyeOff,
Copy,
Check,
Lock,
SlidersHorizontal,
RefreshCw,
BookOpen
} from "lucide-react";
import type {
SetupDraftData,
SetupDraftTeam,
SetupDraftEmployee,
SetupDraftProject,
SetupDraftBoard,
} from "@/db/schema";
import { slugify } from "@/lib/slug";

const SETUP_NOTICE =
  "Setup takes some time. Every step is saved automatically, so you can close this page and resume whenever you want.";

const DEFAULT_COLUMNS = [
  { name: "Backlog", wipLimit: null, color: "#434B56" },
  { name: "In Progress", wipLimit: 5, color: "#C84317" },
  { name: "Review", wipLimit: 3, color: "#C2410C" },
  { name: "Done", wipLimit: null, color: "#15803D" },
];

interface SetupSummary {
  admin: { id: string; name: string; email: string } | null;
  org: { id: string; name: string; slug: string; description: string } | null;
  teams: Array<{
    id: string;
    name: string;
    slug: string;
    description: string;
    leadEmail: string;
    leadName: string;
  }>;
  employees: Array<{
    id: string;
    name: string;
    email: string;
    role: "admin" | "lead" | "member" | "viewer";
    teamSlug: string;
    teamName: string;
    mustChangePassword: boolean;
  }>;
  projects: Array<{
    id: string;
    teamId: string;
    teamSlug: string;
    teamName: string;
    name: string;
    key: string;
    description: string;
  }>;
  boards: Array<{
    id: string;
    projectId: string;
    projectKey: string;
    projectName: string;
    name: string;
    description: string;
    columns: Array<{
      id: string;
      name: string;
      wipLimit: number | null;
      color: string;
    }>;
  }>;
}

interface ProvisionedCredential {
  name: string;
  email: string;
  role: string;
  teamSlug: string;
  temporaryPassword?: string;
  mustChangePassword: boolean;
}

interface RowError {
  row: number;
  email?: string;
  field: string;
  message: string;
}

const STEPS = [
  { number: 1, title: "Admin Account", required: true, icon: Shield },
  { number: 2, title: "Organization", required: true, icon: Building2 },
  { number: 3, title: "Teams", required: true, icon: Users },
  { number: 4, title: "Employees", required: false, icon: UserPlus },
  { number: 5, title: "Projects", required: false, icon: FolderKanban },
  { number: 6, title: "Boards", required: false, icon: Columns3 },
  { number: 7, title: "Review & Finish", required: true, icon: CheckCircle2 },
];

const slugifyClient = slugify;

import {
generateClientCryptoPassword,
generateClientSystemPassword,
} from "./setup/client-passwords";
import { WizardSortableColumnItem } from "./setup/WizardSortableColumnItem";

export function SetupWizard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [csrfToken, setCsrfToken] = useState("");
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);
  const [hasAdmin, setHasAdmin] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [skippedSteps, setSkippedSteps] = useState<number[]>([]);
  const [summary, setSummary] = useState<SetupSummary | null>(null);
  const [finishedSummary, setFinishedSummary] = useState<SetupSummary | null>(null);

  // Autosave indicator
  const [autosaveStatus, setAutosaveStatus] = useState<
    "idle" | "saving" | "saved"
  >("saved");
  const hydratedRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Error states
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Resume login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Step 1: Admin
  const [adminSetupToken, setAdminSetupToken] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  // Step 2: Org
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgSlugTouched, setOrgSlugTouched] = useState(false);
  const [orgDesc, setOrgDesc] = useState("");

  // Step 3: Teams
  const [teamsDraft, setTeamsDraft] = useState<SetupDraftTeam[]>([
    { name: "", slug: "", description: "", leadEmail: "" },
  ]);

  // Step 4: Employees + CSV
  const [employeesDraft, setEmployeesDraft] = useState<SetupDraftEmployee[]>([
    {
      name: "",
      email: "",
      role: "member",
      teamSlug: "",
      projects: [],
      roleNotes: "",
      temporaryPassword: "",
    },
  ]);
  const [employeeVisibleColumns, setEmployeeVisibleColumns] = useState<string[]>([
    "team",
    "projects",
    "roleNotes",
  ]);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<number>>(new Set());
  const [revealedPasswords, setRevealedPasswords] = useState<Record<number, boolean>>({});
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const [csvText, setCsvText] = useState("");
  const [provisionedCreds, setProvisionedCreds] = useState<
    ProvisionedCredential[]
  >([]);

  // Email validation errors and CSV skipped rows report
  const [employeeEmailErrors, setEmployeeEmailErrors] = useState<Record<number, string>>({});
  const initialEmployeeEmails = useRef<Record<number, string>>({});
  const emailCheckTimeoutRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [csvSkippedRows, setCsvSkippedRows] = useState<
    Array<{ line: number; row: number; email: string; reason: string }>
  >([]);

  // Step 7: CSV confirmation gate
  const [downloadedMembersCsv, setDownloadedMembersCsv] = useState(false);
  const [skippedMembersCsv, setSkippedMembersCsv] = useState(false);

  // Step 5: Projects
  const [projectsDraft, setProjectsDraft] = useState<SetupDraftProject[]>([
    { teamSlug: "", name: "", key: "", description: "" },
  ]);

  // Step 6: Boards
  const [boardsDraft, setBoardsDraft] = useState<SetupDraftBoard[]>([
    {
      projectKey: "",
      name: "",
      description: "",
      columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
    },
  ]);

  const wizardSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleWizardColumnDragEnd = (bIdx: number, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setBoardsDraft((prev) =>
      prev.map((b, idx) => {
        if (idx !== bIdx) return b;
        const colIds = b.columns.map((c, i) => c.id || `col-${bIdx}-${i}-${c.name}`);
        const oldIndex = colIds.indexOf(String(active.id));
        const newIndex = colIds.indexOf(String(over.id));
        if (oldIndex === -1 || newIndex === -1) return b;
        return {
          ...b,
          columns: arrayMove(b.columns, oldIndex, newIndex),
        };
      })
    );
  };

  const validateEmployeeEmail = useCallback(
    async (idx: number, emailVal: string) => {
      const norm = emailVal.trim().toLowerCase();
      if (!norm) {
        setEmployeeEmailErrors((prev) => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
        return;
      }

      // Check against Step 1 admin email
      const adminNorm = adminEmail.trim().toLowerCase();
      if (adminNorm && norm === adminNorm) {
        setEmployeeEmailErrors((prev) => ({
          ...prev,
          [idx]: `This email is already used by ${adminName || "Setup Admin"}.`,
        }));
        return;
      }

      // Check intra-draft duplicates
      for (let j = 0; j < employeesDraft.length; j++) {
        if (j !== idx && employeesDraft[j].email.trim().toLowerCase() === norm) {
          const otherName = employeesDraft[j].name.trim() || "another employee";
          setEmployeeEmailErrors((prev) => ({
            ...prev,
            [idx]: `This email is already used by ${otherName}.`,
          }));
          return;
        }
      }

      // Allow re-saving employee's own email (loaded from DB/initial state)
      const ownInitial = initialEmployeeEmails.current[idx];
      if (ownInitial && norm === ownInitial.toLowerCase()) {
        setEmployeeEmailErrors((prev) => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
        return;
      }

      try {
        const res = await fetch(`/api/setup/validate-email?email=${encodeURIComponent(norm)}`);
        const data = await res.json();
        if (!data.available) {
          setEmployeeEmailErrors((prev) => ({
            ...prev,
            [idx]: data.message || `This email is already used by ${data.usedBy || "another user"}.`,
          }));
        } else {
          setEmployeeEmailErrors((prev) => {
            const next = { ...prev };
            delete next[idx];
            return next;
          });
        }
      } catch {
        // Validation check network error
      }
    },
    [adminEmail, adminName, employeesDraft]
  );

  const debouncedValidateEmployeeEmail = useCallback(
    (idx: number, emailVal: string) => {
      if (emailCheckTimeoutRef.current[idx]) {
        clearTimeout(emailCheckTimeoutRef.current[idx]);
      }
      emailCheckTimeoutRef.current[idx] = setTimeout(() => {
        validateEmployeeEmail(idx, emailVal);
      }, 300);
    },
    [validateEmployeeEmail]
  );

  const hydrateFromSnapshot = useCallback((data: Record<string, unknown>) => {
    if (data.isCompleted && !finishedSummary) {
      router.replace("/");
      return;
    }
    setHasAdmin(Boolean(data.hasAdmin));
    setRequiresAuth(Boolean(data.requiresAuth));
    if (typeof data.csrfToken === "string" && data.csrfToken) {
      setCsrfToken(data.csrfToken);
    }
    if (typeof data.currentStep === "number") {
      setCurrentStep(data.currentStep);
    }
    if (Array.isArray(data.completedSteps)) {
      setCompletedSteps(data.completedSteps as number[]);
    }
    if (Array.isArray(data.skippedSteps)) {
      setSkippedSteps(data.skippedSteps as number[]);
    }
    if (data.summary) {
      setSummary(data.summary as SetupSummary);
    }

    const draft = (data.draftData || {}) as SetupDraftData;
    const sum = (data.summary || null) as SetupSummary | null;

    if (draft.admin) {
      setAdminName(draft.admin.name || "");
      setAdminEmail(draft.admin.email || "");
    } else if (sum?.admin) {
      setAdminName(sum.admin.name);
      setAdminEmail(sum.admin.email);
    }

    if (draft.org) {
      setOrgName(draft.org.name || "");
      setOrgSlug(draft.org.slug || "");
      if (draft.org.slug) setOrgSlugTouched(true);
      setOrgDesc(draft.org.description || "");
    } else if (sum?.org) {
      setOrgName(sum.org.name);
      setOrgSlug(sum.org.slug);
      setOrgSlugTouched(true);
      setOrgDesc(sum.org.description);
    }

    if (Array.isArray(draft.teams) && draft.teams.length > 0) {
      setTeamsDraft(
        draft.teams.map((t) => ({
          id: t.id,
          name: t.name || "",
          slug: t.slug || "",
          description: t.description || "",
          leadEmail: t.leadEmail || "",
        }))
      );
    }

    const defaultTeamSlug =
      draft.teams?.[0]?.slug || sum?.teams?.[0]?.slug || "";

    if (Array.isArray(draft.employeeVisibleColumns) && draft.employeeVisibleColumns.length > 0) {
      setEmployeeVisibleColumns(draft.employeeVisibleColumns);
    }

    if (Array.isArray(draft.employees) && draft.employees.length > 0) {
      const initialMap: Record<number, string> = {};
      draft.employees.forEach((e, idx) => {
        if (e.email) initialMap[idx] = e.email.trim().toLowerCase();
      });
      initialEmployeeEmails.current = initialMap;
      setEmployeesDraft(
        draft.employees.map((e) => ({
          id: e.id,
          name: e.name || "",
          email: e.email || "",
          role: e.role || "member",
          teamSlug: e.teamSlug || defaultTeamSlug,
          projects: e.projects ?? [],
          roleNotes: e.roleNotes || "",
          temporaryPassword: e.temporaryPassword || "",
        }))
      );
    } else if (defaultTeamSlug) {
      setEmployeesDraft((prev) =>
        prev.map((row) => ({
          ...row,
          teamSlug: row.teamSlug || defaultTeamSlug,
        }))
      );
    }

    if (Array.isArray(draft.projects) && draft.projects.length > 0) {
      setProjectsDraft(
        draft.projects.map((p) => ({
          id: p.id,
          teamSlug: p.teamSlug || defaultTeamSlug,
          name: p.name || "",
          key: p.key || "",
          description: p.description || "",
        }))
      );
    } else if (defaultTeamSlug) {
      setProjectsDraft((prev) =>
        prev.map((row) => ({
          ...row,
          teamSlug: row.teamSlug || defaultTeamSlug,
        }))
      );
    }

    const defaultProjKey =
      draft.projects?.[0]?.key || sum?.projects?.[0]?.key || "";

    if (Array.isArray(draft.boards) && draft.boards.length > 0) {
      setBoardsDraft(
        draft.boards.map((b) => ({
          id: b.id,
          projectKey: b.projectKey || defaultProjKey,
          name: b.name || "",
          description: b.description || "",
          columns:
            Array.isArray(b.columns) && b.columns.length > 0
              ? b.columns
              : DEFAULT_COLUMNS.map((c) => ({ ...c })),
        }))
      );
    } else if (defaultProjKey) {
      setBoardsDraft((prev) =>
        prev.map((row) => ({
          ...row,
          projectKey: row.projectKey || defaultProjKey,
        }))
      );
    }

    hydratedRef.current = true;
  }, [finishedSummary, router]);

  const loadSetup = useCallback(async () => {
    setLoading(true);
    setForbiddenError(null);
    try {
      const res = await fetch("/api/setup", { cache: "no-store" });
      const data = await res.json();
      if (res.status === 403) {
        setForbiddenError(
          data.error || "Only the organization administrator can access setup."
        );
        return;
      }
      hydrateFromSnapshot(data);
    } catch (err) {
      setBannerError(
        err instanceof Error ? err.message : "Failed to load setup state"
      );
    } finally {
      setLoading(false);
    }
  }, [hydrateFromSnapshot]);

  useEffect(() => {
    loadSetup();
  }, [loadSetup]);

  const buildCurrentDraftPayload = useCallback((): SetupDraftData => {
    return {
      admin: { name: adminName, email: adminEmail },
      org: { name: orgName, slug: orgSlug, description: orgDesc },
      teams: teamsDraft,
      employees: employeesDraft,
      employeeVisibleColumns,
      projects: projectsDraft,
      boards: boardsDraft,
    };
  }, [
    adminName,
    adminEmail,
    orgName,
    orgSlug,
    orgDesc,
    teamsDraft,
    employeesDraft,
    employeeVisibleColumns,
    projectsDraft,
    boardsDraft,
  ]);

  const triggerAutosave = useCallback(
    async (stepOverride?: number) => {
      if (!hydratedRef.current || requiresAuth || forbiddenError || finishedSummary) {
        return;
      }
      const effectiveStep = stepOverride ?? currentStep;
      if (effectiveStep === 4) {
        const seen = new Set<string>();
        const adminNorm = adminEmail.trim().toLowerCase();
        let hasDuplicate = false;
        for (const emp of employeesDraft) {
          const norm = emp.email.trim().toLowerCase();
          if (!norm) continue;
          if ((adminNorm && norm === adminNorm) || seen.has(norm)) {
            hasDuplicate = true;
            break;
          }
          seen.add(norm);
        }
        if (hasDuplicate || Object.keys(employeeEmailErrors).length > 0) {
          setAutosaveStatus("idle");
          return;
        }
      }
      setAutosaveStatus("saving");
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (csrfToken) headers["x-csrf-token"] = csrfToken;

        const res = await fetch("/api/setup", {
          method: "PUT",
          headers,
          body: JSON.stringify({
            currentStep: effectiveStep,
            draftData: buildCurrentDraftPayload(),
          }),
        });
        if (res.ok) {
          setAutosaveStatus("saved");
        }
      } catch {
        setAutosaveStatus("idle");
      }
    },
    [
      requiresAuth,
      forbiddenError,
      finishedSummary,
      csrfToken,
      currentStep,
      adminEmail,
      employeesDraft,
      employeeEmailErrors,
      buildCurrentDraftPayload,
    ]
  );

  // Debounced autosave on any field change
  useEffect(() => {
    if (!hydratedRef.current || requiresAuth || forbiddenError || finishedSummary) {
      return;
    }
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    setAutosaveStatus("saving");
    autosaveTimerRef.current = setTimeout(() => {
      triggerAutosave();
    }, 300);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    adminName,
    adminEmail,
    orgName,
    orgSlug,
    orgDesc,
    teamsDraft,
    employeesDraft,
    employeeVisibleColumns,
    projectsDraft,
    boardsDraft,
    requiresAuth,
    forbiddenError,
    finishedSummary,
    triggerAutosave,
  ]);

  const handleNavigateStep = async (targetStep: number) => {
    if (targetStep === currentStep) return;
    const isStepUnlocked =
      targetStep === 1 ||
      completedSteps.includes(targetStep) ||
      skippedSteps.includes(targetStep) ||
      completedSteps.includes(targetStep - 1) ||
      skippedSteps.includes(targetStep - 1);

    if (!isStepUnlocked) return;
    setBannerError(null);
    setFieldErrors({});
    setRowErrors([]);
    setCurrentStep(targetStep);
    await triggerAutosave(targetStep);
  };

  const handleResumeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Sign in failed");
      }
      setCsrfToken(data.csrfToken || "");
      setLoginPassword("");
      await loadSetup();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
      });
    } finally {
      setCsrfToken("");
      await loadSetup();
    }
  };

  const submitStep = async (
    stepNum: number,
    payload: Record<string, unknown>
  ) => {
    setBannerError(null);
    setFieldErrors({});
    setRowErrors([]);
    setSubmitting(true);

    if (stepNum === 4 && !payload.skip) {
      const seen = new Map<string, number>();
      const adminNorm = adminEmail.trim().toLowerCase();
      let hasDup = false;
      const nextErrors: Record<number, string> = { ...employeeEmailErrors };

      employeesDraft.forEach((emp, i) => {
        const norm = emp.email.trim().toLowerCase();
        if (!norm) return;
        if (adminNorm && norm === adminNorm) {
          nextErrors[i] = `This email is already used by ${adminName || "Setup Admin"}.`;
          hasDup = true;
        } else if (seen.has(norm)) {
          const priorIdx = seen.get(norm)!;
          const priorName = employeesDraft[priorIdx]?.name || "another employee";
          nextErrors[i] = `This email is already used by ${priorName}.`;
          hasDup = true;
        } else {
          seen.set(norm, i);
        }
      });

      if (hasDup || Object.keys(nextErrors).length > 0) {
        setEmployeeEmailErrors(nextErrors);
        const firstErr = Object.values(nextErrors)[0] || "Duplicate email detected";
        setBannerError(firstErr);
        setSubmitting(false);
        return;
      }
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;

      const res = await fetch(`/api/setup/step/${stepNum}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fields) setFieldErrors(data.fields);
        if (data.rowErrors) setRowErrors(data.rowErrors);
        if (res.status === 409 && data.error === "email_taken") {
          const msg = data.message || "This email is already used by another user.";
          setEmployeeEmailErrors((prev) => {
            const next = { ...prev };
            employeesDraft.forEach((emp, i) => {
              if (emp.email && (msg.toLowerCase().includes(emp.email.toLowerCase()) || Object.keys(next).length === 0)) {
                next[i] = msg;
              }
            });
            return next;
          });
        }
        throw new Error(data.message || data.error || `Step ${stepNum} validation failed`);
      }
      if (data.provisionedCredentials) {
        setProvisionedCreds(data.provisionedCredentials);
      }
      hydrateFromSnapshot(data);
      setAutosaveStatus("saved");
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : "Failed to save step");
    } finally {
      setSubmitting(false);
    }
  };

  const handleImportCsv = async (rawCsv: string) => {
    if (!rawCsv.trim()) {
      setBannerError("Paste CSV rows or select a CSV file to import");
      return;
    }
    setBannerError(null);
    setFieldErrors({});
    setRowErrors([]);
    setSubmitting(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;

      const res = await fetch("/api/setup/csv", {
        method: "POST",
        headers,
        body: JSON.stringify({ csv: rawCsv }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fields) setFieldErrors(data.fields);
        if (data.rowErrors) setRowErrors(data.rowErrors);
        throw new Error(data.error || "CSV validation failed");
      }
      if (Array.isArray(data.skippedRows) && data.skippedRows.length > 0) {
        setCsvSkippedRows(data.skippedRows);
      } else {
        setCsvSkippedRows([]);
      }
      if (data.provisionedCredentials) {
        setProvisionedCreds(data.provisionedCredentials);
      }
      hydrateFromSnapshot(data);
      setAutosaveStatus("saved");
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : "CSV import failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteSetup = async () => {
    setBannerError(null);
    setSubmitting(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;

      const res = await fetch("/api/setup/complete", {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fields) setFieldErrors(data.fields);
        throw new Error(data.error || "Failed to complete setup");
      }
      setFinishedSummary(data.summary as SetupSummary);
    } catch (err) {
      setBannerError(
        err instanceof Error ? err.message : "Failed to complete setup"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const availableTeams =
    summary?.teams && summary.teams.length > 0
      ? summary.teams
      : teamsDraft
          .filter((t) => t.name.trim())
          .map((t) => ({
            id: t.id || t.slug || slugifyClient(t.name),
            name: t.name,
            slug: t.slug || slugifyClient(t.name),
            description: t.description || "",
            leadEmail: t.leadEmail || "",
            leadName: "",
          }));

  const availableProjects =
    summary?.projects && summary.projects.length > 0
      ? summary.projects
      : projectsDraft
          .filter((p) => p.name.trim() && p.key.trim())
          .map((p) => ({
            id: p.id || p.key,
            teamId: "",
            teamSlug: p.teamSlug,
            teamName: p.teamSlug,
            name: p.name,
            key: p.key.toUpperCase(),
            description: p.description || "",
          }));

  const availableEmployees = summary?.employees || [];

  const progressPct = Math.round(
    (Math.min(7, Math.max(1, completedSteps.length + (finishedSummary ? 1 : 0))) /
      7) *
      100
  );

  if (loading) {
    return <SetupWizardSkeleton />;
  }

  if (forbiddenError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--pw-bg)] p-6 text-[var(--pw-ink)]">
        <div
          data-testid="setup-forbidden-banner"
          className="w-full max-w-md rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 shadow-[var(--pw-shadow)]"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--pw-urgent)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Setup Restricted to Administrator</span>
          </div>
          <p className="mt-2 text-xs text-[var(--pw-ink-secondary)]">
            {forbiddenError}
          </p>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign out and switch account</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--pw-bg)] text-[var(--pw-ink)] flex flex-col">
      {/* Persistent Top Bar + Required Notice Banner */}
      <header className="border-b border-[var(--pw-rail-border)] bg-[var(--pw-rail-bg)] text-[var(--pw-rail-ink)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-[var(--pw-accent)] font-mono text-xs font-bold text-white">
              PW
            </div>
            <h1 className="text-sm font-semibold text-white">
              Patchwork First-Run Initialization
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={`/documentation/getting-started/${currentStep === 1 ? "installation" : "setup-wizard"}/`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="setup-help-link"
              className="flex items-center gap-1.5 rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] px-2.5 py-1 text-xs text-[var(--pw-rail-ink)] hover:text-white transition"
            >
              <BookOpen className="h-3.5 w-3.5 text-[var(--pw-accent)]" />
              <span>Need help?</span>
            </a>
            <div
              data-testid="setup-autosave-status"
              className="flex items-center gap-1.5 rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--pw-rail-muted)]"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  autosaveStatus === "saving" ? "bg-amber-400" : "bg-emerald-400"
                }`}
              />
              <span>
                {autosaveStatus === "saving"
                  ? "Autosaving..."
                  : "All changes saved"}
              </span>
            </div>

            {hasAdmin && !requiresAuth && (
              <button
                type="button"
                data-testid="setup-logout-btn"
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] px-2.5 py-1 text-xs text-[var(--pw-rail-ink)] hover:text-white"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>

        <div
          data-testid="setup-notice-banner"
          className="border-t border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] px-6 py-2 text-xs text-[var(--pw-rail-ink)]"
        >
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--pw-accent)]" />
            <span>{SETUP_NOTICE}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6 lg:flex-row">
        {/* Left Step List & Progress Bar */}
        <aside className="w-full lg:w-72 shrink-0">
          <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="font-semibold">Setup Progress</span>
              <span
                data-testid="setup-progress-pct"
                className="font-mono text-[11px] tabular-nums text-[var(--pw-ink-secondary)]"
              >
                {progressPct}%
              </span>
            </div>
            <div
              data-testid="setup-progress-bar"
              className="mb-4 h-1.5 w-full overflow-hidden rounded bg-[var(--pw-surface-muted)]"
            >
              <div
                className="h-full w-full origin-left bg-[var(--pw-accent)] transition-transform duration-200 ease-out"
                style={{ transform: `scaleX(${progressPct / 100})` }}
              />
            </div>

            <nav
              data-testid="setup-step-list"
              aria-label="Setup steps"
              className="space-y-1"
            >
              {STEPS.map((s) => {
                const isDone =
                  completedSteps.includes(s.number) || Boolean(finishedSummary);
                const isSkipped =
                  skippedSteps.includes(s.number) && !isDone;
                const isCurrent =
                  currentStep === s.number && !finishedSummary;
                const statusLabel = isDone
                  ? "done"
                  : isCurrent
                    ? "in progress"
                    : isSkipped
                      ? "skipped"
                      : "not started";

                const canClick =
                  !requiresAuth &&
                  !finishedSummary &&
                  (s.number === 1 ||
                    isDone ||
                    isSkipped ||
                    isCurrent ||
                    completedSteps.includes(s.number - 1) ||
                    skippedSteps.includes(s.number - 1));

                const StepIcon = s.icon;

                return (
                  <button
                    key={s.number}
                    type="button"
                    disabled={!canClick}
                    data-testid={`setup-step-nav-${s.number}`}
                    data-status={statusLabel}
                    onClick={() => handleNavigateStep(s.number)}
                    className={`flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-xs transition ${
                      isCurrent
                        ? "border border-[var(--pw-accent)] bg-[var(--pw-accent-soft)] font-semibold text-[var(--pw-ink)]"
                        : isDone
                          ? "hover:bg-[var(--pw-surface-hover)] text-[var(--pw-ink)]"
                          : "text-[var(--pw-ink-secondary)] disabled:opacity-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <StepIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {s.number}. {s.title}
                      </span>
                    </div>
                    <span
                      data-testid={`setup-step-status-${s.number}`}
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                        isDone
                          ? "bg-emerald-500/15 text-[var(--pw-merged)]"
                          : isCurrent
                            ? "bg-[var(--pw-accent)] text-white"
                            : "bg-[var(--pw-surface-muted)] text-[var(--pw-ink-secondary)]"
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          {provisionedCreds.length > 0 && (
            <div
              data-testid="setup-generated-credentials"
              className="mt-4 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <KeyRound className="h-3.5 w-3.5 text-[var(--pw-accent)]" />
                <span>Provisioned Temporary Passwords</span>
              </div>
              <p className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                Save these credentials now. Each employee must change their password on first login.
              </p>
              <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                {provisionedCreds.map((c) => (
                  <div
                    key={c.email}
                    className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2 font-mono text-[11px]"
                  >
                    <div className="font-semibold">{c.email}</div>
                    <div className="text-[var(--pw-ink-secondary)]">
                      Role: {c.role} · Team: {c.teamSlug}
                    </div>
                    {c.temporaryPassword && (
                      <div
                        data-testid={`generated-pass-${c.email}`}
                        className="mt-0.5 text-[var(--pw-accent)]"
                      >
                        Temp Password: {c.temporaryPassword}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Right Active Step Panel */}
        <main className="flex-1">
          <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 shadow-[var(--pw-shadow)]">
            {bannerError && (
              <div
                data-testid="setup-error-banner"
                className="mb-4 flex items-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-[var(--pw-urgent)]"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{bannerError}</span>
              </div>
            )}

            {/* Resume Login View when Step 1 is done and admin is logged out */}
            {requiresAuth ? (
              <div data-testid="setup-resume-login-form">
                <h2 className="text-lg font-semibold">
                  Sign in as Administrator to Resume Setup
                </h2>
                <p className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                  Step 1 (Admin account) is already registered. Sign in with your administrator credentials to resume on Step {currentStep}. Registration is closed to other users until setup completes.
                </p>

                <form
                  onSubmit={handleResumeLogin}
                  className="mt-5 max-w-md space-y-4"
                >
                  <div>
                    <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                      Admin Email
                    </label>
                    <input
                      data-testid="setup-login-email"
                      type="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="admin@org.dev"
                      className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                      Password
                    </label>
                    <input
                      data-testid="setup-login-password"
                      type="password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    data-testid="setup-login-submit"
                    className="rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
                  >
                    {submitting ? "Signing in..." : "Resume Setup"}
                  </button>
                </form>
              </div>
            ) : finishedSummary ? (
              /* Final Completed Summary View */
              <div data-testid="setup-completed-screen" className="space-y-5">
                <div className="flex items-center gap-2 text-lg font-semibold text-[var(--pw-merged)]">
                  <CheckCircle2 className="h-5 w-5" />
                  <h2>Workspace Setup Complete</h2>
                </div>
                <p className="text-xs text-[var(--pw-ink-secondary)]">
                  Patchwork is initialized and /setup is now locked. Review your workspace summary below:
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3">
                    <div className="text-xs font-semibold">Organization</div>
                    <div className="mt-1 font-mono text-xs">
                      {finishedSummary.org?.name} ({finishedSummary.org?.slug})
                    </div>
                  </div>
                  <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3">
                    <div className="text-xs font-semibold">Teams & Members</div>
                    <div className="mt-1 font-mono text-xs tabular-nums">
                      {finishedSummary.teams.length} teams ·{" "}
                      {finishedSummary.employees.length + 1} users
                    </div>
                  </div>
                  <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3">
                    <div className="text-xs font-semibold">Projects & Boards</div>
                    <div className="mt-1 font-mono text-xs tabular-nums">
                      {finishedSummary.projects.length} projects ·{" "}
                      {finishedSummary.boards.length} boards
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    data-testid="setup-go-dashboard-btn"
                    onClick={() => {
                      window.location.href = "/";
                    }}
                    className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)]"
                  >
                    <span>Open Workspace Dashboard</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : currentStep === 1 ? (
              /* STEP 1: ADMIN ACCOUNT */
              <form
                data-testid="setup-step-1-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitStep(1, {
                    setupToken: adminSetupToken,
                    name: adminName,
                    email: adminEmail,
                    password: adminPassword,
                  });
                }}
                className="space-y-4 max-w-lg"
              >
                <div>
                  <h2 className="text-lg font-semibold">
                    Step 1: Administrator Account
                  </h2>
                  <p className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                    The first account registered becomes the organization administrator. Enter the one-time setup token generated by the CLI installer. Public registration remains closed to everyone else until setup completes.
                  </p>
                </div>

                {!hasAdmin && (
                  <div>
                    <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                      Setup Token
                    </label>
                    <input
                      data-testid="setup-admin-token"
                      type="password"
                      autoComplete="off"
                      value={adminSetupToken}
                      onChange={(e) => setAdminSetupToken(e.target.value)}
                      placeholder="32-character CLI setup token"
                      className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 font-mono text-sm"
                    />
                    {fieldErrors.setupToken && (
                      <p
                        data-testid="error-admin-token"
                        className="mt-1 text-xs text-[var(--pw-urgent)]"
                      >
                        {fieldErrors.setupToken}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                    Full Name
                  </label>
                  <input
                    data-testid="setup-admin-name"
                    type="text"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    placeholder="Grace Hopper"
                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-sm"
                  />
                  {fieldErrors.name && (
                    <p
                      data-testid="error-admin-name"
                      className="mt-1 text-xs text-[var(--pw-urgent)]"
                    >
                      {fieldErrors.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                    Work Email
                  </label>
                  <input
                    data-testid="setup-admin-email"
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="grace.hopper@orbital.dev"
                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-sm"
                  />
                  {fieldErrors.email && (
                    <p
                      data-testid="error-admin-email"
                      className="mt-1 text-xs text-[var(--pw-urgent)]"
                    >
                      {fieldErrors.email}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                    Password {hasAdmin ? "(leave blank to keep existing)" : "(8+ characters)"}
                  </label>
                  <input
                    data-testid="setup-admin-password"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-sm"
                  />
                  {fieldErrors.password && (
                    <p
                      data-testid="error-admin-password"
                      className="mt-1 text-xs text-[var(--pw-urgent)]"
                    >
                      {fieldErrors.password}
                    </p>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    data-testid="setup-step-1-submit"
                    className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
                  >
                    <span>
                      {hasAdmin
                        ? "Update Admin & Continue"
                        : "Create Admin & Continue"}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </form>
            ) : currentStep === 2 ? (
              /* STEP 2: ORGANIZATION */
              <form
                data-testid="setup-step-2-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitStep(2, {
                    name: orgName,
                    slug: orgSlug || slugifyClient(orgName),
                    description: orgDesc,
                  });
                }}
                className="space-y-4 max-w-lg"
              >
                <div>
                  <h2 className="text-lg font-semibold">
                    Step 2: Organization Details
                  </h2>
                  <p className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                    Configure your top-level engineering organization name, URL slug, and optional description.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                    Organization Name
                  </label>
                  <input
                    data-testid="setup-org-name"
                    type="text"
                    value={orgName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setOrgName(val);
                      if (!orgSlugTouched) {
                        setOrgSlug(slugifyClient(val));
                      }
                    }}
                    placeholder="Orbital Systems"
                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-sm"
                  />
                  {fieldErrors.name && (
                    <p
                      data-testid="error-org-name"
                      className="mt-1 text-xs text-[var(--pw-urgent)]"
                    >
                      {fieldErrors.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                    Organization Slug
                  </label>
                  <input
                    data-testid="setup-org-slug"
                    type="text"
                    value={orgSlug}
                    onChange={(e) => {
                      setOrgSlugTouched(true);
                      setOrgSlug(slugifyClient(e.target.value));
                    }}
                    placeholder="orbital-systems"
                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 font-mono text-xs"
                  />
                  {fieldErrors.slug && (
                    <p
                      data-testid="error-org-slug"
                      className="mt-1 text-xs text-[var(--pw-urgent)]"
                    >
                      {fieldErrors.slug}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                    Description (optional)
                  </label>
                  <textarea
                    data-testid="setup-org-description"
                    rows={3}
                    value={orgDesc}
                    onChange={(e) => setOrgDesc(e.target.value)}
                    placeholder="Avionics, propulsion, and flight telemetry engineering teams."
                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-xs"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => handleNavigateStep(1)}
                    className="flex items-center gap-1 rounded border border-[var(--pw-border)] px-3 py-2 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Back</span>
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    data-testid="setup-step-2-submit"
                    className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
                  >
                    <span>Save Organization & Continue</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </form>
            ) : currentStep === 3 ? (
              /* STEP 3: TEAMS */
              <form
                data-testid="setup-step-3-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitStep(3, { teams: teamsDraft });
                }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">
                      Step 3: Engineering Teams
                    </h2>
                    <p className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                      Create one or more teams. You can assign a Team Lead email now or return after adding employees in Step 4.
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="setup-add-team-btn"
                    onClick={() =>
                      setTeamsDraft((prev) => [
                        ...prev,
                        { name: "", slug: "", description: "", leadEmail: "" },
                      ])
                    }
                    className="flex items-center gap-1 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Team</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {teamsDraft.map((team, idx) => (
                    <div
                      key={idx}
                      className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-semibold text-[var(--pw-ink-secondary)]">
                          TEAM #{idx + 1}
                        </span>
                        {teamsDraft.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setTeamsDraft((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="text-[var(--pw-ink-muted)] hover:text-[var(--pw-urgent)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                        <div>
                          <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                            Team Name
                          </label>
                          <input
                            data-testid={`setup-team-name-${idx}`}
                            type="text"
                            value={team.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTeamsDraft((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        name: val,
                                        slug: slugifyClient(val),
                                      }
                                    : item
                                )
                              );
                            }}
                            placeholder="Flight Control"
                            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                            Slug
                          </label>
                          <input
                            data-testid={`setup-team-slug-${idx}`}
                            type="text"
                            value={team.slug || ""}
                            onChange={(e) => {
                              const val = slugifyClient(e.target.value);
                              setTeamsDraft((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, slug: val } : item
                                )
                              );
                            }}
                            placeholder="flight-control"
                            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 font-mono text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                            Team Lead Email (optional)
                          </label>
                          <input
                            data-testid={`setup-team-lead-${idx}`}
                            type="email"
                            list="setup-known-employees"
                            value={team.leadEmail || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTeamsDraft((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, leadEmail: val } : item
                                )
                              );
                            }}
                            placeholder="lead@orbital.dev"
                            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                          />
                        </div>
                      </div>

                      <div>
                        <input
                          data-testid={`setup-team-desc-${idx}`}
                          type="text"
                          value={team.description || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTeamsDraft((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, description: val } : item
                              )
                            );
                          }}
                          placeholder="Team description (optional)"
                          className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <datalist id="setup-known-employees">
                  {availableEmployees.map((emp) => (
                    <option key={emp.email} value={emp.email}>
                      {emp.name}
                    </option>
                  ))}
                </datalist>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => handleNavigateStep(2)}
                    className="flex items-center gap-1 rounded border border-[var(--pw-border)] px-3 py-2 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Back</span>
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    data-testid="setup-step-3-submit"
                    className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
                  >
                    <span>Save Teams & Continue</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </form>
            ) : currentStep === 4 ? (
              /* STEP 4: EMPLOYEES (MANUAL + CSV IMPORT) */
              <div data-testid="setup-step-4-form" className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">
                      Step 4: Employees & Roles (Optional)
                    </h2>
                    <p className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                      Add users manually or bulk import via CSV. System-generated name-derived passwords are assigned automatically; users must change them on first login.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <button
                        type="button"
                        data-testid="setup-columns-menu-btn"
                        onClick={() => setColumnsMenuOpen((p) => !p)}
                        className="flex items-center gap-1.5 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        <span>Columns</span>
                      </button>

                      {columnsMenuOpen && (
                        <div
                          data-testid="setup-columns-menu"
                          className="absolute right-0 top-full z-30 mt-1 w-56 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2 shadow-lg space-y-1 text-xs"
                        >
                          <div className="px-1 py-0.5 text-[10px] font-mono uppercase text-[var(--pw-ink-muted)]">
                            Toggle Columns
                          </div>
                          <div className="flex items-center justify-between px-1.5 py-1 text-[var(--pw-ink-muted)]">
                            <span className="flex items-center gap-1.5">
                              <Lock className="h-3 w-3" />
                              <span>Name (required)</span>
                            </span>
                            <input type="checkbox" checked disabled />
                          </div>
                          <div className="flex items-center justify-between px-1.5 py-1 text-[var(--pw-ink-muted)]">
                            <span className="flex items-center gap-1.5">
                              <Lock className="h-3 w-3" />
                              <span>Email (required)</span>
                            </span>
                            <input type="checkbox" checked disabled />
                          </div>
                          <div className="flex items-center justify-between px-1.5 py-1 text-[var(--pw-ink-muted)]">
                            <span className="flex items-center gap-1.5">
                              <Lock className="h-3 w-3" />
                              <span>Role (required)</span>
                            </span>
                            <input type="checkbox" checked disabled />
                          </div>
                          <div className="flex items-center justify-between px-1.5 py-1 text-[var(--pw-ink-muted)]">
                            <span className="flex items-center gap-1.5">
                              <Lock className="h-3 w-3" />
                              <span>Password (required)</span>
                            </span>
                            <input type="checkbox" checked disabled />
                          </div>
                          <hr className="border-[var(--pw-border)] my-1" />
                          <label className="flex items-center justify-between px-1.5 py-1 cursor-pointer hover:bg-[var(--pw-surface-hover)] rounded">
                            <span>Team</span>
                            <input
                              data-testid="toggle-col-team"
                              type="checkbox"
                              checked={employeeVisibleColumns.includes("team")}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEmployeeVisibleColumns((prev) => [...prev, "team"]);
                                } else {
                                  setEmployeeVisibleColumns((prev) =>
                                    prev.filter((c) => c !== "team")
                                  );
                                }
                              }}
                            />
                          </label>
                          <label className="flex items-center justify-between px-1.5 py-1 cursor-pointer hover:bg-[var(--pw-surface-hover)] rounded">
                            <span>Projects</span>
                            <input
                              data-testid="toggle-col-projects"
                              type="checkbox"
                              checked={employeeVisibleColumns.includes("projects")}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEmployeeVisibleColumns((prev) => [...prev, "projects"]);
                                } else {
                                  setEmployeeVisibleColumns((prev) =>
                                    prev.filter((c) => c !== "projects")
                                  );
                                }
                              }}
                            />
                          </label>
                          <label className="flex items-center justify-between px-1.5 py-1 cursor-pointer hover:bg-[var(--pw-surface-hover)] rounded">
                            <span>Role notes</span>
                            <input
                              data-testid="toggle-col-role-notes"
                              type="checkbox"
                              checked={employeeVisibleColumns.includes("roleNotes")}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEmployeeVisibleColumns((prev) => [...prev, "roleNotes"]);
                                } else {
                                  setEmployeeVisibleColumns((prev) =>
                                    prev.filter((c) => c !== "roleNotes")
                                  );
                                }
                              }}
                            />
                          </label>
                        </div>
                      )}
                    </div>

                    <a
                      href="/api/setup/csv-template"
                      download="patchwork-employees-template.csv"
                      data-testid="setup-csv-template-link"
                      className="flex items-center gap-1.5 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download CSV Template</span>
                    </a>
                  </div>
                </div>

                {rowErrors.length > 0 && (
                  <div
                    data-testid="setup-csv-errors"
                    className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-[var(--pw-urgent)] space-y-1"
                  >
                    <div className="font-semibold">
                      Validation Errors ({rowErrors.length} invalid row
                      {rowErrors.length === 1 ? "" : "s"}):
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {rowErrors.map((re, idx) => (
                        <li key={idx}>{re.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Bulk CSV Import Box */}
                {csvSkippedRows.length > 0 && (
                  <div
                    data-testid="setup-csv-skipped-report"
                    className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between font-semibold text-amber-600 dark:text-amber-400">
                      <span>
                        Skipped Rows Report ({csvSkippedRows.length} row
                        {csvSkippedRows.length === 1 ? "" : "s"} skipped):
                      </span>
                      <button
                        type="button"
                        onClick={() => setCsvSkippedRows([])}
                        className="text-[10px] text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)] underline"
                      >
                        Dismiss
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left font-mono text-[11px]">
                        <thead>
                          <tr className="border-b border-amber-500/20 text-[var(--pw-ink-muted)]">
                            <th className="py-1 pr-3">Line</th>
                            <th className="py-1 pr-3">Email</th>
                            <th className="py-1">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvSkippedRows.map((sr, idx) => (
                            <tr key={idx} className="border-b border-amber-500/10">
                              <td className="py-1 pr-3 font-semibold">{sr.line}</td>
                              <td className="py-1 pr-3">{sr.email || "(empty)"}</td>
                              <td className="py-1 font-semibold text-amber-600 dark:text-amber-400">
                                {sr.reason}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--pw-accent)]" />
                      <span>Bulk Import via CSV</span>
                    </span>
                    <label className="flex cursor-pointer items-center gap-1 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--pw-surface-hover)]">
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload .csv File</span>
                      <input
                        data-testid="setup-csv-file-input"
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const text = await f.text();
                          setCsvText(text);
                          await handleImportCsv(text);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>

                  <textarea
                    data-testid="setup-csv-textarea"
                    rows={3}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder={
                      "name,email,role,team,password\nAlan Shepard,alan@orbital.dev,team lead,flight-control,\nMargaret Hamilton,margaret@orbital.dev,member,flight-control,"
                    }
                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2 font-mono text-xs"
                  />

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={submitting}
                      data-testid="setup-csv-import-btn"
                      onClick={() => handleImportCsv(csvText)}
                      className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--pw-surface-hover)]"
                    >
                      Import CSV Rows
                    </button>
                  </div>
                </div>

                {/* Manual Employee Form */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitStep(4, { employees: employeesDraft });
                  }}
                  className="space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                        <input
                          data-testid="setup-emp-select-all"
                          type="checkbox"
                          checked={
                            employeesDraft.length > 0 &&
                            selectedEmployees.size === employeesDraft.length
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedEmployees(
                                new Set(employeesDraft.map((_, i) => i))
                              );
                            } else {
                              setSelectedEmployees(new Set());
                            }
                          }}
                          className="rounded border-[var(--pw-border)]"
                        />
                        <span>Select All</span>
                      </label>

                      {selectedEmployees.size > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-[var(--pw-ink-secondary)]">
                            {selectedEmployees.size} selected:
                          </span>
                          <button
                            type="button"
                            data-testid="setup-bulk-reset-sys"
                            onClick={() => {
                              setEmployeesDraft((prev) =>
                                prev.map((r, i) =>
                                  selectedEmployees.has(i)
                                    ? {
                                        ...r,
                                        temporaryPassword: generateClientSystemPassword(
                                          r.name
                                        ),
                                      }
                                    : r
                                )
                              );
                            }}
                            className="flex items-center gap-1 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1 text-xs hover:bg-[var(--pw-surface-hover)]"
                          >
                            <RefreshCw className="h-3 w-3" />
                            <span>Reset to system password</span>
                          </button>
                          <button
                            type="button"
                            data-testid="setup-bulk-gen-random"
                            onClick={() => {
                              setEmployeesDraft((prev) =>
                                prev.map((r, i) =>
                                  selectedEmployees.has(i)
                                    ? {
                                        ...r,
                                        temporaryPassword: generateClientCryptoPassword(
                                          16
                                        ),
                                      }
                                    : r
                                )
                              );
                            }}
                            className="flex items-center gap-1 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1 text-xs hover:bg-[var(--pw-surface-hover)]"
                          >
                            <Sparkles className="h-3 w-3" />
                            <span>Generate random password</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      data-testid="setup-add-emp-btn"
                      onClick={() =>
                        setEmployeesDraft((prev) => [
                          ...prev,
                          {
                            name: "",
                            email: "",
                            role: "member",
                            teamSlug: availableTeams[0]?.slug || "",
                            projects: [],
                            roleNotes: "",
                            temporaryPassword: generateClientSystemPassword(""),
                          },
                        ])
                      }
                      className="flex items-center gap-1 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Employee Row</span>
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {employeesDraft.map((emp, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col gap-2 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            data-testid={`setup-emp-select-${idx}`}
                            type="checkbox"
                            checked={selectedEmployees.has(idx)}
                            onChange={(e) => {
                              setSelectedEmployees((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(idx);
                                else next.delete(idx);
                                return next;
                              });
                            }}
                            className="rounded border-[var(--pw-border)] mr-1"
                          />

                          {/* Name (Required, locked) */}
                          <input
                            data-testid={`setup-emp-name-${idx}`}
                            type="text"
                            value={emp.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEmployeesDraft((prev) =>
                                prev.map((r, i) => {
                                  if (i !== idx) return r;
                                  const temporaryPassword =
                                    r.temporaryPassword && r.temporaryPassword.trim()
                                      ? r.temporaryPassword
                                      : generateClientSystemPassword(val);
                                  return { ...r, name: val, temporaryPassword };
                                })
                              );
                            }}
                            placeholder="Full name"
                            className="flex-1 min-w-[130px] rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                          />

                          {/* Email (Required, locked) */}
                          <div className="flex-1 min-w-[150px] flex flex-col">
                            <input
                              data-testid={`setup-emp-email-${idx}`}
                              type="email"
                              value={emp.email}
                              onBlur={() => validateEmployeeEmail(idx, emp.email)}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEmployeesDraft((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, email: val } : r
                                  )
                                );
                                debouncedValidateEmployeeEmail(idx, val);
                              }}
                              placeholder="user@orbital.dev"
                              className={`w-full rounded border bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs ${
                                employeeEmailErrors[idx]
                                  ? "border-red-500 focus:border-red-500"
                                  : "border-[var(--pw-border)]"
                              }`}
                            />
                            {employeeEmailErrors[idx] && (
                              <span
                                data-testid={`setup-emp-email-error-${idx}`}
                                className="mt-1 text-[11px] font-medium text-red-500 flex items-center gap-1"
                              >
                                <AlertTriangle className="h-3 w-3 inline shrink-0" />
                                <span>{employeeEmailErrors[idx]}</span>
                              </span>
                            )}
                          </div>

                          {/* Role (Required, locked) */}
                          <select
                            data-testid={`setup-emp-role-${idx}`}
                            value={emp.role}
                            onChange={(e) => {
                              const val = e.target.value as SetupDraftEmployee["role"];
                              setEmployeesDraft((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, role: val } : r
                                )
                              );
                            }}
                            className="w-28 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1.5 font-mono text-xs"
                          >
                            <option value="admin">admin</option>
                            <option value="lead">team lead</option>
                            <option value="member">member</option>
                            <option value="viewer">viewer</option>
                          </select>

                          {/* Optional Column: Team */}
                          {employeeVisibleColumns.includes("team") && (
                            <select
                              data-testid={`setup-emp-team-${idx}`}
                              value={emp.teamSlug || availableTeams[0]?.slug || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEmployeesDraft((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, teamSlug: val } : r
                                  )
                                );
                              }}
                              className="w-32 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1.5 font-mono text-xs"
                            >
                              {availableTeams.map((t) => (
                                <option key={t.slug} value={t.slug}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          )}

                          {/* Optional Column: Projects */}
                          {employeeVisibleColumns.includes("projects") && (
                            <input
                              data-testid={`setup-emp-projects-${idx}`}
                              type="text"
                              value={(emp.projects || []).join("; ")}
                              onChange={(e) => {
                                const val = e.target.value
                                  .split(";")
                                  .map((p) => p.trim())
                                  .filter(Boolean);
                                setEmployeesDraft((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, projects: val } : r
                                  )
                                );
                              }}
                              placeholder="Projects (semicolon-separated)"
                              className="flex-1 min-w-[130px] rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                            />
                          )}

                          {/* Optional Column: Role Notes */}
                          {employeeVisibleColumns.includes("roleNotes") && (
                            <input
                              data-testid={`setup-emp-notes-${idx}`}
                              type="text"
                              value={emp.roleNotes || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEmployeesDraft((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, roleNotes: val } : r
                                  )
                                );
                              }}
                              placeholder="Role notes"
                              className="flex-1 min-w-[120px] rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                            />
                          )}

                          {/* Password Field (Required, masked, reveal, copy, reset, gen random) */}
                          <div className="flex items-center gap-1 min-w-[210px]">
                            <input
                              data-testid={`setup-emp-password-${idx}`}
                              type={revealedPasswords[idx] ? "text" : "password"}
                              value={emp.temporaryPassword || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEmployeesDraft((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, temporaryPassword: val } : r
                                  )
                                );
                              }}
                              placeholder="Password"
                              className="w-28 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1.5 font-mono text-xs"
                            />

                            <button
                              type="button"
                              title={
                                revealedPasswords[idx]
                                  ? "Hide password"
                                  : "Reveal password"
                              }
                              data-testid={`setup-emp-reveal-${idx}`}
                              onClick={() =>
                                setRevealedPasswords((prev) => ({
                                  ...prev,
                                  [idx]: !prev[idx],
                                }))
                              }
                              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-1.5 text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)]"
                            >
                              {revealedPasswords[idx] ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>

                            <button
                              type="button"
                              title="Copy password"
                              data-testid={`setup-emp-copy-${idx}`}
                              onClick={async () => {
                                if (emp.temporaryPassword) {
                                  await navigator.clipboard.writeText(
                                    emp.temporaryPassword
                                  );
                                  setCopiedIdx(idx);
                                  setTimeout(() => setCopiedIdx(null), 1500);
                                }
                              }}
                              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-1.5 text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)]"
                            >
                              {copiedIdx === idx ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>

                            <button
                              type="button"
                              title="Reset to system password"
                              data-testid={`setup-emp-reset-sys-${idx}`}
                              onClick={() => {
                                const sys = generateClientSystemPassword(emp.name);
                                setEmployeesDraft((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, temporaryPassword: sys } : r
                                  )
                                );
                              }}
                              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-1.5 text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)]"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              title="Generate random password"
                              data-testid={`setup-emp-gen-random-${idx}`}
                              onClick={() => {
                                const rand = generateClientCryptoPassword(16);
                                setEmployeesDraft((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, temporaryPassword: rand } : r
                                  )
                                );
                              }}
                              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-1.5 text-[var(--pw-ink-muted)] hover:text-[var(--pw-accent)] hover:bg-[var(--pw-surface-hover)]"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                            </button>

                            {employeesDraft.length > 1 && (
                              <button
                                type="button"
                                title="Remove row"
                                onClick={() => {
                                  setEmployeesDraft((prev) =>
                                    prev.filter((_, i) => i !== idx)
                                  );
                                  setSelectedEmployees((prev) => {
                                    const next = new Set(prev);
                                    next.delete(idx);
                                    return next;
                                  });
                                }}
                                className="rounded p-1 text-[var(--pw-ink-muted)] hover:text-[var(--pw-urgent)] ml-1"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                    <button
                      type="button"
                      onClick={() => handleNavigateStep(3)}
                      className="flex items-center gap-1 rounded border border-[var(--pw-border)] px-3 py-2 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      <span>Back</span>
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={submitting}
                        data-testid="setup-step-4-skip"
                        onClick={() => submitStep(4, { skip: true })}
                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                      >
                        Skip for now
                      </button>
                      <button
                        type="submit"
                        disabled={submitting}
                        data-testid="setup-step-4-submit"
                        className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
                      >
                        <span>Save Employees & Continue</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            ) : currentStep === 5 ? (
              /* STEP 5: PROJECTS */
              <form
                data-testid="setup-step-5-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitStep(5, { projects: projectsDraft });
                }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">
                      Step 5: Projects (Optional)
                    </h2>
                    <p className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                      Create projects under your teams. Each project has a unique uppercase ticket key prefix (e.g. TELE).
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="setup-add-proj-btn"
                    onClick={() =>
                      setProjectsDraft((prev) => [
                        ...prev,
                        {
                          teamSlug: availableTeams[0]?.slug || "",
                          name: "",
                          key: "",
                          description: "",
                        },
                      ])
                    }
                    className="flex items-center gap-1 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Project</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {projectsDraft.map((proj, idx) => (
                    <div
                      key={idx}
                      className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3.5 space-y-2.5"
                    >
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                        <div>
                          <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                            Team
                          </label>
                          <select
                            data-testid={`setup-proj-team-${idx}`}
                            value={proj.teamSlug || availableTeams[0]?.slug || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setProjectsDraft((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, teamSlug: val } : item
                                )
                              );
                            }}
                            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 font-mono text-xs"
                          >
                            {availableTeams.map((t) => (
                              <option key={t.slug} value={t.slug}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                            Project Name
                          </label>
                          <input
                            data-testid={`setup-proj-name-${idx}`}
                            type="text"
                            value={proj.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              const autoKey = val
                                .replace(/[^a-zA-Z0-9]/g, "")
                                .toUpperCase()
                                .slice(0, 4);
                              setProjectsDraft((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        name: val,
                                        key: item.key || autoKey,
                                        teamSlug:
                                          item.teamSlug ||
                                          availableTeams[0]?.slug ||
                                          "",
                                      }
                                    : item
                                )
                              );
                            }}
                            placeholder="Telemetry Core"
                            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                            Ticket Key Prefix
                          </label>
                          <input
                            data-testid={`setup-proj-key-${idx}`}
                            type="text"
                            maxLength={10}
                            value={proj.key}
                            onChange={(e) => {
                              const val = e.target.value
                                .toUpperCase()
                                .replace(/[^A-Z0-9]/g, "");
                              setProjectsDraft((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, key: val } : item
                                )
                              );
                            }}
                            placeholder="TELE"
                            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 font-mono text-xs uppercase"
                          />
                        </div>
                      </div>

                      <input
                        data-testid={`setup-proj-desc-${idx}`}
                        type="text"
                        value={proj.description || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setProjectsDraft((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, description: val } : item
                            )
                          );
                        }}
                        placeholder="Project description (optional)"
                        className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleNavigateStep(4)}
                    className="flex items-center gap-1 rounded border border-[var(--pw-border)] px-3 py-2 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Back</span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      data-testid="setup-step-5-skip"
                      onClick={() => submitStep(5, { skip: true })}
                      className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                    >
                      Skip for now
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      data-testid="setup-step-5-submit"
                      className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
                    >
                      <span>Save Projects & Continue</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </form>
            ) : currentStep === 6 ? (
              /* STEP 6: BOARDS & EDITABLE DEFAULT COLUMNS */
              <form
                data-testid="setup-step-6-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitStep(6, { boards: boardsDraft });
                }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">
                      Step 6: Kanban Boards & Columns (Optional)
                    </h2>
                    <p className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                      Create boards under your projects. Default columns (Backlog, In Progress, Review, Done) can be customized below.
                    </p>
                  </div>
                  {availableProjects.length > 0 && (
                    <button
                      type="button"
                      data-testid="setup-add-board-btn"
                      onClick={() =>
                        setBoardsDraft((prev) => [
                          ...prev,
                          {
                            projectKey: availableProjects[0]?.key || "",
                            name: "",
                            description: "",
                            columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
                          },
                        ])
                      }
                      className="flex items-center gap-1 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Board</span>
                    </button>
                  )}
                </div>

                {availableProjects.length === 0 ? (
                  <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-4 text-xs text-[var(--pw-ink-secondary)]">
                    No projects were created in Step 5. You can go back to Step 5 to add a project or skip Step 6 and create boards later from the workspace.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {boardsDraft.map((board, bIdx) => (
                      <div
                        key={bIdx}
                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-4 space-y-3"
                      >
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <div>
                            <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                              Project
                            </label>
                            <select
                              data-testid={`setup-board-proj-${bIdx}`}
                              value={
                                board.projectKey ||
                                availableProjects[0]?.key ||
                                ""
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                setBoardsDraft((prev) =>
                                  prev.map((item, i) =>
                                    i === bIdx
                                      ? { ...item, projectKey: val }
                                      : item
                                  )
                                );
                              }}
                              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 font-mono text-xs"
                            >
                              {availableProjects.map((p) => (
                                <option key={p.key} value={p.key}>
                                  {p.name} ({p.key})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                              Board Name
                            </label>
                            <input
                              data-testid={`setup-board-name-${bIdx}`}
                              type="text"
                              value={board.name}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBoardsDraft((prev) =>
                                  prev.map((item, i) =>
                                    i === bIdx
                                      ? {
                                          ...item,
                                          name: val,
                                          projectKey:
                                            item.projectKey ||
                                            availableProjects[0]?.key ||
                                            "",
                                        }
                                      : item
                                  )
                                );
                              }}
                              placeholder="Mission Board"
                              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                            />
                          </div>
                        </div>

                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="font-mono text-[11px] font-semibold text-[var(--pw-ink-secondary)]">
                              COLUMNS (EDITABLE)
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setBoardsDraft((prev) =>
                                  prev.map((item, i) =>
                                    i === bIdx
                                      ? {
                                          ...item,
                                          columns: [
                                            ...item.columns,
                                            {
                                              name: "",
                                              wipLimit: null,
                                              color: "#434B56",
                                            },
                                          ],
                                        }
                                      : item
                                  )
                                )
                              }
                              className="font-mono text-[11px] text-[var(--pw-accent)] hover:underline"
                            >
                              + Add Column
                            </button>
                          </div>

                          <DndContext
                            sensors={wizardSensors}
                            onDragEnd={(event) =>
                              handleWizardColumnDragEnd(bIdx, event)
                            }
                          >
                            <SortableContext
                              items={board.columns.map(
                                (c, i) =>
                                  c.id || `col-${bIdx}-${i}-${c.name}`
                              )}
                              strategy={horizontalListSortingStrategy}
                            >
                              <div className="flex gap-2.5 overflow-x-auto pb-2 items-start">
                                {board.columns.map((col, cIdx) => (
                                  <WizardSortableColumnItem
                                    key={
                                      col.id ||
                                      `col-${bIdx}-${cIdx}-${col.name}`
                                    }
                                    id={
                                      col.id ||
                                      `col-${bIdx}-${cIdx}-${col.name}`
                                    }
                                    boardIndex={bIdx}
                                    columnIndex={cIdx}
                                    col={col}
                                    onUpdate={(updated) => {
                                      setBoardsDraft((prev) =>
                                        prev.map((item, i) =>
                                          i === bIdx
                                            ? {
                                                ...item,
                                                columns: item.columns.map(
                                                  (c, j) =>
                                                    j === cIdx
                                                      ? {
                                                          ...c,
                                                          name: updated.name,
                                                          wipLimit:
                                                            updated.wipLimit,
                                                          color:
                                                            updated.color,
                                                        }
                                                      : c
                                                ),
                                              }
                                            : item
                                        )
                                      );
                                    }}
                                    onDelete={() => {
                                      if (board.columns.length <= 1) return;
                                      setBoardsDraft((prev) =>
                                        prev.map((item, i) =>
                                          i === bIdx
                                            ? {
                                                ...item,
                                                columns: item.columns.filter(
                                                  (_, j) => j !== cIdx
                                                ),
                                              }
                                            : item
                                        )
                                      );
                                    }}
                                  />
                                ))}
                              </div>
                            </SortableContext>
                          </DndContext>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleNavigateStep(5)}
                    className="flex items-center gap-1 rounded border border-[var(--pw-border)] px-3 py-2 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Back</span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      data-testid="setup-step-6-skip"
                      onClick={() => submitStep(6, { skip: true })}
                      className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                    >
                      Skip for now
                    </button>
                    {availableProjects.length > 0 && (
                      <button
                        type="submit"
                        disabled={submitting}
                        data-testid="setup-step-6-submit"
                        className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
                      >
                        <span>Save Boards & Continue</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </form>
            ) : (
              /* STEP 7: REVIEW & FINISH */
              <div data-testid="setup-review-summary" className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">
                    Step 7: Review and Finish
                  </h2>
                  <p className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                    Review everything created so far. You can click any completed step on the left to make edits, or click Complete setup to lock initialization and launch your workspace.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3.5">
                    <div className="text-xs font-semibold">1. Admin Account</div>
                    <div className="mt-1 font-mono text-xs">
                      {summary?.admin?.name} ({summary?.admin?.email})
                    </div>
                  </div>

                  <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3.5">
                    <div className="text-xs font-semibold">2. Organization</div>
                    <div className="mt-1 font-mono text-xs">
                      {summary?.org?.name || "Not created"} (
                      {summary?.org?.slug || "-"})
                    </div>
                  </div>

                  <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3.5">
                    <div className="text-xs font-semibold">
                      3. Teams ({summary?.teams.length || 0})
                    </div>
                    <div className="mt-1 space-y-1 text-xs">
                      {(summary?.teams || []).map((t) => (
                        <div key={t.id} className="font-mono text-[11px]">
                          {t.name} ({t.slug})
                          {t.leadEmail ? ` · Lead: ${t.leadEmail}` : ""}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3.5">
                    <div className="text-xs font-semibold">
                      4. Employees ({summary?.employees.length || 0})
                    </div>
                    {summary?.employees.length ? (
                      <div className="mt-1 space-y-1 text-xs">
                        {summary.employees.map((emp) => {
                          const roleLabel =
                            emp.role ? emp.role.charAt(0).toUpperCase() + emp.role.slice(1) : "Member";
                          return (
                            <div key={emp.id} className="flex items-center justify-between font-mono text-[11px]">
                              <span>{emp.name} ({emp.email})</span>
                              {emp.role === "admin" ? (
                                <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20">
                                  Admin
                                </span>
                              ) : emp.teamName ? (
                                <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium border bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">
                                  {emp.teamName} · {roleLabel}
                                </span>
                              ) : (
                                <span className="text-[10px] text-[var(--pw-ink-tertiary)] italic">
                                  No team
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                        Skipped (can be added later in workspace)
                      </div>
                    )}
                  </div>

                  <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3.5">
                    <div className="text-xs font-semibold">
                      5. Projects ({summary?.projects.length || 0})
                    </div>
                    {summary?.projects.length ? (
                      <div className="mt-1 space-y-1 text-xs">
                        {summary.projects.map((p) => (
                          <div key={p.id} className="font-mono text-[11px]">
                            [{p.key}] {p.name} ({p.teamName})
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                        Skipped (can be created later in workspace)
                      </div>
                    )}
                  </div>

                  <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3.5">
                    <div className="text-xs font-semibold">
                      6. Boards ({summary?.boards.length || 0})
                    </div>
                    {summary?.boards.length ? (
                      <div className="mt-1 space-y-1 text-xs">
                        {summary.boards.map((b) => (
                          <div key={b.id} className="font-mono text-[11px]">
                            {b.name} ({b.columns.length} columns)
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
                        Skipped (can be created later in workspace)
                      </div>
                    )}
                  </div>
                </div>

                {/* Step 7 Credentials Download & Confirmation Gate */}
                <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="text-xs font-semibold text-[var(--pw-ink)]">
                        Download Member Credentials
                      </h3>
                      <p className="text-xs text-[var(--pw-ink-secondary)]">
                        This file contains passwords. Store it securely and delete it after distributing credentials. Passwords can&apos;t be downloaded again after setup is completed.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-amber-500/20">
                    <a
                      href="/api/setup/csv"
                      download={`patchwork-members-${new Date().toISOString().slice(0, 10)}.csv`}
                      data-testid="setup-download-members-csv-btn"
                      onClick={() => setDownloadedMembersCsv(true)}
                      className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--pw-accent-hover)]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download members CSV</span>
                    </a>

                    <div className="flex items-center gap-4 text-xs">
                      <label className="flex items-center gap-2 cursor-pointer font-medium text-[var(--pw-ink)]">
                        <input
                          data-testid="setup-confirm-csv-downloaded-checkbox"
                          type="checkbox"
                          checked={downloadedMembersCsv}
                          onChange={(e) => setDownloadedMembersCsv(e.target.checked)}
                          className="rounded border-[var(--pw-border)]"
                        />
                        <span>I have downloaded the members CSV</span>
                      </label>

                      <button
                        type="button"
                        data-testid="setup-skip-csv-download-btn"
                        onClick={() => setSkippedMembersCsv(true)}
                        className={`text-xs underline hover:text-[var(--pw-ink)] ${
                          skippedMembersCsv
                            ? "text-[var(--pw-ink)] font-semibold"
                            : "text-[var(--pw-ink-muted)]"
                        }`}
                      >
                        {skippedMembersCsv ? "CSV download skipped" : "Skip"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => handleNavigateStep(6)}
                    className="flex items-center gap-1 rounded border border-[var(--pw-border)] px-3 py-2 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Back</span>
                  </button>
                  <button
                    type="button"
                    disabled={submitting || (!downloadedMembersCsv && !skippedMembersCsv)}
                    data-testid="setup-complete-btn"
                    onClick={handleCompleteSetup}
                    className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-5 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{submitting ? "Completing..." : "Complete setup"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

