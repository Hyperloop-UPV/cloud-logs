/** Tipos del API Cloud Logs. Espejo de app/schemas/*.py (el backend serializa en camelCase). */

export type Role = "user" | "admin";
export type LogStatus = "pending_upload" | "ready" | "aborted" | "failed";

export interface User {
  id: string;
  username: string;
  githubUsername: string | null;
  role: Role;
  createdAt: string | null;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string | null;
  user: User | null;
}

export interface GitHubAuthUrl {
  authorizationUrl: string;
}

export interface Log {
  id: string;
  fileName: string;
  status: LogStatus;
  driveFolder: string | null;
  driveFileId: string | null;
  driveUrl: string | null;
  fileSize: number | null;
  fileHash: string | null;
  tags: string[];
  note: string | null;
  clientMetadata: Record<string, unknown>;
  fileDate: string | null;
  startDate: string | null;
  endDate: string | null;
  createdBy: string | null;
  creator: string;
  createdAt: string;
  completedAt: string | null;
  /** Duración en segundos calculada automáticamente por el backend. */
  duration?: number | null;
}

export interface LogPage {
  total: number;
  page: number;
  pageSize: number;
  items: Log[];
}

export type SortBy =
  "createdAt" | "fileDate" | "startDate" | "endDate" | "fileName" | "fileSize";
export type SortOrder = "asc" | "desc";

/** Filtros de GET /logs. startDate/endDate filtran logs cuyo intervalo solapa la ventana. */
export interface LogQuery {
  page?: number;
  pageSize?: number;
  textQuery?: string;
  tags?: string[];
  driveFolder?: string;
  status?: LogStatus;
  startDate?: string;
  endDate?: string;
  creator?: string;
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  /** Búsqueda textual sobre campos de clientMetadata (disponible para todos los miembros autenticados). */
  metadataQuery?: string;
}

export interface LogInitiateRequest {
  fileName: string;
  fileSize: number;
  fileDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  fileHash?: string | null;
  tags?: string[];
  note?: string | null;
  clientMetadata?: Record<string, unknown>;
}

export interface LogInitiateResponse {
  id: string;
  uploadUrl: string;
  driveFolder: string;
  status: LogStatus;
  expiresInSeconds: number | null;
}

export interface LogCompleteResponse {
  id: string;
  status: LogStatus;
  driveUrl: string;
  driveFolder: string | null;
  fileName: string;
  fileSize: number | null;
  message: string;
}

export interface LogAbortResponse {
  id: string;
  status: LogStatus;
  message: string;
  abortedAt: string;
}

export interface LogUpdateRequest {
  tags?: string[];
  note?: string | null;
  clientMetadata?: Record<string, unknown>;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface MonthlyUploadStats {
  month: string;
  count: number;
  totalBytes: number;
}

export interface TagCoOccurrence {
  tag: string;
  count: number;
}

export interface TagDetailOut {
  tag: string;
  logs: number;
  totalSize: number;
  averageSize: number;
  statusMix: Record<string, number>;
  firstUsed: string | null;
  lastUsed: string | null;
  usedWith: TagCoOccurrence[];
}

export interface TagsStatsResponse {
  totalTags: number;
  totalSize: number;
  tags: TagDetailOut[];
}

export interface LogStats {
  totalLogs: number;
  totalBytes: number;
  byStatus: Record<string, number>;
  byFolder: Record<string, number>;
  totalTags: number;
  topTags: TagCount[];
  needsAttention?: number;
  uploadsPerMonth?: MonthlyUploadStats[];
  recentUploads?: Log[];
  tagDetails?: TagDetailOut[];
}

export interface CleanupResult {
  affectedLogs: number;
  orphanedCleaned: number;
  softDeletedPurged: number;
  tokensCleaned: number;
  cutoffDate: string;
  dryRun: boolean;
  message: string;
}

export interface Health {
  status: "healthy" | "degraded";
  environment: string;
  components: { database: string };
  timestamp: string;
}
