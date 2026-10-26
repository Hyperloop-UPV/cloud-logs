# Cloud-Logs API (Frontend & Client Integration Guide)

All endpoints use the `/api/v1` prefix.  
Input and output JSON payloads follow **camelCase** naming conventions.  
Authenticated requests require the authorization header:  
`Authorization: Bearer <access_token>` (or `X-API-Key: <master_key>` for machine/automated systems).

---

## 1. File Upload (Two-Phase Protocol)

Telemetry binaries (e.g., ZIP archives) are **never sent directly through the API server**; they stream directly to Google Drive via pre-authenticated resumable upload sessions.

### Step 1: Request Upload Session & Register Metadata
- **Method**: `POST`
- **Path**: `/api/v1/logs/initiate`
- **When to call**: When a user selects or drops a telemetry archive in the web UI dropzone, or when a recording tool starts transfer.
- **Request Body**:
```json
{
  "fileName": "run_42_telemetry.zip",
  "fileSize": 104857600,
  "fileDate": "2026-10-23T10:00:00Z",
  "tags": ["pod", "propulsion"],
  "note": "Track run with inverter at 80% throttle",
  "clientMetadata": {
    "hostname": "pod-orin-master-01",
    "clientUser": "operator_john",
    "runUuid": "550e8400-e29b-41d4-a716-446655440000",
    "subsystem": "propulsion"
  }
}
```
> **Note on `clientMetadata`**: Flexible JSON dictionary capturing client/runtime context (local machine hostname, pod runner UUID, sensor metadata). Stored for internal audit trails and administrator-only filtering.

- **Response Payload**:
```json
{
  "id": "c8b321a0-3841-4cf1-a472-8d76a26d7f01",
  "uploadUrl": "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=...",
  "driveFolder": "2026_10",
  "status": "pending_upload"
}
```

### Step 2: Direct Binary Stream to Google Drive
The frontend or client performs a direct `PUT` with binary bytes to the `uploadUrl` obtained in Step 1:
- [Official Google Drive Resumable Upload Documentation](https://developers.google.com/workspace/drive/api/guides/manage-uploads#uploading).
- The client monitors upload progress via `xhr.upload.onprogress` or `axios` progress callbacks for UI status indicators.

### Step 3: Complete & Verify Upload
- **Method**: `POST`
- **Path**: `/api/v1/logs/{id}/complete`
- **When to call**: Immediately after the Google Drive `PUT` returns 200/201.
- **Request Body**:
```json
{
  "fileHash": "optional_client_calculated_sha256",
  "driveFileId": "optional_google_drive_file_id"
}
```
> **Note on `driveFileId`**: The `PUT` response from Google Drive includes a JSON body with `"id"`. Providing this ID allows instantaneous verification. If omitted, the server looks up the file by name within the corresponding monthly folder.
- **Response Payload**:
```json
{
  "id": "c8b321a0-3841-4cf1-a472-8d76a26d7f01",
  "status": "ready",
  "driveUrl": "https://drive.google.com/file/d/.../view",
  "driveFolder": "2026_10",
  "fileName": "run_42_telemetry.zip",
  "fileSize": 104857600,
  "message": "Upload verified and completed successfully"
}
```

### Alternative: Abort Upload
- **Method**: `POST`
- **Path**: `/api/v1/logs/{id}/abort`
- **When to call**: If the user cancels the upload in the UI or if the client detects an unrecoverable network failure.
- **Request Body**:
```json
{
  "reason": "Cancelled by user"
}
```
- **Response Payload**:
```json
{
  "id": "c8b321a0-3841-4cf1-a472-8d76a26d7f01",
  "status": "aborted",
  "message": "Upload aborted successfully",
  "abortedAt": "2026-10-24T08:30:00Z"
}
```

---

## 2. Catalog Search & Filtering

- **Method**: `GET`
- **Path**: `/api/v1/logs`
- **Optional Query Parameters**:
  - `page`: Page index (e.g., `1`, default: `1`).
  - `pageSize`: Items per page (e.g., `20`, default: `50`, max: `100`).
  - `sortBy`: Field to order by (`createdAt`, `startDate`, `endDate`, `fileName`, `fileSize`, default: `createdAt`).
  - `sortOrder`: Sort direction (`asc` or `desc`, default: `desc`).
  - `textQuery`: Substring search in filenames and notes (e.g., `propulsion`).
  - `tags`: Comma-separated list of required tags (e.g., `pod,bms`).
  - `driveFolder`: Filter by monthly folder (e.g., `2026_10`).
  - `status`: Filter by state (`ready`, `pending_upload`, `aborted`, `failed`).
  - `startDate`: Logs recorded after ISO timestamp (e.g., `2026-10-01T00:00:00Z`).
  - `endDate`: Logs recorded before ISO timestamp (e.g., `2026-10-31T23:59:59Z`).
  - `creator`: Filter by creator's username (e.g., `john_eng`).
  - `metadataQuery` *(Admin only)*: Substring search across `clientMetadata`.

**Example URL**:  
`/api/v1/logs?page=1&pageSize=20&sortBy=fileName&sortOrder=asc&tags=pod,motor&status=ready`

**Response Payload**:
```json
{
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "items": [
    {
      "id": "c8b321a0-3841-4cf1-a472-8d76a26d7f01",
      "fileName": "run_42_telemetry.zip",
      "status": "ready",
      "driveFolder": "2026_10",
      "driveFileId": "1aB2cD3e...",
      "driveUrl": "https://drive.google.com/file/d/1aB2cD3e.../view",
      "fileSize": 104857600,
      "fileHash": "a1b2c3d4...",
      "tags": ["pod", "propulsion"],
      "note": "Track run with inverter at 80% throttle",
      "clientMetadata": {
        "hostname": "pod-orin-master-01",
        "clientUser": "operator_john",
        "runUuid": "550e8400-e29b-41d4-a716-446655440000"
      },
      "startDate": "2026-10-23T10:00:00Z",
      "endDate": "2026-10-23T10:15:00Z",
      "createdBy": "a3b1c2d3-...",
      "creator": "john_eng",
      "createdAt": "2026-10-23T10:00:02Z",
      "completedAt": "2026-10-23T10:01:10Z"
    }
  ]
}
```

---

## 3. File Download Redirect

- **Method**: `GET`
- **Path**: `/api/v1/logs/{id}/download`
- **When to call**: When a user clicks "Download Log" in the dashboard.
- **Behavior**:
  - Requires valid authentication token.
  - If the log is in `ready` status, returns an **HTTP 307 Temporary Redirect** pointing directly to the Google Drive asset link.
  - The client or browser follows the redirect to download the binary.
  - If the log is still `pending_upload` or `aborted`, returns `400 Bad Request`.

---

## 4. Catalog Statistics (Dashboard Metrics)

- **Method**: `GET`
- **Path**: `/api/v1/logs/stats`
- **When to call**: For rendering overview charts, metric counters, and storage distribution on the main dashboard.
- **Response Payload**:
```json
{
  "totalLogs": 48,
  "totalBytes": 10485760000,
  "byStatus": {
    "ready": 42,
    "pending_upload": 3,
    "aborted": 2,
    "failed": 1
  },
  "byFolder": {
    "2026_10": 28,
    "2026_09": 20
  },
  "totalTags": 14,
  "topTags": [
    { "tag": "pod", "count": 35 },
    { "tag": "bms", "count": 22 },
    { "tag": "motor", "count": 18 },
    { "tag": "telemetry", "count": 15 }
  ]
}
```

---

## 5. Tag Autocompletion

- **Method**: `GET`
- **Path**: `/api/v1/logs/tags`
- **When to call**: For dynamic suggestions in tag inputs or multiselect filters.
- **Response Payload**:
```json
[
  "bms",
  "brakes",
  "inverter",
  "motor",
  "pod",
  "propulsion",
  "telemetry"
]
```

---

## 6. Log Detail View

- **Method**: `GET`
- **Path**: `/api/v1/logs/{id}`
- **Response Payload**: Full `LogOut` representation.

---

## 7. Update Metadata (Tags / Note)

- **Method**: `PATCH`
- **Path**: `/api/v1/logs/{id}`
- **When to call**: Modifying descriptive notes or modifying tags after capture.
- **Request Body**:
```json
{
  "tags": ["pod", "propulsion", "validated"],
  "note": "Validated by electrical engineering team",
  "clientMetadata": {
    "approved": true
  }
}
```
- **Response Payload**: Updated `LogOut` object.

---

## 8. Delete a Log (Soft Delete)

- **Method**: `DELETE`
- **Path**: `/api/v1/logs/{id}`
- **Response**: `204 No Content` (empty body).
- **Note**: The record is marked as soft-deleted (`deleted_at = now()`). It is excluded from all search queries, stats, and download requests.

---

## 9. Maintenance Cleanup (Admin / Master Key)

Manually inspects or purges stale uncompleted uploads. Restricted to users with the `admin` role or the Master API Key.

- **Method**: `POST`
- **Path**: `/api/v1/logs/cleanup`
- **Query Parameters**:
  - `retentionDays` *(int, optional, default: 30)*: Age threshold in days.
  - `dryRun` *(bool, optional, default: false)*: When `true`, returns affected counts without modifying database rows.
  - `purgeSoftDeleted` *(bool, optional, default: false)*: When `true`, permanently deletes logs soft-deleted > `retentionDays` ago.
- **Guarantee**: Telemetry logs in `ready` status are **NEVER deleted or modified**.
- **Response Payload**:
```json
{
  "affectedLogs": 3,
  "orphanedCleaned": 3,
  "softDeletedPurged": 0,
  "cutoffDate": "2026-09-24T10:00:00Z",
  "dryRun": false,
  "message": "Cleanup complete: 3 uncompleted logs soft-deleted."
}
```

---

## 10. User & Role Management (Admin / Master Key)

Every member registered through GitHub OAuth automatically receives the **`user`** role (uploading, listing, searching, downloading, and editing logs).  
Only users with the **`admin`** role or the **Master API Key** can promote or modify member roles.

### Current User Profile
- **Method**: `GET`
- **Path**: `/api/v1/users/me` (also available via `/api/v1/auth/me`)
- **Required Auth**: Any authenticated user (`user`, `admin`, or Master Key).
- **Response Payload**:
```json
{
  "id": "c2273ae6-239a-4dd8-a5b1-1d92b3442287",
  "username": "Manel-Romero",
  "githubUsername": "Manel-Romero",
  "role": "user",
  "createdAt": "2026-10-25T11:08:28"
}
```

### Assign User Role
- **Method**: `PATCH`
- **Path**: `/api/v1/users/{id}/role`
- **Required Auth**: `admin` or Master Key.
- **Request Body**:
```json
{
  "role": "admin"
}
```
*(Permitted values for `role`: `"admin"` or `"user"`)*

- **Response Payload**:
```json
{
  "id": "e0b4a1c2-3d4e-5f6a-7b8c-9d0e1f2a3b4c",
  "username": "alice",
  "githubUsername": "alice_upv",
  "role": "admin",
  "createdAt": "2026-10-24T10:00:00Z"
}
```

### List Registered Users
- **Method**: `GET`
- **Path**: `/api/v1/users`
- **Required Auth**: `admin` or Master Key.
- **Response Payload**: Array of user profile objects with their current `role`.

---

## 11. Common HTTP Status Codes

- `200 OK`: Request succeeded.
- `204 No Content`: Resource deleted successfully.
- `307 Temporary Redirect`: Direct file download redirect to Google Drive.
- `400 Bad Request`: Invalid parameters, CSRF verification failure, or attempt to abort a completed upload.
- `401 Unauthorized`: Token missing, expired, or invalid.
- `403 Forbidden`: Insufficient permissions (e.g., standard `user` attempting role updates, `metadataQuery`, or `cleanup`).
- `404 Not Found`: Target UUID does not exist or has been soft-deleted.
- `422 Unprocessable Content`: Schema validation error for submitted request body or parameters.
