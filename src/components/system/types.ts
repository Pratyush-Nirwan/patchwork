export type SystemConfigSection =
  | "users"
  | "organization"
  | "teams-projects-boards"
  | "roles-permissions"
  | "security"
  | "storage"
  | "search"
  | "integrations"
  | "appearance"
  | "health"
  | "data-backup"
  | "danger-zone";

export interface TeamHierarchyItem {
  id: string;
  name: string;
  slug: string;
  leads?: Array<{ id: string; name: string }>;
  projects?: Array<{
    id: string;
    key: string;
    name: string;
    teamId: string;
    boards?: Array<{
      id: string;
      name: string;
      type: string;
      columns?: Array<{ id: string; name: string; position: number }>;
    }>;
  }>;
  dependencies?: {
    projectsCount: number;
    boardsCount: number;
    ticketsCount: number;
  };
}

export interface StorageHealthData {
  minio: {
    status: "healthy" | "unhealthy";
    bucket: string;
    latencyMs: number;
  };
  storageUsedBytes: number;
  totalAttachmentsCount: number;
}

export interface StorageOrphanItem {
  key: string;
  sizeBytes: number;
  lastModified?: string;
}

export interface SearchStatusData {
  indexedTickets: number;
  indexedComments: number;
  indexedAttachments: number;
  isRebuilding: boolean;
}

export interface ServerErrorLog {
  timestamp: string;
  message: string;
  stack?: string;
  path?: string;
}

export interface SystemDiagnostics {
  appVersion: string;
  nodeVersion: string;
  platform: string;
  serverUptimeSec: number;
  sseConnectionCount: number;
  database: {
    status: "healthy" | "unhealthy";
    latencyMs: number;
    appliedMigrations: number;
    pendingMigrations: number;
  };
  minio: {
    status: "healthy" | "unhealthy";
    bucket: string;
    latencyMs: number;
  };
  recentErrors: ServerErrorLog[];
  generatedAt: string;
}

export interface BackupCommands {
  pgDumpCommand: string;
  minioBucket: string;
  minioDataPath: string;
}

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

export interface UserItem {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "deactivated";
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  teams: Array<{ id: string; name: string; role: string; subRole?: string | null }>;
}
