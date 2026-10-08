export interface AdminPermissionInfo {
  key: string;
  description: string;
  assignable?: boolean;
}

export interface AdminRoleInfo {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  accountCount: number;
  system?: boolean;
  assignable?: boolean;
}

export interface AdminRolesData {
  permissions: AdminPermissionInfo[];
  roles: AdminRoleInfo[];
}

export interface AdminSessionRow {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  status: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface AdminSessionsData {
  items: AdminSessionRow[];
}
