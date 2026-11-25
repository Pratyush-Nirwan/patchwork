"use client";

import React,{ useState,useEffect,useCallback } from "react";
import Link from "next/link";
import { displayVersion } from "@/lib/version";
import { SystemConfigSkeleton } from "@/components/skeletons/SystemConfigSkeleton";
import { Fade,RegionErrorBoundary } from "@/components/ui/motion";
import {
Users,
Building2,
FolderKanban,
Shield,
Lock,
HardDrive,
Search,
Share2,
Palette,
Bell,
Activity,
Database,
AlertTriangle,
ArrowLeft,
Sun,
Moon,CheckCircle2,
XCircle,
Menu,
X
} from "lucide-react";

import type { SystemConfigSection,ToastMessage } from "./system/types";
import { UsersSection } from "./system/UsersSection";
import { OrganizationSection } from "./system/OrganizationSection";
import { TeamsHierarchySection } from "./system/TeamsHierarchySection";
import { RolesPermissionsSection } from "./system/RolesPermissionsSection";
import { SecuritySection } from "./system/SecuritySection";
import { StorageSection } from "./system/StorageSection";
import { SearchSection } from "./system/SearchSection";
import { IntegrationsSection } from "./system/IntegrationsSection";
import { NotificationsSection } from "./system/NotificationsSection";
import { AppearanceSection } from "./system/AppearanceSection";
import { HealthDiagnosticsSection } from "./system/HealthDiagnosticsSection";
import { DataBackupSection } from "./system/DataBackupSection";
import { DangerZoneSection } from "./system/DangerZoneSection";
export { UserRoleBadges } from "./system/UserRoleBadges";
export type { SystemConfigSection } from "./system/types";

export function SystemConfigView({
  initialSection = "users",
}: {
  initialSection?: string;
}) {
  const [activeSection, setActiveSection] = useState<SystemConfigSection>(
    (initialSection as SystemConfigSection) || "users"
  );
  const [darkMode, setDarkMode] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [csrfToken, setCsrfToken] = useState("");
  const [activeOrgId, setActiveOrgId] = useState("");
  const [loading, setLoading] = useState(true);

  const showToast = useCallback(
    (message: string, type: "success" | "error" | "info" = "success") => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, type, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  useEffect(() => {
    // Theme sync with localStorage + system preference
    const storedTheme = localStorage.getItem("patchwork_theme");
    const isDark =
      storedTheme === "dark" ||
      (storedTheme !== "light" &&
        (document.documentElement.classList.contains("dark") ||
          window.matchMedia("(prefers-color-scheme: dark)").matches));
    document.documentElement.classList.toggle("dark", isDark);
    setDarkMode(isDark);

    // Initial auth & csrf token fetch
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.csrfToken) setCsrfToken(d.csrfToken);
      })
      .catch(() => undefined);

    fetch("/api/workspace")
      .then((r) => r.json())
      .then((d) => {
        if (d.orgs && d.orgs.length > 0) {
          const adminOrg = d.orgs.find(
            (o: { orgRole: string }) => o.orgRole === "admin"
          );
          if (adminOrg) setActiveOrgId(adminOrg.id);
          else setActiveOrgId(d.orgs[0].id);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await origFetch(input, init);
      if (res.status === 401) {
        const clone = res.clone();
        clone
          .json()
          .then((d) => {
            if (d && typeof d === "object" && d.code === "SESSION_IDLE_EXPIRED") {
              const returnTo = window.location.pathname + window.location.search;
              window.location.assign(
                `/?reason=idle_expired&returnTo=${encodeURIComponent(returnTo)}`
              );
            }
          })
          .catch(() => undefined);
      }
      return res;
    };
    return () => {
      window.fetch = origFetch;
    };
  }, []);

  const toggleTheme = () => {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("patchwork_theme", next ? "dark" : "light");
      return next;
    });
  };

  const navItems: Array<{
    id: SystemConfigSection;
    label: string;
    icon: React.ReactNode;
    danger?: boolean;
  }> = [
    { id: "users", label: "Users & Access", icon: <Users className="h-4 w-4" /> },
    { id: "organization", label: "Organization", icon: <Building2 className="h-4 w-4" /> },
    {
      id: "teams-projects-boards",
      label: "Teams & Projects",
      icon: <FolderKanban className="h-4 w-4" />,
    },
    {
      id: "roles-permissions",
      label: "Roles & Permissions",
      icon: <Shield className="h-4 w-4" />,
    },
    { id: "security", label: "Security & Sessions", icon: <Lock className="h-4 w-4" /> },
    { id: "storage", label: "Storage & Files", icon: <HardDrive className="h-4 w-4" /> },
    { id: "search", label: "Search Index", icon: <Search className="h-4 w-4" /> },
    { id: "integrations", label: "Integrations", icon: <Share2 className="h-4 w-4" /> },
    { id: "notifications", label: "Notifications", icon: <Bell className="h-4 w-4" /> },
    { id: "appearance", label: "Appearance & Defaults", icon: <Palette className="h-4 w-4" /> },
    { id: "health", label: "Health & Diagnostics", icon: <Activity className="h-4 w-4" /> },
    { id: "data-backup", label: "Data & Backup", icon: <Database className="h-4 w-4" /> },
    {
      id: "danger-zone",
      label: "Danger Zone",
      icon: <AlertTriangle className="h-4 w-4" />,
      danger: true,
    },
  ];

  const handleNavClick = (id: SystemConfigSection) => {
    setActiveSection(id);
    setMobileNavOpen(false);
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", `/dashboard/system/${id}`);
    }
  };

  if (loading) {
    return <SystemConfigSkeleton />;
  }

  return (
    <div
      data-testid="system-config-page"
      className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--pw-bg)] text-[var(--pw-ink)]"
    >
      {/* Toast Notification Container */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid="system-toast"
            className={`flex items-center gap-2 rounded px-3 py-2 text-xs font-medium shadow-md transition ${
              t.type === "error"
                ? "bg-red-600 text-white"
                : t.type === "info"
                ? "bg-blue-600 text-white"
                : "bg-emerald-600 text-white"
            }`}
          >
            {t.type === "error" ? (
              <XCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>

      {/* Top Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--pw-border)] bg-[var(--pw-surface)] px-3 sm:px-4">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            aria-label="Toggle administration navigation"
            onClick={() => setMobileNavOpen((p) => !p)}
            className="md:hidden flex h-11 w-11 items-center justify-center rounded text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)] shrink-0"
          >
            {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <Link
            href="/"
            data-testid="back-to-workspace"
            className="flex items-center gap-1.5 rounded px-2 py-1 min-h-[44px] sm:min-h-0 text-xs font-medium text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)] transition shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Workspace</span>
          </Link>
          <span className="hidden sm:inline text-[var(--pw-border)]">/</span>
          <div className="flex items-center gap-2 min-w-0 truncate">
            <span className="hidden sm:inline text-xs font-semibold uppercase tracking-wider text-[var(--pw-ink-secondary)]">
              System Configuration
            </span>
            <span className="hidden sm:inline text-[var(--pw-border)]">/</span>
            <span className="text-xs font-medium text-[var(--pw-ink)] capitalize truncate">
              {activeSection.replace(/-/g, " ")}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={toggleTheme}
            className="rounded p-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)] transition"
            title="Toggle theme"
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Main Container with Sidebar + Content */}
      <div className="relative flex flex-1 overflow-hidden">
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        {/* Sub-nav sidebar */}
        <aside
          data-testid="system-subnav"
          className={`${
            mobileNavOpen ? "fixed inset-y-12 left-0 z-40 flex" : "hidden"
          } md:static md:flex w-60 md:w-56 shrink-0 border-r border-[var(--pw-border)] bg-[var(--pw-surface)] flex-col justify-between p-2 overflow-y-auto`}
        >
          <div className="space-y-0.5">
            <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pw-ink-tertiary)]">
              Administration
            </div>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`subnav-${item.id}`}
                onClick={() => handleNavClick(item.id)}
                className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-xs font-medium transition text-left ${
                  activeSection === item.id
                    ? item.danger
                      ? "bg-red-500/15 text-red-600 dark:text-red-400 font-semibold"
                      : "bg-[var(--pw-accent)] text-white font-semibold"
                    : item.danger
                    ? "text-red-600/80 dark:text-red-400/80 hover:bg-red-500/10"
                    : "text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)]"
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>

          <div className="p-2 border-t border-[var(--pw-border)] text-[11px] text-[var(--pw-ink-tertiary)] flex items-center justify-between">
            <span data-testid="system-config-version">Patchwork {displayVersion}</span>
            <span className="font-mono">Jira-Dense</span>
          </div>
        </aside>

        {/* Section View */}
        <main className="flex-1 overflow-y-auto bg-[var(--pw-bg)] p-6">
          <RegionErrorBoundary regionName="system configuration">
            <Fade key={activeSection} duration="fast">
              <div className="max-w-5xl mx-auto space-y-6">
            {activeSection === "users" && (
              <UsersSection
                orgId={activeOrgId}
                csrfToken={csrfToken}
                showToast={showToast}
              />
            )}
            {activeSection === "organization" && (
              <OrganizationSection
                orgId={activeOrgId}
                csrfToken={csrfToken}
                showToast={showToast}
              />
            )}
            {activeSection === "teams-projects-boards" && (
              <TeamsHierarchySection
                orgId={activeOrgId}
                csrfToken={csrfToken}
                showToast={showToast}
              />
            )}
            {activeSection === "roles-permissions" && (
              <RolesPermissionsSection />
            )}
            {activeSection === "security" && (
              <SecuritySection csrfToken={csrfToken} showToast={showToast} />
            )}
            {activeSection === "storage" && (
              <StorageSection csrfToken={csrfToken} showToast={showToast} />
            )}
            {activeSection === "search" && (
              <SearchSection csrfToken={csrfToken} showToast={showToast} />
            )}
            {activeSection === "integrations" && (
              <IntegrationsSection csrfToken={csrfToken} showToast={showToast} />
            )}
            {activeSection === "notifications" && (
              <NotificationsSection csrfToken={csrfToken} showToast={showToast} />
            )}
            {activeSection === "appearance" && (
              <AppearanceSection csrfToken={csrfToken} showToast={showToast} />
            )}
            {activeSection === "health" && (
              <HealthDiagnosticsSection />
            )}
            {activeSection === "data-backup" && (
              <DataBackupSection showToast={showToast} />
            )}
            {activeSection === "danger-zone" && (
              <DangerZoneSection
                orgId={activeOrgId}
                csrfToken={csrfToken}
                showToast={showToast}
              />
            )}
              </div>
            </Fade>
          </RegionErrorBoundary>
        </main>
      </div>
    </div>
  );
}
