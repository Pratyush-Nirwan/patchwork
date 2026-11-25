"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WorkspaceSkeleton } from "@/components/skeletons/WorkspaceSkeleton";
import { BoardSkeleton } from "@/components/skeletons/BoardSkeleton";
import { TicketPanelSkeleton } from "@/components/skeletons/TicketPanelSkeleton";
import {
  Presence,
  RegionErrorBoundary,
  Slide,
} from "@/components/ui/motion";
import { RevalidateBar } from "@/components/ui/skeleton";
import { useDocumentHidden } from "@/lib/motion";
import { PRIORITY_STYLES } from "@/lib/priority";
import { checkSubRoleTransition, getColumnStage } from "@/lib/workflow-stages";
import { apiFetchJson } from "@/lib/api-client";
import { displayVersion } from "@/lib/version";
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
  horizontalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Search,
  Plus,
  Columns3,
  Paperclip,
  GitPullRequest,
  MessageSquare,
  Activity,
  LogOut,
  Sun,
  Moon,
  Trash2,
  Users,
  Shield,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  X,
  AlertTriangle,
  Keyboard,
  FolderKanban,
  Layers,
  Building2,
  PanelLeft,
  GripVertical,
  Settings,
  Calendar as CalendarIcon,
  BookOpen,
} from "lucide-react";
import { MarkdownView } from "./MarkdownView";
import { TicketWatcherControls } from "./TicketWatcherControls";
import { NotificationBell } from "./NotificationBell";
import { MentionTextarea } from "./MentionTextarea";
import {
  TicketTypingIndicator,
  TicketViewerAvatars,
  useTicketPresence,
} from "./TicketPresenceBar";
import {
  CommandPalette,
  clearRecentPaletteItems,
  type BoardFilterState,
} from "./CommandPalette";
import { AppSnackbar, type SnackbarState } from "./AppSnackbar";
import { clearCommandHistory } from "@/lib/commands/history";
import { UserSettingsModal } from "./UserSettingsModal";
import {
  formatShortcut,
  getDefaultShortcutMap,
  loadUserShortcuts,
  matchesShortcut,
  resetUserShortcuts,
  saveUserShortcuts,
  type ShortcutActionId,
  type ShortcutMap,
} from "@/lib/shortcuts";
import { BoardCalendarView } from "./BoardCalendarView";

import {
  getDefaultNewTicketColumnId,
  type BoardData,
  type ColumnItem,
  type OrgSummary,
  type TicketDetailsData,
  type TicketItem,
  type UserInfo,
} from "./workspace/types";
import { WorkspaceSortableColumnItem } from "./workspace/WorkspaceSortableColumnItem";

export function PatchworkApp() {
  useDocumentHidden();
  const [loading, setLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [rollbackTicketId, setRollbackTicketId] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>("");
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [boardData, setBoardData] = useState<BoardData | null>(null);
  const [boardViewMode, setBoardViewMode] = useState<"kanban" | "calendar">("kanban");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetails, setTicketDetails] = useState<TicketDetailsData | null>(null);

  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, []);
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const showSnackbar = useCallback(
    (opts: Omit<SnackbarState, "id">) => {
      setSnackbar({ id: Date.now() + Math.random(), ...opts });
    },
    []
  );
  const [ssePaused, setSsePaused] = useState(false);
  const ssePausedRef = useRef(false);
  const sseFailureCountRef = useRef(0);
  const reconnectSseRef = useRef<(() => void) | null>(null);
  const idleNoticeShownRef = useRef(false);
  const returnToRef = useRef<string | null>(null);
  const selectedTicketIdRef = useRef<string | null>(null);
  const formDraftRef = useRef<{
    showNewTicket: boolean;
    newTicketTitle: string;
    newTicketDesc: string;
    newTicketPriority: TicketItem["priority"];
    newTicketLabels: string;
    newTicketColumnId: string;
    newTicketAssigneeId: string;
    newTicketDueDate: string;
    editingTicketFields: boolean;
    selectedTicketId: string | null;
    editTitle: string;
    editDesc: string;
    editLabels: string;
    commentBody: string;
  }>({
    showNewTicket: false,
    newTicketTitle: "",
    newTicketDesc: "",
    newTicketPriority: "medium",
    newTicketLabels: "",
    newTicketColumnId: "",
    newTicketAssigneeId: "",
    newTicketDueDate: "",
    editingTicketFields: false,
    selectedTicketId: null,
    editTitle: "",
    editDesc: "",
    editLabels: "",
    commentBody: "",
  });
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Auth form state
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [newPasswordInput, setNewPasswordInput] = useState("");

  // Modals / Inline forms
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");

  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectKey, setNewProjectKey] = useState("");

  const [showNewBoard, setShowNewBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");

  const [showNewColumn, setShowNewColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnWip, setNewColumnWip] = useState("");

  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [newTicketDesc, setNewTicketDesc] = useState("");
  const [newTicketPriority, setNewTicketPriority] =
    useState<TicketItem["priority"]>("medium");
  const [newTicketLabels, setNewTicketLabels] = useState("");
  const [newTicketColumnId, setNewTicketColumnId] = useState("");
  const [newTicketAssigneeId, setNewTicketAssigneeId] = useState("");
  const [newTicketDueDate, setNewTicketDueDate] = useState("");

  const [showTeamMembersModal, setShowTeamMembersModal] = useState(false);
  const [teamMembersList, setTeamMembersList] = useState<
    Array<{ id: string; name: string; email: string; role: string }>
  >([]);
  const [provisionMode, setProvisionMode] = useState<"create" | "assign">("create");
  const [provisionName, setProvisionName] = useState("");
  const [provisionEmail, setProvisionEmail] = useState("");
  const [provisionEmailError, setProvisionEmailError] = useState<string | null>(null);
  const [provisionPassword, setProvisionPassword] = useState("");
  const [provisionRole, setProvisionRole] = useState<
    "admin" | "lead" | "member" | "viewer"
  >("member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<
    "admin" | "lead" | "member" | "viewer"
  >("member");

  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => getDefaultShortcutMap());
  const router = useRouter();

  // Ticket detail sub-forms
  const [editingTicketFields, setEditingTicketFields] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLabels, setEditLabels] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);
  const { presence: ticketPresence, notifyTyping } = useTicketPresence(
    user ? selectedTicketId : null
  );
  const [linkUrl, setLinkUrl] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  // Command palette & board filter state
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteInitialQuery, setPaletteInitialQuery] = useState("");
  const [paletteHelpMode, setPaletteHelpMode] = useState(false);
  const [boardFilters, setBoardFilters] = useState<BoardFilterState | null>(null);

  // Drag state
  const [draggedTicketId, setDraggedTicketId] = useState<string | null>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem("patchwork_theme");
    if (savedTheme === "dark") {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    }
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("reason") === "idle_expired") {
        const ret = params.get("returnTo");
        if (ret && ret.startsWith("/") && !ret.startsWith("//")) {
          returnToRef.current = ret;
        }
        if (!idleNoticeShownRef.current) {
          idleNoticeShownRef.current = true;
          setErrorBanner("Your session expired due to inactivity");
        }
        params.delete("reason");
        params.delete("returnTo");
        const nextQs = params.toString();
        const cleanUrl = `${window.location.pathname}${nextQs ? `?${nextQs}` : ""}`;
        window.history.replaceState(null, "", cleanUrl);
      }
    }
  }, []);

  useEffect(() => {
    selectedTicketIdRef.current = selectedTicketId;
    formDraftRef.current = {
      showNewTicket,
      newTicketTitle,
      newTicketDesc,
      newTicketPriority,
      newTicketLabels,
      newTicketColumnId,
      newTicketAssigneeId,
      newTicketDueDate,
      editingTicketFields,
      selectedTicketId,
      editTitle,
      editDesc,
      editLabels,
      commentBody,
    };
  }, [
    showNewTicket,
    newTicketTitle,
    newTicketDesc,
    newTicketPriority,
    newTicketLabels,
    newTicketColumnId,
    newTicketAssigneeId,
    newTicketDueDate,
    editingTicketFields,
    selectedTicketId,
    editTitle,
    editDesc,
    editLabels,
    commentBody,
  ]);

  const handleIdleExpired = useCallback(() => {
    if (typeof window !== "undefined") {
      const draft = formDraftRef.current;
      const hasDraft =
        Boolean(draft.newTicketTitle.trim()) ||
        Boolean(draft.newTicketDesc.trim()) ||
        Boolean(draft.commentBody.trim()) ||
        (draft.editingTicketFields &&
          (Boolean(draft.editTitle.trim()) || Boolean(draft.editDesc.trim())));
      if (hasDraft) {
        try {
          sessionStorage.setItem("patchwork_idle_draft", JSON.stringify(draft));
        } catch {
          // ignore storage quota errors
        }
      }
      const currentUrl = window.location.pathname + window.location.search;
      if (!returnToRef.current && currentUrl && currentUrl !== "/") {
        returnToRef.current = currentUrl;
      }
      const returnParam = returnToRef.current
        ? `&returnTo=${encodeURIComponent(returnToRef.current)}`
        : "";
      if (window.location.pathname !== "/") {
        window.location.assign(`/?reason=idle_expired${returnParam}`);
        return;
      }
      window.history.replaceState(
        null,
        "",
        `/?reason=idle_expired${returnParam}`
      );
    }
    setUser(null);
    setCsrfToken("");
    setBoardData(null);
    if (!idleNoticeShownRef.current) {
      idleNoticeShownRef.current = true;
      setErrorBanner("Your session expired due to inactivity");
    }
  }, []);

  const restoreIdleDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem("patchwork_idle_draft");
      if (!raw) return;
      sessionStorage.removeItem("patchwork_idle_draft");
      const draft = JSON.parse(raw);
      if (draft && typeof draft === "object") {
        if (draft.showNewTicket && (draft.newTicketTitle || draft.newTicketDesc)) {
          setShowNewTicket(true);
          if (typeof draft.newTicketTitle === "string") setNewTicketTitle(draft.newTicketTitle);
          if (typeof draft.newTicketDesc === "string") setNewTicketDesc(draft.newTicketDesc);
          if (typeof draft.newTicketPriority === "string") {
            setNewTicketPriority(draft.newTicketPriority as TicketItem["priority"]);
          }
          if (typeof draft.newTicketLabels === "string") setNewTicketLabels(draft.newTicketLabels);
          if (typeof draft.newTicketColumnId === "string") setNewTicketColumnId(draft.newTicketColumnId);
          if (typeof draft.newTicketAssigneeId === "string") setNewTicketAssigneeId(draft.newTicketAssigneeId);
          if (typeof draft.newTicketDueDate === "string") setNewTicketDueDate(draft.newTicketDueDate);
        }
        if (typeof draft.selectedTicketId === "string" && draft.selectedTicketId) {
          setSelectedTicketId(draft.selectedTicketId);
          if (typeof draft.commentBody === "string" && draft.commentBody) {
            setCommentBody(draft.commentBody);
          }
          if (draft.editingTicketFields) {
            setEditingTicketFields(true);
            if (typeof draft.editTitle === "string") setEditTitle(draft.editTitle);
            if (typeof draft.editDesc === "string") setEditDesc(draft.editDesc);
            if (typeof draft.editLabels === "string") setEditLabels(draft.editLabels);
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const toggleTheme = () => {
    setDarkMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("patchwork_theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("patchwork_theme", "light");
      }
      return next;
    });
  };

  const apiFetch = useCallback(
    (url: string, init?: RequestInit) =>
      apiFetchJson(url, init, { csrfToken, onIdleExpired: handleIdleExpired }),
    [csrfToken, handleIdleExpired]
  );

  const loadWorkspace = useCallback(async (preferredBoardId?: string | null) => {
    try {
      const res = await fetch("/api/workspace");
      if (!res.ok) {
        if (res.status === 401) {
          const errData = await res.json().catch(() => ({}));
          if (errData && typeof errData === "object" && errData.code === "SESSION_IDLE_EXPIRED") {
            handleIdleExpired();
          }
        }
        setUser(null);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setUser(data.user);
      setCsrfToken(data.csrfToken);
      idleNoticeShownRef.current = false;
      restoreIdleDraft();
      const tree: OrgSummary[] = data.orgs || [];
      setOrgs(tree);

      if (tree.length > 0) {
        const firstOrg = tree[0];
        setActiveOrgId((prev) => prev || firstOrg.id);
        const firstTeam = firstOrg.teams[0];
        if (firstTeam) {
          setActiveTeamId((prev) => prev || firstTeam.id);
          const firstProj = firstTeam.projects[0];
          if (firstProj) {
            setActiveProjectId((prev) => prev || firstProj.id);
            const firstBoard = firstProj.boards[0];
            if (firstBoard) {
              setActiveBoardId((prev) => preferredBoardId || prev || firstBoard.id);
            }
          }
        }
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [handleIdleExpired, restoreIdleDraft]);

  const loadBoard = useCallback(async (boardId: string) => {
    setBoardLoading(true);
    try {
      const res = await fetch(`/api/boards/${boardId}`);
      if (!res.ok) return;
      const data: BoardData = await res.json();
      setBoardData(data);
      setActiveOrgId(data.org.id);
      setActiveTeamId(data.team.id);
      setActiveProjectId(data.project.id);
    } catch (err) {
      console.error("Failed to load board:", err);
    } finally {
      setBoardLoading(false);
    }
  }, []);

  const loadTicketDetails = useCallback(async (ticketId: string) => {
    setTicketLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      if (!res.ok) return;
      const data: TicketDetailsData = await res.json();
      setTicketDetails(data);
      setEditTitle(data.ticket.title);
      setEditDesc(data.ticket.description);
      setEditLabels(data.ticket.labels.join(", "));
    } catch (err) {
      console.error("Failed to load ticket details:", err);
    } finally {
      setTicketLoading(false);
    }
  }, []);

  const loadTeamMembers = useCallback(async (teamId: string) => {
    try {
      const res = await fetch(`/api/teams/${teamId}/members`);
      if (!res.ok) return;
      const data = await res.json();
      setTeamMembersList(data.members || []);
    } catch (err) {
      console.error("Failed to load team members:", err);
    }
  }, []);

  useEffect(() => {
    if (showTeamMembersModal && activeTeamId && user) {
      loadTeamMembers(activeTeamId);
    }
  }, [showTeamMembersModal, activeTeamId, user, loadTeamMembers]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (activeBoardId && user) {
      loadBoard(activeBoardId);
    } else {
      setBoardData(null);
    }
  }, [activeBoardId, user, loadBoard]);

  useEffect(() => {
    if (selectedTicketId && user) {
      loadTicketDetails(selectedTicketId);
    } else {
      setTicketDetails(null);
    }
  }, [selectedTicketId, user, loadTicketDetails]);

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    const params = new URLSearchParams(window.location.search);
    const tId = params.get("ticket");
    const cId = params.get("comment");
    if (tId) setSelectedTicketId(tId);
    if (cId) setHighlightedCommentId(cId);
  }, [user]);

  useEffect(() => {
    if (!highlightedCommentId || !ticketDetails) return;
    const el = document.getElementById(`comment-${highlightedCommentId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const timer = setTimeout(() => setHighlightedCommentId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedCommentId, ticketDetails]);

  // Realtime SSE subscription
  useEffect(() => {
    if (!user || !activeBoardId) {
      ssePausedRef.current = false;
      setSsePaused(false);
      sseFailureCountRef.current = 0;
      reconnectSseRef.current = null;
      return;
    }

    let cancelled = false;
    let currentEs: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const handleConnected = () => {
      const wasPaused = ssePausedRef.current;
      sseFailureCountRef.current = 0;
      ssePausedRef.current = false;
      setSsePaused(false);
      if (wasPaused) {
        loadBoard(activeBoardId);
        const currentTicketId = selectedTicketIdRef.current;
        if (currentTicketId) {
          loadTicketDetails(currentTicketId);
        }
      }
    };

    const connect = () => {
      if (cancelled) return;
      clearRetryTimer();
      if (currentEs) {
        currentEs.close();
        currentEs = null;
      }
      const es = new EventSource(`/api/events?boardId=${activeBoardId}`);
      currentEs = es;

      es.addEventListener("connected", handleConnected);
      es.onopen = handleConnected;
      es.addEventListener("session_expired", () => {
        es.close();
        clearRetryTimer();
        handleIdleExpired();
      });
      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.boardId === activeBoardId) {
            loadBoard(activeBoardId);
            const currentTicketId = selectedTicketIdRef.current;
            if (currentTicketId && parsed.ticketId === currentTicketId) {
              loadTicketDetails(currentTicketId);
            }
          }
        } catch {
          // ignore parse errors
        }
      };
      es.onerror = () => {
        es.close();
        if (cancelled) return;
        sseFailureCountRef.current += 1;
        if (sseFailureCountRef.current >= 5) {
          ssePausedRef.current = true;
          setSsePaused(true);
        }
        const delayMs = Math.min(
          1000 * 2 ** (sseFailureCountRef.current - 1),
          30_000
        );
        retryTimer = setTimeout(connect, delayMs);
      };
    };

    reconnectSseRef.current = () => {
      clearRetryTimer();
      connect();
    };

    connect();

    return () => {
      cancelled = true;
      clearRetryTimer();
      if (currentEs) {
        currentEs.close();
      }
      reconnectSseRef.current = null;
      sseFailureCountRef.current = 0;
    };
  }, [user, activeBoardId, loadBoard, loadTicketDetails, handleIdleExpired]);

  useEffect(() => {
    if (user?.id) {
      setShortcuts(loadUserShortcuts(user.id));
    } else {
      setShortcuts(getDefaultShortcutMap());
    }
  }, [user?.id]);

  const handleUpdateShortcut = useCallback(
    (actionId: ShortcutActionId, combo: string) => {
      setShortcuts((prev) => {
        const next = { ...prev, [actionId]: combo };
        if (user?.id) saveUserShortcuts(user.id, next);
        return next;
      });
    },
    [user?.id]
  );

  const handleResetShortcuts = useCallback(() => {
    const next = user?.id ? resetUserShortcuts(user.id) : getDefaultShortcutMap();
    setShortcuts(next);
  }, [user?.id]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (matchesShortcut(e, shortcuts.paletteHelp)) {
        e.preventDefault();
        setPaletteInitialQuery("");
        setPaletteHelpMode((prev) => (paletteOpen ? !prev : true));
        setPaletteOpen(true);
        return;
      }

      if (matchesShortcut(e, shortcuts.openPalette)) {
        e.preventDefault();
        setPaletteInitialQuery("");
        setPaletteHelpMode(false);
        setPaletteOpen((prev) => !prev);
        return;
      }

      if (e.key === "Escape") {
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (
          showNewTicket ||
          showNewColumn ||
          showShortcutsModal ||
          showUserSettings ||
          showTeamMembersModal
        ) {
          setShowNewTicket(false);
          setShowNewColumn(false);
          setShowShortcutsModal(false);
          setShowUserSettings(false);
          setShowTeamMembersModal(false);
          return;
        }
        if (selectedTicketId) setSelectedTicketId(null);
        return;
      }

      if (isInput) return;

      if (e.key === "/") {
        e.preventDefault();
        setPaletteInitialQuery("/");
        setPaletteHelpMode(false);
        setPaletteOpen(true);
      } else if (
        matchesShortcut(e, shortcuts.newTicket) &&
        boardData &&
        boardData.role !== "viewer"
      ) {
        e.preventDefault();
        setNewTicketColumnId(getDefaultNewTicketColumnId(boardData.columns));
        setShowNewTicket(true);
      } else if (matchesShortcut(e, shortcuts.toggleSidebar)) {
        e.preventDefault();
        setSidebarOpen((p) => !p);
      } else if (matchesShortcut(e, shortcuts.shortcutsModal)) {
        e.preventDefault();
        setShowShortcutsModal((p) => !p);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    boardData,
    selectedTicketId,
    paletteOpen,
    showNewTicket,
    showNewColumn,
    showShortcutsModal,
    showUserSettings,
    showTeamMembersModal,
    shortcuts,
  ]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    setAuthPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }
      setUser(data.user);
      setCsrfToken(data.csrfToken);
      idleNoticeShownRef.current = false;
      const returnTo = returnToRef.current;
      if (returnTo && returnTo !== "/") {
        returnToRef.current = null;
        window.location.assign(returnTo);
        return;
      }
      await loadWorkspace();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Authentication error");
    } finally {
      setAuthPending(false);
    }
  };

  const handleLogout = async () => {
    try {
      const currentUserId = user?.id;
      await apiFetch("/api/auth/logout", { method: "POST" });
      if (currentUserId) clearRecentPaletteItems(currentUserId);
      clearCommandHistory();
      setUser(null);
      setCsrfToken("");
      setOrgs([]);
      setBoardData(null);
      setSelectedTicketId(null);
      setBoardFilters(null);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Logout failed");
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    try {
      const data = await apiFetch("/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name: newOrgName }),
      });
      setNewOrgName("");
      setShowNewOrg(false);
      setActiveOrgId(data.org.id);
      await loadWorkspace();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to create org");
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !newTeamName.trim()) return;
    try {
      const data = await apiFetch(`/api/orgs/${activeOrgId}/teams`, {
        method: "POST",
        body: JSON.stringify({ name: newTeamName }),
      });
      setNewTeamName("");
      setShowNewTeam(false);
      setActiveTeamId(data.team.id);
      await loadWorkspace();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to create team");
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeamId || !newProjectName.trim()) return;
    try {
      const data = await apiFetch(`/api/teams/${activeTeamId}/projects`, {
        method: "POST",
        body: JSON.stringify({
          name: newProjectName,
          key: newProjectKey.trim() || undefined,
        }),
      });
      setNewProjectName("");
      setNewProjectKey("");
      setShowNewProject(false);
      setActiveProjectId(data.project.id);
      await loadWorkspace();
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to create project"
      );
    }
  };

  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProjectId || !newBoardName.trim()) return;
    try {
      const data = await apiFetch(`/api/projects/${activeProjectId}/boards`, {
        method: "POST",
        body: JSON.stringify({ name: newBoardName }),
      });
      setNewBoardName("");
      setShowNewBoard(false);
      setActiveBoardId(data.board.id);
      await loadWorkspace(data.board.id);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to create board");
    }
  };

  const handleCreateColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBoardId || !newColumnName.trim()) return;
    try {
      await apiFetch(`/api/boards/${activeBoardId}/columns`, {
        method: "POST",
        body: JSON.stringify({
          name: newColumnName,
          wipLimit: newColumnWip ? Number(newColumnWip) : null,
        }),
      });
      setNewColumnName("");
      setNewColumnWip("");
      setShowNewColumn(false);
      await loadBoard(activeBoardId);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to create column"
      );
    }
  };

  const handleRenameColumn = async (column: ColumnItem) => {
    const nextName = window.prompt("Rename column:", column.name);
    if (!nextName || nextName.trim() === column.name) return;
    try {
      await apiFetch(`/api/columns/${column.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: nextName.trim() }),
      });
      if (activeBoardId) await loadBoard(activeBoardId);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to rename column"
      );
    }
  };

  const columnSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleColumnDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !boardData) return;

    const oldIndex = boardData.columns.findIndex((c) => c.id === active.id);
    const newIndex = boardData.columns.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previousColumns = boardData.columns;
    const newColumns = arrayMove(previousColumns, oldIndex, newIndex);

    setBoardData({
      ...boardData,
      columns: newColumns,
    });

    const otherCols = previousColumns.filter((c) => c.id !== active.id);
    let newPosition: number;
    if (newIndex === 0) {
      newPosition = otherCols.length > 0 ? otherCols[0].position - 1000 : 0;
    } else if (newIndex >= otherCols.length) {
      newPosition = otherCols[otherCols.length - 1].position + 1000;
    } else {
      const prevPos = otherCols[newIndex - 1].position;
      const nextPos = otherCols[newIndex].position;
      newPosition = (prevPos + nextPos) / 2;
    }

    try {
      await apiFetch(`/api/boards/${boardData.board.id}/columns`, {
        method: "PUT",
        body: JSON.stringify({
          columnId: active.id,
          position: newPosition,
          columnIds: newColumns.map((c) => c.id),
        }),
      });
    } catch (err) {
      setBoardData((curr) => (curr ? { ...curr, columns: previousColumns } : null));
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to reorder columns"
      );
    }
  };

  const handleMoveColumnOrder = async (index: number, direction: -1 | 1) => {
    if (!boardData) return;
    const cols = [...boardData.columns];
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= cols.length) return;
    const moved = cols[index];
    const previousColumns = boardData.columns;
    const newColumns = arrayMove(previousColumns, index, targetIdx);

    setBoardData({ ...boardData, columns: newColumns });

    const otherCols = previousColumns.filter((c) => c.id !== moved.id);
    let newPosition: number;
    if (targetIdx === 0) {
      newPosition = otherCols.length > 0 ? otherCols[0].position - 1000 : 0;
    } else if (targetIdx >= otherCols.length) {
      newPosition = otherCols[otherCols.length - 1].position + 1000;
    } else {
      const prevPos = otherCols[targetIdx - 1].position;
      const nextPos = otherCols[targetIdx].position;
      newPosition = (prevPos + nextPos) / 2;
    }

    try {
      await apiFetch(`/api/boards/${boardData.board.id}/columns`, {
        method: "PUT",
        body: JSON.stringify({
          columnId: moved.id,
          position: newPosition,
          columnIds: newColumns.map((c) => c.id),
        }),
      });
    } catch (err) {
      setBoardData((curr) => (curr ? { ...curr, columns: previousColumns } : null));
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to reorder columns"
      );
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    if (!activeBoardId) return;
    try {
      await apiFetch(`/api/columns/${columnId}`, { method: "DELETE" });
      await loadBoard(activeBoardId);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to delete column"
      );
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBoardId || !newTicketTitle.trim()) return;
    try {
      const labels = newTicketLabels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const data = await apiFetch(`/api/boards/${activeBoardId}/tickets`, {
        method: "POST",
        body: JSON.stringify({
          title: newTicketTitle,
          description: newTicketDesc,
          priority: newTicketPriority,
          labels,
          columnId:
            newTicketColumnId ||
            (boardData ? getDefaultNewTicketColumnId(boardData.columns) : undefined),
          assigneeId: newTicketAssigneeId || null,
          dueDate: newTicketDueDate ? new Date(`${newTicketDueDate}T12:00:00Z`).toISOString() : null,
        }),
      });
      setNewTicketTitle("");
      setNewTicketDesc("");
      setNewTicketLabels("");
      setNewTicketPriority("medium");
      setNewTicketColumnId(boardData ? getDefaultNewTicketColumnId(boardData.columns) : "");
      setNewTicketDueDate("");
      setShowNewTicket(false);
      await loadBoard(activeBoardId);
      setSelectedTicketId(data.ticket.id);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to create ticket"
      );
    }
  };

  const handleMoveTicket = async (
    ticketId: string,
    targetColumnId: string,
    targetPosition?: number
  ) => {
    if (!activeBoardId) return;
    if (boardData && !canEditStructure) {
      const ticket = boardData.tickets.find((t) => t.id === ticketId);
      if (ticket && ticket.columnId !== targetColumnId) {
        const sourceCol = boardData.columns.find((c) => c.id === ticket.columnId);
        const targetCol = boardData.columns.find((c) => c.id === targetColumnId);
        if (sourceCol && targetCol) {
          const subRoleErr = checkSubRoleTransition(
            effectiveRole,
            effectiveSubRole,
            sourceCol.name,
            targetCol.name
          );
          if (subRoleErr) {
            setErrorBanner(subRoleErr);
            return;
          }
        }
        const sourceIdx = boardData.columns.findIndex((c) => c.id === ticket.columnId);
        const targetIdx = boardData.columns.findIndex((c) => c.id === targetColumnId);
        if (sourceIdx !== -1 && targetIdx !== -1 && targetIdx > sourceIdx + 1) {
          const sourceCol = boardData.columns[sourceIdx];
          const targetCol = boardData.columns[targetIdx];
          const nextCol = boardData.columns[sourceIdx + 1];
          setErrorBanner(
            `Cannot advance ticket directly from "${sourceCol?.name || "current column"}" to "${targetCol?.name || "target column"}". Tickets must advance sequentially (next step: "${nextCol?.name || "next column"}").`
          );
          return;
        }
      }
    }
    try {
      await apiFetch(`/api/tickets/${ticketId}/move`, {
        method: "POST",
        body: JSON.stringify({ targetColumnId, targetPosition }),
      });
      await loadBoard(activeBoardId);
      if (selectedTicketId === ticketId) {
        await loadTicketDetails(ticketId);
      }
    } catch (err) {
      setRollbackTicketId(ticketId);
      setTimeout(() => setRollbackTicketId((cur) => (cur === ticketId ? null : cur)), 320);
      setErrorBanner(err instanceof Error ? err.message : "Failed to move ticket");
    }
  };

  const handleUpdateTicketDueDate = async (ticketId: string, dueDate: string | null) => {
    if (!activeBoardId) return;
    try {
      await apiFetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        body: JSON.stringify({ dueDate }),
      });
      await loadBoard(activeBoardId);
      if (selectedTicketId === ticketId) {
        await loadTicketDetails(ticketId);
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to update ticket due date"
      );
    }
  };

  const handleSaveTicketEdits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId || !activeBoardId) return;
    try {
      await apiFetch(`/api/tickets/${selectedTicketId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editTitle,
          description: editDesc,
          labels: editLabels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setEditingTicketFields(false);
      await loadBoard(activeBoardId);
      await loadTicketDetails(selectedTicketId);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to update ticket"
      );
    }
  };

  const handleUpdateTicketField = async (
    patch: Partial<{
      priority: TicketItem["priority"];
      assigneeId: string | null;
      dueDate: string | null;
    }>
  ) => {
    if (!selectedTicketId || !activeBoardId) return;
    try {
      await apiFetch(`/api/tickets/${selectedTicketId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadBoard(activeBoardId);
      await loadTicketDetails(selectedTicketId);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to update ticket"
      );
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId || !commentBody.trim()) return;
    try {
      const res = await apiFetch(`/api/tickets/${selectedTicketId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: commentBody }),
      });
      if (res?.comment?.mentionWarning) {
        setErrorBanner(res.comment.mentionWarning);
      }
      setCommentBody("");
      await loadTicketDetails(selectedTicketId);
      if (activeBoardId) await loadBoard(activeBoardId);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to add comment");
    }
  };

  const handleSaveCommentEdit = async (e: React.FormEvent, commentId: string) => {
    e.preventDefault();
    if (!selectedTicketId || !editingCommentBody.trim()) return;
    try {
      const res = await apiFetch(
        `/api/tickets/${selectedTicketId}/comments/${commentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ body: editingCommentBody }),
        }
      );
      if (res?.comment?.mentionWarning) {
        setErrorBanner(res.comment.mentionWarning);
      }
      setEditingCommentId(null);
      setEditingCommentBody("");
      await loadTicketDetails(selectedTicketId);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to edit comment");
    }
  };

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId || !linkUrl.trim()) return;
    try {
      await apiFetch(`/api/tickets/${selectedTicketId}/links`, {
        method: "POST",
        body: JSON.stringify({ url: linkUrl.trim() }),
      });
      setLinkUrl("");
      await loadTicketDetails(selectedTicketId);
      if (activeBoardId) await loadBoard(activeBoardId);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to attach link");
    }
  };

  const handleRemoveLink = async (linkId: string) => {
    if (!selectedTicketId) return;
    try {
      await apiFetch(`/api/links/${linkId}`, { method: "DELETE" });
      await loadTicketDetails(selectedTicketId);
      if (activeBoardId) await loadBoard(activeBoardId);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to remove link");
    }
  };

  const handleUploadAttachment = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTicketId) return;
    setUploadingAttachment(true);
    setErrorBanner(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/tickets/${selectedTicketId}/attachments`, {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
        },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Attachment upload failed");
      }
      await loadTicketDetails(selectedTicketId);
      if (activeBoardId) await loadBoard(activeBoardId);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to upload attachment"
      );
    } finally {
      setUploadingAttachment(false);
      e.target.value = "";
    }
  };

  const handleProvisionTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !activeTeamId ||
      !provisionName.trim() ||
      !provisionEmail.trim() ||
      !provisionPassword
    ) {
      return;
    }
    setErrorBanner(null);
    setProvisionEmailError(null);
    try {
      await apiFetch(`/api/teams/${activeTeamId}/members`, {
        method: "POST",
        body: JSON.stringify({
          name: provisionName.trim(),
          email: provisionEmail.trim(),
          password: provisionPassword,
          role: provisionRole,
        }),
      });
      setProvisionName("");
      setProvisionEmail("");
      setProvisionPassword("");
      await loadTeamMembers(activeTeamId);
      if (activeBoardId) await loadBoard(activeBoardId);
      await loadWorkspace();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create and assign account";
      setProvisionEmailError(msg);
      setErrorBanner(msg);
    }
  };

  const handleInviteTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeamId || !inviteEmail.trim()) return;
    setErrorBanner(null);
    setInviteEmailError(null);
    try {
      await apiFetch(`/api/teams/${activeTeamId}/members`, {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      setInviteEmail("");
      await loadTeamMembers(activeTeamId);
      if (activeBoardId) await loadBoard(activeBoardId);
      await loadWorkspace();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add team member";
      setInviteEmailError(msg);
      setErrorBanner(msg);
    }
  };

  const handleChangeTemporaryPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    setAuthPending(true);
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: currentPasswordInput,
          newPassword: newPasswordInput,
        }),
      });
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      await loadWorkspace();
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to change password"
      );
    } finally {
      setAuthPending(false);
    }
  };

  if (loading) {
    return <WorkspaceSkeleton />;
  }

  if (!user) {
    return (
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-12 bg-[var(--pw-bg)] text-[var(--pw-ink)]">
        <div className="order-2 lg:order-1 lg:col-span-7 flex flex-col justify-between bg-[var(--pw-rail-bg)] p-8 lg:p-14 text-[var(--pw-rail-ink)] border-t lg:border-t-0 lg:border-r border-[var(--pw-rail-border)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-[var(--pw-accent)] font-mono text-sm font-bold text-white">
                PW
              </div>
              <span className="font-mono text-sm font-semibold tracking-tight">
                PATCHWORK // SELF-HOSTED DISPATCH
              </span>
            </div>
            <span className="rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--pw-rail-muted)]">
              AGPL-3.0 · NATIVE STACK
            </span>
          </div>

          <div className="my-12 max-w-xl space-y-5">
            <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight text-white">
              Multi-team engineering issue tracking with live PostgreSQL dispatch.
            </h1>
            <p className="text-sm leading-relaxed text-[var(--pw-rail-muted)] max-w-[65ch]">
              Built for engineering organizations running native PostgreSQL 16+ and
              MinIO object storage. Structured across Organizations, Teams,
              Projects, Boards, and Tickets with server-enforced RBAC, full-text
              attachment indexing, and zero-latency LISTEN/NOTIFY board synchronization.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4">
              <div className="rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] p-3.5">
                <div className="font-mono text-xs font-semibold text-white">
                  ORG / TEAM RBAC
                </div>
                <p className="mt-1 text-xs text-[var(--pw-rail-muted)]">
                  Granular Admin, Team Lead, Member, and Viewer enforcement on every route.
                </p>
              </div>
              <div className="rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] p-3.5">
                <div className="font-mono text-xs font-semibold text-white">
                  LISTEN / NOTIFY SSE
                </div>
                <p className="mt-1 text-xs text-[var(--pw-rail-muted)]">
                  Ticket moves, WIP meters, and comments broadcast across connected browsers.
                </p>
              </div>
              <div className="rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] p-3.5">
                <div className="font-mono text-xs font-semibold text-white">
                  GIN FTS + MINIO
                </div>
                <p className="mt-1 text-xs text-[var(--pw-rail-muted)]">
                  Ranked full-text search across tickets, comments, and PDF/MD/TXT attachments.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-[var(--pw-rail-muted)] font-mono">
            <span>POSTGRESQL 16+ · DRIZZLE · MINIO S3</span>
            <span>NO CONTAINERS REQUIRED</span>
          </div>
        </div>

        <div className="order-1 lg:order-2 lg:col-span-5 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 lg:p-8 shadow-[var(--pw-shadow)]">
            <div className="border-b border-[var(--pw-border)] pb-4 mb-6">
              <h2 className="text-lg font-semibold tracking-tight">
                Sign in to Patchwork
              </h2>
            </div>

            {errorBanner && (
              <div
                data-testid="auth-error"
                className="mb-4 flex items-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-[var(--pw-urgent)]"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{errorBanner}</span>
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1"
                >
                  Work Email
                </label>
                <input
                  id="auth-email"
                  data-testid="auth-email-input"
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="ada@acme.dev"
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-sm text-[var(--pw-ink)]"
                />
              </div>

              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1"
                >
                  Password
                </label>
                <input
                  id="auth-password"
                  data-testid="auth-password-input"
                  type="password"
                  required
                  minLength={8}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-sm text-[var(--pw-ink)]"
                />
              </div>

              <button
                type="submit"
                data-testid="auth-submit-btn"
                disabled={authPending}
                className="w-full rounded bg-[var(--pw-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50 transition"
              >
                {authPending ? "Authenticating..." : "Sign In to Workspace"}
              </button>

              <p className="text-center text-xs text-[var(--pw-ink-tertiary)] mt-4">
                Contact your administrator for an account.{" "}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/documentation"
                  data-testid="login-docs-link"
                  className="text-[var(--pw-accent)] hover:underline font-medium"
                >
                  Documentation
                </a>
              </p>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (user.mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--pw-bg)] p-6 text-[var(--pw-ink)]">
        <div
          data-testid="force-password-change-form"
          className="w-full max-w-md rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 shadow-[var(--pw-shadow)]"
        >
          <h2 className="text-lg font-semibold">
            Change Temporary Password
          </h2>
          <p className="mt-1 text-xs text-[var(--pw-ink-secondary)]">
            Your account ({user.email}) was provisioned with a temporary password. Set a new password before accessing the workspace.
          </p>

          {errorBanner && (
            <div
              data-testid="password-change-error"
              className="mt-4 flex items-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-[var(--pw-urgent)]"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
          )}

          <form
            onSubmit={handleChangeTemporaryPassword}
            className="mt-4 space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                Temporary Password
              </label>
              <input
                data-testid="current-password-input"
                type="password"
                required
                value={currentPasswordInput}
                onChange={(e) => setCurrentPasswordInput(e.target.value)}
                placeholder="Enter current temporary password"
                className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                New Password (8+ characters)
              </label>
              <input
                data-testid="new-password-input"
                type="password"
                required
                minLength={8}
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                placeholder="Choose a new password"
                className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handleLogout}
                className="rounded border border-[var(--pw-border)] px-3 py-2 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
              >
                Sign Out
              </button>
              <button
                type="submit"
                disabled={authPending}
                data-testid="change-password-submit-btn"
                className="rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
              >
                {authPending ? "Updating..." : "Update Password & Continue"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const activeOrg = orgs.find((o) => o.id === activeOrgId) || orgs[0] || null;
  const activeTeam =
    activeOrg?.teams.find((t) => t.id === activeTeamId) ||
    activeOrg?.teams[0] ||
    null;
  const effectiveRole = boardData?.role || activeTeam?.effectiveRole || "viewer";
  const effectiveSubRole =
    boardData?.subRole || activeTeam?.effectiveSubRole || "developer";
  const canEditStructure =
    effectiveRole === "admin" || effectiveRole === "lead";
  const canMutateTickets =
    effectiveRole === "admin" ||
    effectiveRole === "lead" ||
    effectiveRole === "member";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--pw-bg)] text-[var(--pw-ink)]">
      {/* Left Navigation Rail */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            aria-hidden="true"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            data-testid="left-sidebar"
            className="fixed inset-y-0 left-0 z-40 md:static flex w-60 shrink-0 flex-col border-r border-[var(--pw-rail-border)] bg-[var(--pw-rail-bg)] text-[var(--pw-rail-ink)] shadow-xl md:shadow-none"
          >
            <div className="flex h-12 items-center justify-between border-b border-[var(--pw-rail-border)] px-3.5">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-[var(--pw-accent)] font-mono text-xs font-bold text-white">
                  PW
                </div>
                <span className="font-mono text-xs font-semibold tracking-tight text-white">
                  PATCHWORK
                </span>
              </div>
              <span
                data-testid="user-role-badge"
                className="rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--pw-rail-muted)]"
              >
                {effectiveRole}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-5">
              {/* Organizations */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--pw-rail-muted)]">
                    <Building2 className="h-3.5 w-3.5" />
                    Organization
                  </span>
                  <button
                    type="button"
                    data-testid="new-org-btn"
                    onClick={() => setShowNewOrg((p) => !p)}
                    className="rounded p-0.5 text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)] hover:text-white"
                    title="New Organization"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                {showNewOrg && (
                  <form onSubmit={handleCreateOrg} className="mb-2 flex gap-1">
                    <input
                      data-testid="new-org-input"
                      type="text"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      placeholder="Org name..."
                      className="w-full rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] px-2 py-1 text-xs text-white"
                    />
                    <button
                      type="submit"
                      data-testid="create-org-submit"
                      className="rounded bg-[var(--pw-accent)] px-2 py-1 text-xs font-medium text-white"
                    >
                      Add
                    </button>
                  </form>
                )}

                <div className="space-y-0.5">
                  {orgs.map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      data-testid={`org-item-${org.slug}`}
                      onClick={() => {
                        setActiveOrgId(org.id);
                        const firstTeam = org.teams[0];
                        setActiveTeamId(firstTeam?.id || null);
                        const firstProj = firstTeam?.projects[0];
                        setActiveProjectId(firstProj?.id || null);
                        setActiveBoardId(firstProj?.boards[0]?.id || null);
                      }}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs font-medium transition ${activeOrg?.id === org.id
                        ? "bg-[var(--pw-rail-surface)] text-white"
                        : "text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)]/50 hover:text-white"
                        }`}
                    >
                      <span className="truncate">{org.name}</span>
                      <span className="font-mono text-[10px] opacity-75">
                        {org.orgRole}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Teams */}
              {activeOrg && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--pw-rail-muted)]">
                      <Users className="h-3.5 w-3.5" />
                      Teams
                    </span>
                    <div className="flex items-center gap-1">
                      {activeTeam && (
                        <button
                          type="button"
                          data-testid="manage-team-members-btn"
                          onClick={() => setShowTeamMembersModal(true)}
                          className="rounded p-0.5 text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)] hover:text-white"
                          title="Team Members & Roles"
                        >
                          <Shield className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {activeOrg.orgRole === "admin" && (
                        <button
                          type="button"
                          data-testid="new-team-btn"
                          onClick={() => setShowNewTeam((p) => !p)}
                          className="rounded p-0.5 text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)] hover:text-white"
                          title="New Team"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {showNewTeam && (
                    <form onSubmit={handleCreateTeam} className="mb-2 flex gap-1">
                      <input
                        data-testid="new-team-input"
                        type="text"
                        value={newTeamName}
                        onChange={(e) => setNewTeamName(e.target.value)}
                        placeholder="Team name..."
                        className="w-full rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] px-2 py-1 text-xs text-white"
                      />
                      <button
                        type="submit"
                        data-testid="create-team-submit"
                        className="rounded bg-[var(--pw-accent)] px-2 py-1 text-xs font-medium text-white"
                      >
                        Add
                      </button>
                    </form>
                  )}

                  <div className="space-y-0.5">
                    {activeOrg.teams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        data-testid={`team-item-${team.slug}`}
                        onClick={() => {
                          setActiveTeamId(team.id);
                          const firstProj = team.projects[0];
                          setActiveProjectId(firstProj?.id || null);
                          setActiveBoardId(firstProj?.boards[0]?.id || null);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition ${activeTeam?.id === team.id
                          ? "bg-[var(--pw-rail-surface)] font-medium text-white"
                          : "text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)]/50 hover:text-white"
                          }`}
                      >
                        <span className="truncate">{team.name}</span>
                        <span className="font-mono text-[10px] opacity-75">
                          {team.effectiveRole}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Projects & Boards */}
              {activeTeam && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--pw-rail-muted)]">
                      <Layers className="h-3.5 w-3.5" />
                      Projects & Boards
                    </span>
                    {(activeTeam.effectiveRole === "admin" ||
                      activeTeam.effectiveRole === "lead") && (
                        <button
                          type="button"
                          data-testid="new-project-btn"
                          onClick={() => setShowNewProject((p) => !p)}
                          className="rounded p-0.5 text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)] hover:text-white"
                          title="New Project"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                  </div>

                  {showNewProject && (
                    <form
                      onSubmit={handleCreateProject}
                      className="mb-2 space-y-1.5 rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-surface)] p-2"
                    >
                      <input
                        data-testid="new-project-name-input"
                        type="text"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        placeholder="Project name..."
                        className="w-full rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-bg)] px-2 py-1 text-xs text-white"
                      />
                      <div className="flex gap-1">
                        <input
                          data-testid="new-project-key-input"
                          type="text"
                          value={newProjectKey}
                          onChange={(e) =>
                            setNewProjectKey(e.target.value.toUpperCase())
                          }
                          placeholder="KEY (e.g. CORE)"
                          maxLength={8}
                          className="w-full rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-bg)] px-2 py-1 font-mono text-xs text-white"
                        />
                        <button
                          type="submit"
                          data-testid="create-project-submit"
                          className="rounded bg-[var(--pw-accent)] px-2.5 py-1 text-xs font-medium text-white"
                        >
                          Create
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-2">
                    {activeTeam.projects.map((proj) => (
                      <div
                        key={proj.id}
                        className="rounded border border-[var(--pw-rail-border)]/60 bg-[var(--pw-rail-surface)]/40 p-1.5"
                      >
                        <div className="flex items-center justify-between px-1.5 py-1">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveProjectId(proj.id);
                              if (proj.boards[0]) {
                                setActiveBoardId(proj.boards[0].id);
                              }
                            }}
                            className="flex items-center gap-1.5 text-left text-xs font-semibold text-white"
                          >
                            <span className="rounded bg-[var(--pw-rail-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--pw-accent)]">
                              {proj.key}
                            </span>
                            <span className="truncate">{proj.name}</span>
                          </button>
                          {(activeTeam.effectiveRole === "admin" ||
                            activeTeam.effectiveRole === "lead") && (
                              <button
                                type="button"
                                data-testid={`new-board-btn-${proj.key}`}
                                onClick={() => {
                                  setActiveProjectId(proj.id);
                                  setShowNewBoard((p) => !p);
                                }}
                                className="rounded p-0.5 text-[var(--pw-rail-muted)] hover:text-white"
                                title="New Board"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            )}
                        </div>

                        {showNewBoard && activeProjectId === proj.id && (
                          <form
                            onSubmit={handleCreateBoard}
                            className="mt-1 mb-1.5 flex gap-1 px-1"
                          >
                            <input
                              data-testid="new-board-input"
                              type="text"
                              value={newBoardName}
                              onChange={(e) => setNewBoardName(e.target.value)}
                              placeholder="Board name..."
                              className="w-full rounded border border-[var(--pw-rail-border)] bg-[var(--pw-rail-bg)] px-2 py-1 text-xs text-white"
                            />
                            <button
                              type="submit"
                              data-testid="create-board-submit"
                              className="rounded bg-[var(--pw-accent)] px-2 py-1 text-xs font-medium text-white"
                            >
                              Add
                            </button>
                          </form>
                        )}

                        <div className="mt-1 space-y-0.5 pl-2">
                          {proj.boards.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              data-testid={`board-item-${b.name}`}
                              onClick={() => {
                                setActiveProjectId(proj.id);
                                setActiveBoardId(b.id);
                              }}
                              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition ${activeBoardId === b.id
                                ? "bg-[var(--pw-accent)] font-medium text-white"
                                : "text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)] hover:text-white"
                                }`}
                            >
                              <FolderKanban className="h-3 w-3 shrink-0" />
                              <span className="truncate">{b.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Rail Footer */}
            <div className="border-t border-[var(--pw-rail-border)] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/documentation"
                  data-testid="nav-documentation"
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)] hover:text-white transition min-w-0 flex-1"
                >
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Documentation</span>
                </a>
                <span
                  data-testid="sidebar-version"
                  className="shrink-0 font-mono text-[10px] text-[var(--pw-rail-muted)] px-1.5"
                >
                  {displayVersion}
                </span>
              </div>
              {activeOrg?.orgRole === "admin" && (
                <Link
                  href="/dashboard/system"
                  data-testid="nav-system-config"
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)] hover:text-white transition w-full"
                >
                  <Settings className="h-3.5 w-3.5 shrink-0" />
                  <span>System Configuration</span>
                </Link>
              )}
              <div className="flex items-center justify-between text-xs">
                <div className="truncate">
                  <div className="font-medium text-white truncate">
                    {user.name}
                  </div>
                  <div className="font-mono text-[11px] text-[var(--pw-rail-muted)] truncate">
                    {user.email}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowShortcutsModal(true)}
                    className="rounded p-1.5 text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)] hover:text-white"
                    title="Keyboard Shortcuts (?)"
                  >
                    <Keyboard className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    data-testid="theme-toggle-btn"
                    onClick={toggleTheme}
                    className="rounded p-1.5 text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)] hover:text-white"
                    title="Toggle Theme"
                  >
                    {darkMode ? (
                      <Sun className="h-3.5 w-3.5" />
                    ) : (
                      <Moon className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    data-testid="logout-btn"
                    onClick={handleLogout}
                    className="rounded p-1.5 text-[var(--pw-rail-muted)] hover:bg-[var(--pw-rail-surface)] hover:text-red-400"
                    title="Sign Out"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Breadcrumb & Global Search Header */}
        <header className="flex min-h-12 shrink-0 flex-wrap sm:flex-nowrap items-center justify-between border-b border-[var(--pw-border)] bg-[var(--pw-surface)] px-3 sm:px-4 py-1.5 sm:py-0 gap-2 sm:gap-4">
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <button
              type="button"
              aria-label="Toggle Sidebar"
              onClick={() => setSidebarOpen((p) => !p)}
              className="flex h-7 w-7 items-center justify-center rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)] shrink-0"
              title="Toggle Sidebar ([)"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>

            {/* Global Spotlight Command Bar Trigger */}
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <button
                type="button"
                data-testid="command-palette-trigger"
                onClick={() => {
                  setPaletteInitialQuery("");
                  setPaletteHelpMode(false);
                  setPaletteOpen(true);
                }}
                className="flex w-full items-center justify-between gap-2 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 text-xs text-[var(--pw-ink-muted)] hover:border-[var(--pw-accent)] hover:text-[var(--pw-ink)] transition"
              >
                <span className="flex items-center gap-2 truncate">
                  <Search className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Search or / commands...</span>
                </span>
                <kbd className="hidden sm:inline-block shrink-0 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--pw-ink-muted)]">
                  {formatShortcut(shortcuts.openPalette)}
                </kbd>
              </button>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 shrink-0">
            {boardData && (
              <div
                data-testid="board-view-switcher"
                className="flex items-center rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-0.5"
              >
                <button
                  type="button"
                  data-testid="view-switcher-kanban"
                  onClick={() => setBoardViewMode("kanban")}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 min-h-[44px] sm:min-h-0 text-xs font-medium transition ${boardViewMode === "kanban"
                    ? "bg-[var(--pw-surface)] text-[var(--pw-ink)] font-semibold shadow-xs"
                    : "text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)]"
                    }`}
                >
                  <Columns3 className="h-3.5 w-3.5" />
                  <span>Board</span>
                </button>
                <button
                  type="button"
                  data-testid="view-switcher-calendar"
                  onClick={() => setBoardViewMode("calendar")}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 min-h-[44px] sm:min-h-0 text-xs font-medium transition ${boardViewMode === "calendar"
                    ? "bg-[var(--pw-surface)] text-[var(--pw-ink)] font-semibold shadow-xs"
                    : "text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)]"
                    }`}
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  <span>Calendar</span>
                </button>
              </div>
            )}

            {boardData && canEditStructure && (
              <button
                type="button"
                data-testid="new-column-btn"
                onClick={() => setShowNewColumn((p) => !p)}
                className="flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 min-h-[44px] sm:min-h-0 text-xs font-medium text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)]"
              >
                <Columns3 className="h-3.5 w-3.5" />
                <span>Add Column</span>
              </button>
            )}

            {boardData && canMutateTickets && (
              <button
                type="button"
                data-testid="new-ticket-btn"
                onClick={() => {
                  setNewTicketColumnId(getDefaultNewTicketColumnId(boardData.columns));
                  setShowNewTicket(true);
                }}
                className="flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded bg-[var(--pw-accent)] px-3 py-1.5 min-h-[44px] sm:min-h-0 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Ticket</span>
              </button>
            )}

            <NotificationBell
              onOpenTicket={(tid, cid) => {
                setSelectedTicketId(tid);
                if (cid) setHighlightedCommentId(cid);
              }}
            />
          </div>
        </header>

        {errorBanner && (
          <div className="flex items-center justify-between border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-[var(--pw-urgent)]">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="font-mono text-xs underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* New Column Inline Bar */}
        {showNewColumn && boardData && (
          <form
            onSubmit={handleCreateColumn}
            className="flex items-center gap-2 border-b border-[var(--pw-border)] bg-[var(--pw-surface-muted)] px-4 py-2"
          >
            <span className="font-mono text-xs font-semibold">NEW COLUMN:</span>
            <input
              data-testid="new-column-name-input"
              type="text"
              required
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              placeholder="Column name (e.g. QA Verification)"
              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1 text-xs"
            />
            <input
              data-testid="new-column-wip-input"
              type="number"
              min={1}
              value={newColumnWip}
              onChange={(e) => setNewColumnWip(e.target.value)}
              placeholder="WIP limit (optional)"
              className="w-36 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1 font-mono text-xs"
            />
            <button
              type="submit"
              data-testid="create-column-submit"
              className="rounded bg-[var(--pw-accent)] px-3 py-1 text-xs font-semibold text-white"
            >
              Create Column
            </button>
            <button
              type="button"
              onClick={() => setShowNewColumn(false)}
              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1 text-xs"
            >
              Cancel
            </button>
          </form>
        )}

        {/* Workspace / Board Canvas */}
        <div className="relative flex flex-1 overflow-hidden">
          {!boardData && (boardLoading || activeBoardId) ? (
            <BoardSkeleton />
          ) : !boardData ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="max-w-md space-y-4 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 shadow-[var(--pw-shadow)]">
                <h2 className="text-base font-semibold">
                  {orgs.length === 0 ? "Set up your workspace" : "No board selected"}
                </h2>
                <p className="text-xs leading-relaxed text-[var(--pw-ink-secondary)]">
                  {orgs.length === 0
                    ? "Create an organization, team, and board from the sidebar to start tracking tickets."
                    : "Pick a board from the sidebar, or create a new project and board to start tracking work."}
                </p>
                {orgs.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setShowNewOrg(true)}
                    className="rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)]"
                  >
                    + Create Organization
                  </button>
                )}
              </div>
            </div>
          ) : (
            <RegionErrorBoundary regionName="board">
              <div
                className={`relative flex flex-1 flex-col overflow-hidden transition-opacity duration-150 ${boardLoading ? "opacity-60" : "opacity-100"
                  }`}
              >
                <RevalidateBar active={boardLoading} label="Refreshing board..." />
                {ssePaused && (
                  <div
                    data-testid="board-header"
                    role="status"
                    aria-live="polite"
                    className="flex items-center justify-between gap-2 border-b border-[var(--pw-border)] bg-[var(--pw-surface)] px-4 py-1.5 text-xs text-[var(--pw-ink-muted)]"
                  >
                    <span>Updates paused. Refresh to reconnect.</span>
                    <button
                      type="button"
                      data-testid="sse-reconnect-now"
                      onClick={() => reconnectSseRef.current?.()}
                      className="font-medium text-[var(--pw-accent)] hover:underline"
                    >
                      Reconnect now
                    </button>
                  </div>
                )}
                {boardFilters && (
                  <div
                    data-testid="active-board-filters"
                    className="flex items-center justify-between gap-2 border-b border-[var(--pw-border)] bg-[var(--pw-surface-muted)] px-4 py-1.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] uppercase text-[var(--pw-ink-muted)]">
                        Active Filters:
                      </span>
                      {boardFilters.priority && (
                        <span className="rounded bg-[var(--pw-surface)] px-2 py-0.5 font-mono text-[11px] border border-[var(--pw-border)]">
                          priority:{boardFilters.priority}
                        </span>
                      )}
                      {boardFilters.assignee && (
                        <span className="rounded bg-[var(--pw-surface)] px-2 py-0.5 font-mono text-[11px] border border-[var(--pw-border)]">
                          assignee:{boardFilters.assignee}
                        </span>
                      )}
                      {boardFilters.label && (
                        <span className="rounded bg-[var(--pw-surface)] px-2 py-0.5 font-mono text-[11px] border border-[var(--pw-border)]">
                          label:{boardFilters.label}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setBoardFilters(null)}
                      className="text-[11px] font-medium text-[var(--pw-accent)] hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
                {(() => {
                  const filteredTickets = !boardFilters
                    ? boardData.tickets
                    : boardData.tickets.filter((t) => {
                      if (boardFilters.priority && t.priority !== boardFilters.priority) {
                        return false;
                      }
                      if (boardFilters.assignee) {
                        const target = boardFilters.assignee.toLowerCase();
                        const memberMatch = boardData.members.find(
                          (m) =>
                            m.email.toLowerCase().includes(target) ||
                            m.name.toLowerCase().includes(target)
                        );
                        if (!memberMatch || t.assigneeId !== memberMatch.id) {
                          return false;
                        }
                      }
                      if (boardFilters.label) {
                        const targetLbl = boardFilters.label.toLowerCase();
                        if (!t.labels.some((l) => l.toLowerCase() === targetLbl)) {
                          return false;
                        }
                      }
                      return true;
                    });

                  return boardViewMode === "calendar" ? (
                    <main className="flex-1 overflow-hidden flex flex-col">
                      <BoardCalendarView
                        tickets={filteredTickets}
                        columns={boardData.columns}
                        members={boardData.members}
                        canMutateTickets={canMutateTickets}
                        onSelectTicket={setSelectedTicketId}
                        onUpdateTicketDueDate={handleUpdateTicketDueDate}
                      />
                    </main>
                  ) : (
                    <DndContext
                      sensors={columnSensors}
                      onDragEnd={handleColumnDragEnd}
                    >
                      <SortableContext
                        items={boardData.columns.map((c) => c.id)}
                        strategy={horizontalListSortingStrategy}
                      >
                        <main
                          data-testid="kanban-board-canvas"
                          className="flex flex-1 gap-3.5 overflow-x-auto p-4 items-start"
                        >
                          {boardData.columns.map((col, colIdx) => {
                            const colTickets = filteredTickets
                              .filter((t) => t.columnId === col.id)
                              .sort((a, b) => a.position - b.position);
                            const overWip =
                              col.wipLimit !== null && colTickets.length > col.wipLimit;

                            return (
                              <WorkspaceSortableColumnItem
                                key={col.id}
                                col={col}
                                colIdx={colIdx}
                                totalColumns={boardData.columns.length}
                                colTickets={colTickets}
                                overWip={overWip}
                                canEditStructure={canEditStructure}
                                canMutateTickets={canMutateTickets}
                                draggedTicketId={draggedTicketId}
                                rollbackTicketId={rollbackTicketId}
                                setDraggedTicketId={setDraggedTicketId}
                                handleMoveTicket={handleMoveTicket}
                                handleRenameColumn={handleRenameColumn}
                                handleDeleteColumn={handleDeleteColumn}
                                handleMoveColumnOrder={handleMoveColumnOrder}
                                setNewTicketColumnId={setNewTicketColumnId}
                                setShowNewTicket={setShowNewTicket}
                                selectedTicketId={selectedTicketId}
                                setSelectedTicketId={setSelectedTicketId}
                                boardMembers={boardData.members}
                                allColumns={boardData.columns}
                                allTickets={boardData.tickets}
                                setErrorBanner={setErrorBanner}
                                userRole={effectiveRole}
                                userSubRole={effectiveSubRole}
                              />
                            );
                          })}
                        </main>
                      </SortableContext>
                    </DndContext>
                  );
                })()}
              </div>
            </RegionErrorBoundary>
          )}

          {/* Right Slide-Over Ticket Detail Panel */}
          <Presence show={Boolean(selectedTicketId && boardData)} duration="base">
            {(phase) =>
              selectedTicketId && boardData ? (
                <Slide
                  show={phase === "entered"}
                  direction="left"
                  distance="md"
                  duration="base"
                  className="fixed inset-0 z-40 md:static flex w-full md:w-[520px] shrink-0"
                >
                  <aside
                    data-testid="ticket-detail-panel"
                    className="flex w-full flex-col border-l border-[var(--pw-border)] bg-[var(--pw-surface)] shadow-[var(--pw-shadow)] overflow-y-auto"
                  >
                    <RegionErrorBoundary regionName="ticket details">
                      {ticketLoading && (!ticketDetails || ticketDetails.ticket.id !== selectedTicketId) ? (
                        <TicketPanelSkeleton />
                      ) : ticketDetails ? (
                        <>
                          {/* Panel Top Bar */}
                          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--pw-border)] bg-[var(--pw-surface)] px-4 py-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                data-testid="detail-ticket-key"
                                className="shrink-0 whitespace-nowrap rounded bg-[var(--pw-accent-soft)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--pw-accent)] tabular-nums"
                              >
                                {ticketDetails.ticket.key}
                              </span>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              {user && (
                                <TicketViewerAvatars
                                  viewers={ticketPresence.viewers}
                                  currentUserId={user.id}
                                />
                              )}
                              <TicketWatcherControls
                                ticketId={ticketDetails.ticket.id}
                                initialStatus={ticketDetails.watchStatus}
                                onStatusChange={(next) => {
                                  setTicketDetails((prev) =>
                                    prev ? { ...prev, watchStatus: next } : prev
                                  );
                                  setBoardData((prev) =>
                                    prev
                                      ? {
                                        ...prev,
                                        tickets: prev.tickets.map((t) =>
                                          t.id === ticketDetails.ticket.id
                                            ? { ...t, isWatching: next.watching }
                                            : t
                                        ),
                                      }
                                      : prev
                                  );
                                }}
                              />
                              <button
                                type="button"
                                aria-label="Close ticket details"
                                data-testid="close-detail-panel"
                                onClick={() => setSelectedTicketId(null)}
                                className="rounded p-1 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)]"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          <div className="p-4 space-y-6">
                            {/* Title, Assignee & Description */}
                            <div>
                              {editingTicketFields ? (
                                <form onSubmit={handleSaveTicketEdits} className="space-y-3">
                                  <input
                                    data-testid="edit-ticket-title-input"
                                    type="text"
                                    required
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-1.5 text-sm font-semibold"
                                  />
                                  <MentionTextarea
                                    data-testid="edit-ticket-desc-input"
                                    rows={4}
                                    ticketId={ticketDetails.ticket.id}
                                    value={editDesc}
                                    onChange={(val) => setEditDesc(val)}
                                    placeholder="Markdown description... (type @ to mention)"
                                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2.5 font-mono text-xs"
                                  />
                                  <input
                                    data-testid="edit-ticket-labels-input"
                                    type="text"
                                    value={editLabels}
                                    onChange={(e) => setEditLabels(e.target.value)}
                                    placeholder="Comma-separated labels (e.g. backend, security)"
                                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono text-xs"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      type="submit"
                                      data-testid="save-ticket-edits-btn"
                                      className="rounded bg-[var(--pw-accent)] px-3 py-1 text-xs font-semibold text-white"
                                    >
                                      Save Changes
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingTicketFields(false)}
                                      className="rounded border border-[var(--pw-border)] px-3 py-1 text-xs"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <div>
                                  <div className="flex items-start justify-between gap-2">
                                    <h2
                                      data-testid="detail-ticket-title"
                                      className="text-base font-semibold tracking-tight text-[var(--pw-ink)]"
                                    >
                                      {ticketDetails.ticket.title}
                                    </h2>
                                    {canMutateTickets && (
                                      <button
                                        type="button"
                                        data-testid="edit-ticket-btn"
                                        onClick={() => setEditingTicketFields(true)}
                                        className="shrink-0 rounded border border-[var(--pw-border)] px-2 py-0.5 text-xs text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)]"
                                      >
                                        Edit
                                      </button>
                                    )}
                                  </div>

                                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--pw-ink-secondary)]">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-[11px] uppercase">
                                        Assignee:
                                      </span>
                                      <select
                                        disabled={!canMutateTickets}
                                        value={ticketDetails.ticket.assigneeId || ""}
                                        onChange={(e) =>
                                          handleUpdateTicketField({
                                            assigneeId: e.target.value || null,
                                          })
                                        }
                                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 py-0.5 text-xs"
                                      >
                                        <option value="">Unassigned</option>
                                        {boardData.members.map((m) => (
                                          <option key={m.id} value={m.id}>
                                            {m.name} ({m.role})
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-[11px] uppercase">
                                        Due Date:
                                      </span>
                                      <input
                                        type="date"
                                        data-testid="detail-ticket-due-date"
                                        disabled={!canMutateTickets}
                                        value={
                                          ticketDetails.ticket.dueDate
                                            ? new Date(ticketDetails.ticket.dueDate).toISOString().slice(0, 10)
                                            : ""
                                        }
                                        onChange={(e) =>
                                          handleUpdateTicketField({
                                            dueDate: e.target.value
                                              ? new Date(`${e.target.value}T12:00:00Z`).toISOString()
                                              : null,
                                          })
                                        }
                                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 py-0.5 text-xs text-[var(--pw-ink)]"
                                      />
                                    </div>
                                  </div>

                                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--pw-ink-secondary)]">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-[11px] uppercase">
                                        Status:
                                      </span>
                                      <select
                                        data-testid="detail-column-select"
                                        disabled={!canMutateTickets}
                                        value={ticketDetails.ticket.columnId}
                                        onChange={(e) =>
                                          handleMoveTicket(ticketDetails.ticket.id, e.target.value)
                                        }
                                        className="min-w-0 max-w-[140px] truncate rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 py-0.5 text-xs"
                                      >
                                        {boardData.columns.map((c, cIdx) => {
                                          const currentTicketColIdx = boardData.columns.findIndex(
                                            (col) => col.id === ticketDetails.ticket.columnId
                                          );
                                          const currentTicketCol = boardData.columns[currentTicketColIdx];
                                          const subErr = currentTicketCol && currentTicketCol.id !== c.id
                                            ? checkSubRoleTransition(effectiveRole, effectiveSubRole, currentTicketCol.name, c.name)
                                            : null;
                                          const isDisallowed =
                                            !canEditStructure &&
                                            (Boolean(subErr) ||
                                              (currentTicketColIdx !== -1 && cIdx > currentTicketColIdx + 1));

                                          return (
                                            <option
                                              key={c.id}
                                              value={c.id}
                                              disabled={isDisallowed}
                                              title={subErr || (isDisallowed ? "Sequential step required" : undefined)}
                                              className={isDisallowed ? "text-gray-400 opacity-50" : ""}
                                            >
                                              {c.name}{isDisallowed ? " (locked)" : ""}
                                            </option>
                                          );
                                        })}
                                      </select>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-[11px] uppercase">
                                        Priority:
                                      </span>
                                      <select
                                        data-testid="detail-priority-select"
                                        disabled={!canMutateTickets}
                                        value={ticketDetails.ticket.priority}
                                        onChange={(e) =>
                                          handleUpdateTicketField({
                                            priority: e.target.value as TicketItem["priority"],
                                          })
                                        }
                                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 py-0.5 text-xs"
                                      >
                                        <option value="urgent">Urgent</option>
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                        <option value="none">None</option>
                                      </select>
                                    </div>
                                  </div>

                                  {ticketDetails.ticket.labels.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1 text-[var(--pw-ink-secondary)]">
                                      {ticketDetails.ticket.labels.map((lbl) => (
                                        <span
                                          key={lbl}
                                          className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 font-mono text-[10px]"
                                        >
                                          {lbl}
                                        </span>
                                      ))}
                                    </div>
                                  )}

                                  <div className="mt-4 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3">
                                    <MarkdownView content={ticketDetails.ticket.description} />
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* GitHub / GitLab Links Section */}
                            <section
                              data-testid="ticket-links-section"
                              className="space-y-2 border-t border-[var(--pw-border)] pt-4"
                            >
                              <h3 className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--pw-ink-secondary)]">
                                <GitPullRequest className="h-3.5 w-3.5" />
                                GitHub & GitLab Links ({ticketDetails.links.length})
                              </h3>

                              {canMutateTickets && (
                                <form onSubmit={handleAddLink} className="flex gap-1.5">
                                  <input
                                    data-testid="add-link-input"
                                    type="url"
                                    value={linkUrl}
                                    onChange={(e) => setLinkUrl(e.target.value)}
                                    placeholder="https://github.com/org/repo/pull/42 or https://gitlab.com/..."
                                    className="flex-1 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1 font-mono text-xs"
                                  />
                                  <button
                                    type="submit"
                                    data-testid="add-link-btn"
                                    className="rounded bg-[var(--pw-accent)] px-3 py-1 text-xs font-semibold text-white"
                                  >
                                    Attach Link
                                  </button>
                                </form>
                              )}

                              <div className="space-y-1.5">
                                {ticketDetails.links.map((lnk) => (
                                  <div
                                    key={lnk.id}
                                    data-testid={`ticket-link-item-${lnk.externalRef}`}
                                    className="flex items-center justify-between gap-2 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 text-xs"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="rounded bg-[var(--pw-surface-muted)] px-1.5 py-0.5 font-mono text-[10px] uppercase">
                                        {lnk.provider} · {lnk.kind}
                                      </span>
                                      <a
                                        href={lnk.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-medium text-[var(--pw-ink)] hover:text-[var(--pw-accent)] truncate flex items-center gap-1"
                                      >
                                        <span className="truncate">{lnk.title}</span>
                                        <ExternalLink className="h-3 w-3 shrink-0" />
                                      </a>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--pw-success)]">
                                        {lnk.status}
                                      </span>
                                      {canMutateTickets && (
                                        <button
                                          type="button"
                                          data-testid={`remove-link-${lnk.id}`}
                                          onClick={() => handleRemoveLink(lnk.id)}
                                          className="text-[var(--pw-ink-muted)] hover:text-[var(--pw-urgent)]"
                                          title="Remove Link"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </section>

                            {/* MinIO File Attachments Section */}
                            <section
                              data-testid="ticket-attachments-section"
                              className="space-y-2 border-t border-[var(--pw-border)] pt-4"
                            >
                              <div className="flex items-center justify-between">
                                <h3 className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--pw-ink-secondary)]">
                                  <Paperclip className="h-3.5 w-3.5" />
                                  Attachments ({ticketDetails.attachments.length})
                                </h3>
                                {canMutateTickets && (
                                  <label className="cursor-pointer rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--pw-surface-hover)]">
                                    <span>
                                      {uploadingAttachment ? "Uploading..." : "+ Upload File"}
                                    </span>
                                    <input
                                      data-testid="attachment-file-input"
                                      type="file"
                                      onChange={handleUploadAttachment}
                                      className="hidden"
                                    />
                                  </label>
                                )}
                              </div>

                              <div className="space-y-1.5">
                                {ticketDetails.attachments.map((att) => (
                                  <div
                                    key={att.id}
                                    data-testid={`attachment-item-${att.filename}`}
                                    className="flex items-center justify-between rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 text-xs"
                                  >
                                    <a
                                      href={att.downloadUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="font-mono text-xs text-[var(--pw-accent)] underline truncate"
                                    >
                                      {att.filename}
                                    </a>
                                    <span className="font-mono text-[10px] text-[var(--pw-ink-muted)] tabular-nums">
                                      {Math.max(1, Math.round(att.sizeBytes / 1024))} KB
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </section>

                            {/* Markdown Comments Section */}
                            <section
                              data-testid="ticket-comments-section"
                              className="space-y-3 border-t border-[var(--pw-border)] pt-4"
                            >
                              <h3 className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--pw-ink-secondary)]">
                                <MessageSquare className="h-3.5 w-3.5" />
                                Comments ({ticketDetails.comments.length})
                              </h3>

                              {canMutateTickets && (
                                <form onSubmit={handleAddComment} className="space-y-2">
                                  {user && (
                                    <TicketTypingIndicator
                                      typers={ticketPresence.typers}
                                      currentUserId={user.id}
                                    />
                                  )}
                                  <MentionTextarea
                                    data-testid="comment-input"
                                    rows={3}
                                    ticketId={ticketDetails.ticket.id}
                                    value={commentBody}
                                    onChange={(val) => setCommentBody(val)}
                                    onTyping={notifyTyping}
                                    placeholder="Write a markdown comment... (type @ to mention)"
                                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2.5 text-xs"
                                  />
                                  <button
                                    type="submit"
                                    data-testid="comment-submit-btn"
                                    className="rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white"
                                  >
                                    Post Comment
                                  </button>
                                </form>
                              )}

                              <div className="space-y-2">
                                {ticketDetails.comments.map((c) => {
                                  const isHighlighted = highlightedCommentId === c.id;
                                  const canEditThisComment =
                                    canMutateTickets &&
                                    (c.author.id === user?.id ||
                                      effectiveRole === "admin" ||
                                      effectiveRole === "lead");
                                  return (
                                    <div
                                      key={c.id}
                                      id={`comment-${c.id}`}
                                      data-testid="comment-item"
                                      className={`rounded border p-2.5 transition-colors ${isHighlighted
                                        ? "border-[var(--pw-accent)] bg-[var(--pw-accent-soft)]/40"
                                        : "border-[var(--pw-border)] bg-[var(--pw-bg)]"
                                        }`}
                                    >
                                      <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--pw-ink-secondary)]">
                                        <span className="font-semibold text-[var(--pw-ink)]">
                                          {c.author.name}
                                        </span>
                                        <div className="flex items-center gap-2">
                                          {canEditThisComment && editingCommentId !== c.id && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setEditingCommentId(c.id);
                                                setEditingCommentBody(c.body);
                                              }}
                                              className="text-[10px] font-medium text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)]"
                                            >
                                              Edit
                                            </button>
                                          )}
                                          <span className="font-mono text-[10px] tabular-nums">
                                            {new Date(c.createdAt).toLocaleTimeString([], {
                                              hour: "2-digit",
                                              minute: "2-digit",
                                            })}
                                          </span>
                                        </div>
                                      </div>
                                      {editingCommentId === c.id ? (
                                        <form
                                          onSubmit={(e) => handleSaveCommentEdit(e, c.id)}
                                          className="space-y-2 mt-1"
                                        >
                                          <MentionTextarea
                                            rows={3}
                                            ticketId={ticketDetails.ticket.id}
                                            value={editingCommentBody}
                                            onChange={(val) => setEditingCommentBody(val)}
                                            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2 text-xs"
                                          />
                                          <div className="flex gap-1.5">
                                            <button
                                              type="submit"
                                              className="rounded bg-[var(--pw-accent)] px-2.5 py-1 text-[11px] font-semibold text-white"
                                            >
                                              Save
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setEditingCommentId(null)}
                                              className="rounded border border-[var(--pw-border)] px-2.5 py-1 text-[11px]"
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </form>
                                      ) : (
                                        <MarkdownView
                                          content={c.body}
                                          mentionUsers={ticketDetails.mentionUsers}
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </section>

                            {/* Activity History Section */}
                            <section
                              data-testid="activity-history-list"
                              className="space-y-2 border-t border-[var(--pw-border)] pt-4"
                            >
                              <h3 className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--pw-ink-secondary)]">
                                <Activity className="h-3.5 w-3.5" />
                                Activity Log ({ticketDetails.activities.length})
                              </h3>
                              <div className="space-y-1.5">
                                {ticketDetails.activities.map((act) => (
                                  <div
                                    key={act.id}
                                    className="flex items-start justify-between gap-2 rounded border border-[var(--pw-border)]/60 bg-[var(--pw-bg)] px-2.5 py-1.5 text-[11px]"
                                  >
                                    <div>
                                      <span className="font-medium text-[var(--pw-ink)]">
                                        {act.actor?.name || "System"}
                                      </span>{" "}
                                      <span className="font-mono text-[var(--pw-accent)]">
                                        {act.action}
                                      </span>
                                      {act.action === "ticket.moved" &&
                                        Boolean(act.details.toColumnName) && (
                                          <span className="text-[var(--pw-ink-secondary)]">
                                            {" "}
                                            ({String(act.details.fromColumnName || "")} to{" "}
                                            {String(act.details.toColumnName)})
                                          </span>
                                        )}
                                    </div>
                                    <span className="font-mono text-[10px] text-[var(--pw-ink-muted)] tabular-nums shrink-0">
                                      {new Date(act.createdAt).toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </section>
                          </div>
                        </>
                      ) : null}
                    </RegionErrorBoundary>
                  </aside>
                </Slide>
              ) : null
            }
          </Presence>
        </div>
      </div>

      {/* New Ticket Modal */}
      {showNewTicket && boardData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            data-testid="new-ticket-modal"
            className="w-full max-w-lg rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-5 shadow-[var(--pw-shadow)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--pw-border)] pb-3 mb-4">
              <h2 className="text-sm font-semibold">
                Create Ticket in {boardData.project.key}
              </h2>
              <button
                type="button"
                onClick={() => setShowNewTicket(false)}
                className="text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                  Title
                </label>
                <input
                  data-testid="new-ticket-title-input"
                  type="text"
                  required
                  value={newTicketTitle}
                  onChange={(e) => setNewTicketTitle(e.target.value)}
                  placeholder="Implement SSE backpressure handling"
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-1.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                  Description (Markdown)
                </label>
                <textarea
                  data-testid="new-ticket-desc-input"
                  rows={4}
                  value={newTicketDesc}
                  onChange={(e) => setNewTicketDesc(e.target.value)}
                  placeholder="### Context&#10;Details and reproduction steps..."
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2.5 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                    Column
                  </label>
                  <select
                    data-testid="new-ticket-column-select"
                    value={
                      newTicketColumnId ||
                      getDefaultNewTicketColumnId(boardData.columns)
                    }
                    onChange={(e) => setNewTicketColumnId(e.target.value)}
                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 py-1.5 text-xs"
                  >
                    {boardData.columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    {boardData.columns.map((c) => {
                      const isDisallowedForTester =
                        effectiveRole === "member" &&
                        effectiveSubRole === "tester" &&
                        getColumnStage(c.name) === "in_progress";
                      return (
                        <option key={c.id} value={c.id} disabled={isDisallowedForTester}>
                          {c.name}{isDisallowedForTester ? " (Testers report to Backlog/New)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                    Priority
                  </label>
                  <select
                    data-testid="new-ticket-priority-select"
                    value={newTicketPriority}
                    onChange={(e) =>
                      setNewTicketPriority(
                        e.target.value as TicketItem["priority"]
                      )
                    }
                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 py-1.5 text-xs"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="none">None</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                    Assignee
                  </label>
                  <select
                    value={newTicketAssigneeId}
                    onChange={(e) => setNewTicketAssigneeId(e.target.value)}
                    className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 py-1.5 text-xs"
                  >
                    <option value="">Unassigned</option>
                    {boardData.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                  Labels (comma-separated)
                </label>
                <input
                  data-testid="new-ticket-labels-input"
                  type="text"
                  value={newTicketLabels}
                  onChange={(e) => setNewTicketLabels(e.target.value)}
                  placeholder="realtime, postgres, backend"
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-1.5 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--pw-ink-secondary)] mb-1">
                  Due Date (optional)
                </label>
                <input
                  data-testid="new-ticket-due-date-input"
                  type="date"
                  value={newTicketDueDate}
                  onChange={(e) => setNewTicketDueDate(e.target.value)}
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-1.5 text-xs text-[var(--pw-ink)]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewTicket(false)}
                  className="rounded border border-[var(--pw-border)] px-3 py-1.5 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="create-ticket-submit"
                  className="rounded bg-[var(--pw-accent)] px-4 py-1.5 text-xs font-semibold text-white"
                >
                  Create Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Team Members & RBAC Modal */}
      {showTeamMembersModal && activeTeam && (
        <div
          data-testid="team-members-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-5 shadow-[var(--pw-shadow)]">
            <div className="flex items-center justify-between border-b border-[var(--pw-border)] pb-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold">
                  Team Access & Accounts · {activeTeam.name}
                </h2>
                <p className="font-mono text-[10px] text-[var(--pw-ink-secondary)]">
                  {activeOrg?.orgRole === "admin"
                    ? "ORG ADMIN · CAN PROVISION ADMIN, LEAD, MEMBER, VIEWER"
                    : activeTeam.effectiveRole === "lead"
                      ? "TEAM LEAD · CAN PROVISION LEAD, MEMBER, VIEWER"
                      : "READ-ONLY TEAM ROSTER"}
                </p>
              </div>
              <button
                type="button"
                data-testid="close-team-members-modal"
                onClick={() => setShowTeamMembersModal(false)}
                className="text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {canEditStructure && (
              <div className="mb-4">
                <div className="mb-3 flex rounded border border-[var(--pw-border)] bg-[var(--pw-surface-muted)] p-0.5 text-xs">
                  <button
                    type="button"
                    data-testid="provision-tab-create"
                    onClick={() => setProvisionMode("create")}
                    className={`flex-1 rounded px-2.5 py-1 font-medium transition ${provisionMode === "create"
                      ? "bg-[var(--pw-surface)] text-[var(--pw-ink)] shadow-xs"
                      : "text-[var(--pw-ink-secondary)]"
                      }`}
                  >
                    Create New Account
                  </button>
                  <button
                    type="button"
                    data-testid="provision-tab-assign"
                    onClick={() => setProvisionMode("assign")}
                    className={`flex-1 rounded px-2.5 py-1 font-medium transition ${provisionMode === "assign"
                      ? "bg-[var(--pw-surface)] text-[var(--pw-ink)] shadow-xs"
                      : "text-[var(--pw-ink-secondary)]"
                      }`}
                  >
                    Assign Existing User
                  </button>
                </div>

                {provisionMode === "create" ? (
                  <form
                    onSubmit={handleProvisionTeamMember}
                    className="space-y-2 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3"
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        data-testid="provision-name-input"
                        type="text"
                        required
                        value={provisionName}
                        onChange={(e) => setProvisionName(e.target.value)}
                        placeholder="Full name..."
                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                      />
                      <input
                        data-testid="provision-email-input"
                        type="email"
                        required
                        value={provisionEmail}
                        onChange={(e) => {
                          setProvisionEmail(e.target.value);
                          setProvisionEmailError(null);
                        }}
                        placeholder="user@org.dev"
                        className={`rounded border bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs ${provisionEmailError
                          ? "border-red-500 focus:border-red-500"
                          : "border-[var(--pw-border)]"
                          }`}
                      />
                      {provisionEmailError && (
                        <div
                          data-testid="provision-email-error"
                          className="col-span-2 text-[11px] font-medium text-red-500"
                        >
                          {provisionEmailError}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        data-testid="provision-password-input"
                        type="password"
                        required
                        minLength={8}
                        value={provisionPassword}
                        onChange={(e) => setProvisionPassword(e.target.value)}
                        placeholder="Initial password (8+ chars)"
                        className="flex-1 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs"
                      />
                      <select
                        data-testid="provision-role-select"
                        value={provisionRole}
                        onChange={(e) =>
                          setProvisionRole(
                            e.target.value as
                            | "admin"
                            | "lead"
                            | "member"
                            | "viewer"
                          )
                        }
                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1.5 font-mono text-xs"
                      >
                        {activeOrg?.orgRole === "admin" && (
                          <option value="admin">admin</option>
                        )}
                        <option value="lead">lead</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <button
                        type="submit"
                        data-testid="provision-submit-btn"
                        className="rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Create
                      </button>
                    </div>
                  </form>
                ) : (
                  <form
                    onSubmit={handleInviteTeamMember}
                    className="flex flex-col gap-1.5 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3"
                  >
                    <div className="flex gap-1.5">
                      <input
                        data-testid="assign-email-input"
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => {
                          setInviteEmail(e.target.value);
                          setInviteEmailError(null);
                        }}
                        placeholder="Registered user email..."
                        className={`flex-1 rounded border bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs ${inviteEmailError
                          ? "border-red-500 focus:border-red-500"
                          : "border-[var(--pw-border)]"
                          }`}
                      />
                      <select
                        data-testid="assign-role-select"
                        value={inviteRole}
                        onChange={(e) =>
                          setInviteRole(
                            e.target.value as
                            | "admin"
                            | "lead"
                            | "member"
                            | "viewer"
                          )
                        }
                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1.5 font-mono text-xs"
                      >
                        {activeOrg?.orgRole === "admin" && (
                          <option value="admin">admin</option>
                        )}
                        <option value="lead">lead</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <button
                        type="submit"
                        data-testid="assign-submit-btn"
                        className="rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Assign
                      </button>
                    </div>
                    {inviteEmailError && (
                      <div
                        data-testid="assign-email-error"
                        className="text-[11px] font-medium text-red-500 mt-1"
                      >
                        {inviteEmailError}
                      </div>
                    )}
                  </form>
                )}
              </div>
            )}

            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {(teamMembersList.length > 0
                ? teamMembersList
                : boardData?.members || []
              ).map((m) => (
                <div
                  key={m.id}
                  data-testid={`team-member-row-${m.email}`}
                  className="flex items-center justify-between rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-xs"
                >
                  <div>
                    <div className="font-medium">{m.name}</div>
                    <div className="font-mono text-[11px] text-[var(--pw-ink-secondary)]">
                      {m.email}
                    </div>
                  </div>
                  <span
                    data-testid={`team-member-role-${m.email}`}
                    className="rounded bg-[var(--pw-surface-muted)] px-2 py-0.5 font-mono text-[10px] uppercase"
                  >
                    {m.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-5 shadow-[var(--pw-shadow)]">
            <div className="flex items-center justify-between border-b border-[var(--pw-border)] pb-3 mb-3">
              <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="text-[var(--pw-ink-muted)] hover:text-[var(--pw-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span>Open Command Bar</span>
                <kbd className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 font-mono">
                  / or {formatShortcut(shortcuts.openPalette)}
                </kbd>
              </div>
              <div className="flex justify-between">
                <span>Command Bar Help</span>
                <kbd className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 font-mono">
                  {formatShortcut(shortcuts.paletteHelp)}
                </kbd>
              </div>
              <div className="flex justify-between">
                <span>New Ticket</span>
                <kbd className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 font-mono">
                  {formatShortcut(shortcuts.newTicket)}
                </kbd>
              </div>
              <div className="flex justify-between">
                <span>Toggle Navigation Sidebar</span>
                <kbd className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 font-mono">
                  {formatShortcut(shortcuts.toggleSidebar)}
                </kbd>
              </div>
              <div className="flex justify-between">
                <span>Close Panel / Dialog</span>
                <kbd className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 font-mono">
                  Esc
                </kbd>
              </div>
              <div className="pt-2 border-t border-[var(--pw-border)] flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowShortcutsModal(false);
                    setShowUserSettings(true);
                  }}
                  className="text-xs font-medium text-[var(--pw-accent)] hover:underline"
                >
                  Customize Shortcuts...
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {user && (
        <>
          <CommandPalette
            open={paletteOpen}
            initialQuery={paletteInitialQuery}
            onOpenChange={(nextOpen) => {
              setPaletteOpen(nextOpen);
              if (!nextOpen) setPaletteInitialQuery("");
            }}
            helpMode={paletteHelpMode}
            onHelpModeChange={setPaletteHelpMode}
            user={user}
            userRole={
              (boardData?.role || activeOrg?.orgRole || "viewer") as
              | "admin"
              | "lead"
              | "member"
              | "viewer"
            }
            orgId={activeOrgId || undefined}
            teamId={activeTeamId || undefined}
            boardId={activeBoardId || undefined}
            ticketId={selectedTicketId || undefined}
            boards={
              activeOrg?.teams.flatMap((t) =>
                t.projects.flatMap((p) =>
                  p.boards.map((b) => ({
                    id: b.id,
                    name: b.name,
                    projectKey: p.key,
                    projectName: p.name,
                    teamId: t.id,
                    teamName: t.name,
                  }))
                )
              ) || []
            }
            columns={boardData?.columns || []}
            tickets={boardData?.tickets || []}
            members={boardData?.members || []}
            shortcuts={shortcuts}
            apiFetch={apiFetch}
            onSelectTicket={(targetBoardId, targetTicketId) => {
              setActiveBoardId(targetBoardId);
              setSelectedTicketId(targetTicketId);
            }}
            onSelectBoard={(targetBoardId) => {
              setActiveBoardId(targetBoardId);
            }}
            onSetViewMode={(mode) => setBoardViewMode(mode)}
            onSetBoardFilter={(f) => setBoardFilters(f)}
            onToggleSidebar={() => setSidebarOpen((p) => !p)}
            onSetTheme={(mode) => {
              if (mode === "toggle") {
                toggleTheme();
              } else {
                const next = mode === "dark";
                setDarkMode(next);
                if (next) {
                  document.documentElement.classList.add("dark");
                  localStorage.setItem("patchwork_theme", "dark");
                } else {
                  document.documentElement.classList.remove("dark");
                  localStorage.setItem("patchwork_theme", "light");
                }
              }
            }}
            onOpenMembers={() => {
              if (activeTeamId) {
                void loadTeamMembers(activeTeamId);
                setShowTeamMembersModal(true);
              }
            }}
            onOpenSettings={() => setShowUserSettings(true)}
            onOpenSystem={() => router.push("/dashboard/system")}
            onLogout={() => void handleLogout()}
            onRefreshBoard={async () => {
              if (activeBoardId) {
                await loadBoard(activeBoardId);
              }
            }}
            currentTheme={darkMode ? "dark" : "light"}
            onShowSnackbar={showSnackbar}
          />

          <AppSnackbar snackbar={snackbar} onDismiss={() => setSnackbar(null)} />

          <UserSettingsModal
            open={showUserSettings}
            onClose={() => setShowUserSettings(false)}
            user={user}
            darkMode={darkMode}
            onToggleTheme={toggleTheme}
            shortcuts={shortcuts}
            onUpdateShortcut={handleUpdateShortcut}
            onResetShortcuts={handleResetShortcuts}
          />
        </>
      )}
    </div>
  );
}
