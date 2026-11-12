# Cloud Logs Setup Guide

This guide details the step-by-step process for configuring Google Cloud (Google Drive API & Service Account) and GitHub OAuth to integrate with the Cloud Logs service.

---

## Prerequisites
- A **Google Workspace** organization account (`hyperloopupv.com`) with access to Google Cloud Console and Google Drive.
- A **GitHub** organization account (`Hyperloop-UPV`) with permissions to create OAuth Applications.
- A deployment server or VPS running Docker, Docker Compose, and Nginx (Contabo).

---

## 1. Google Cloud Project & Service Account Setup

### 1.1. Create a Google Cloud Project
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com).
2. Click the project dropdown in the top navigation bar and select **New Project**.
3. Fill in the project details:
   - **Project Name**: e.g., `Cloud Logs`
   - **Organization**: `hyperloopupv.com`
   - **Location / Parent Resource**: `hyperloopupv.com`
4. Click **Create**.

### 1.2. Enable the Google Drive API
1. Using the search bar at the top, search for **Google Drive API**.
2. Select it from the Marketplace / API Library results and click **Enable**.

### 1.3. Create Service Account & Download Credentials
1. In the navigation menu, go to **IAM & Admin** > **Service Accounts**.
2. Click **Create Service Account**:
   - **Service account name**: e.g., `Cloud Logs`
   - **Service account ID**: e.g., `cloud-logs-sa`
   - **Description**: Service account for telemetry logs upload and management.
3. Click **Create and Continue**.
4. *(Optional)* Project-level roles are not required, as permissions will be granted directly on the target Google Drive folder. Click **Done**.
5. Copy the generated service account email address (e.g., `cloud-logs-sa@cloud-logs.iam.gserviceaccount.com`).
6. Click on the newly created service account email to open its details page.
7. Go to the **Keys** tab:
   - Click **Add Key** > **Create new key**.
   - Select **JSON** as the key type and click **Create**.
8. Save the downloaded JSON key file securely on your server (e.g., under `backend/credentials/service_account.json`).
   > **Security Note**: Never commit service account JSON files to git (`.gitignore` protects `credentials/*.json` and `service_account*.json`). For CI/CD and production container deployments, this JSON is stored directly as the `GDRIVE_SERVICE_ACCOUNT_JSON` GitHub secret (see [Section 5](#5-github-actions-cicd--secrets-configuration)).
9. Update your `.env` file with the path:
   ```env
   GDRIVE_SERVICE_ACCOUNT_PATH=/app/credentials/service_account.json
   # Or directly provide the JSON string:
   # GDRIVE_SERVICE_ACCOUNT_JSON={"type": "service_account", ...}
   ```

---

## 2. Google Drive Storage Configuration

### 2.1. Prepare Shared Drive & Root Folder
1. Open [Google Drive](https://drive.google.com) using your organization account.
2. Under **Shared drives**, select an existing drive or create a new one.
3. Inside the Shared Drive, create a dedicated root folder for logs (e.g., `Telemetry_Logs`).

### 2.2. Grant Access to the Service Account
1. Right-click the newly created folder (or the Shared Drive root) and select **Share** (or **Manage members**).
2. Paste the service account email copied in step 1.3.
3. Assign the **Content Manager** role (enabling it to create monthly subfolders and write files).
4. Uncheck **Notify people** (service accounts cannot receive notification emails).
5. Click **Share** / **Send**.

### 2.3. Extract the Root Folder ID
1. Open the created root folder in your browser.
2. In the browser's address bar, copy the folder ID from the URL:
   ```
   https://drive.google.com/drive/folders/162-qb6nxKfuwwmu0kHVyjHQ2qW05ql1N
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   ```
3. Set this value in your `.env` file:
   ```env
   GDRIVE_ROOT_FOLDER_ID=162-qb6nxKfuwwmu0kHVyjHQ2qW05ql1N
   ```

---

## 3. GitHub OAuth Application Setup

GitHub OAuth provides Single Sign-On (SSO) and verifies that users belong to the `Hyperloop-UPV` GitHub organization.

### 3.1. Create OAuth App in GitHub Organization
1. Go to your organization's settings on GitHub (Settings > Developer Settings > OAuth Apps):
2. Click **New OAuth App** (or **Register an application**):
   - **Application name**: `Cloud Logs`
   - **Homepage URL**: `https://cloud-logs.hyperloopupv.com` (or `http://localhost:8000` for local dev)
   - **Application description**: Telemetry and log catalog service for Hyperloop UPV.
   - **Authorization callback URL**:
     `https://cloud-logs.hyperloopupv.com/api/v1/auth/github/callback`
     *(or `http://localhost:8000/api/v1/auth/github/callback` for local dev)*
3. Click **Register application**.

### 3.2. Generate Client Secret & Configure Environment
1. On the application details page, copy the **Client ID**.
2. Under **Client secrets**, click **Generate a new client secret** and copy the value immediately.
3. Update your `.env` file:
   ```env
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   GITHUB_REDIRECT_URI=https://cloud-logs.hyperloopupv.com/api/v1/auth/github/callback
   GITHUB_ORG_NAME=Hyperloop-UPV
   ```
---

## 4. Verification & Deployment

1. **Verify Environment Variables (`.env`)**:
   Ensure all critical keys are populated:
   ```env
   ENVIRONMENT=production
   DATABASE_URL=sqlite+aiosqlite:////app/data/cloud_logs.db
   MASTER_API_KEY=your_secure_master_token
   JWT_SECRET=your_secure_jwt_secret_32_bytes
   GDRIVE_ROOT_FOLDER_ID=your_folder_id
   GDRIVE_SERVICE_ACCOUNT_PATH=credentials/service_account.json
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   GITHUB_REDIRECT_URI=https://cloud-logs.hyperloopupv.com/api/v1/auth/github/callback
   GITHUB_ORG_NAME=Hyperloop-UPV
   ```

2. **Start Containers with Docker Compose**:
   ```bash
   docker compose up -d --build
   ```

3. **Check Service Health**:
   ```bash
   curl -i http://localhost:8000/health
   ```
   A healthy response returns `200 OK`:
   ```json
   {
     "status": "healthy",
     "environment": "production",
     "components": {
       "database": "connected"
     }
   }
   ```

---

## 5. GitHub Actions CI/CD & Secrets Configuration

Continuous Integration and Automated Deployment workflows are configured under `.github/workflows/`:
- **`ci.yml`**: Triggers on push to `main` and on pull requests:
  - **`backend`**: Sets up Python 3.13, caches pip dependencies, runs `ruff check .` linter, and runs `pytest -v`.
  - **`frontend`**: Sets up Node.js 22, caches npm packages, runs `npm ci`, and runs `npm run check` (Prettier, Oxlint, Vitest, Vite build).
- **`deploy.yml`**: Triggers on push to `main` (and manual `workflow_dispatch`):
  - When `SSH_HOST` is configured, connects to remote VPS via SSH, pulls `main`, generates `service_account.json` (Opción A) and `.env`, and runs `docker compose up -d --build`.
  - Zero magic, linear and directly debuggable.

### 5.1. Required GitHub Repository Secrets

Configure the following secrets in GitHub under **Repository Settings > Secrets and variables > Actions > New repository secret**:

| Secret Name | Required | Description | Example / Value |
|---|---|---|---|
| `GDRIVE_ROOT_FOLDER_ID` | **Yes** | Root Google Drive folder ID for telemetry archives (Section 2.3) | `162-qb6nxKfuwwmu0kHVyjHQ2qW05ql1N` |
| `GDRIVE_SERVICE_ACCOUNT_JSON` | **Yes** | Full raw JSON content of the Google Cloud Service Account key | `{"type": "service_account", ...}` |
| `JWT_SECRET` | **Yes** | High-entropy key (>=32 chars) for signing authentication JWT tokens | Generate with `openssl rand -hex 32` |
| `MASTER_API_KEY` | **Yes** | High-entropy secret for Control Station telemetry uploads & cron cleanup | Generate with `openssl rand -hex 32` |
| `_GITHUB_CLIENT_ID` | **Yes** | GitHub OAuth Application Client ID (from Section 3) | e.g. `Ov23li98XyZ1...` |
| `_GITHUB_CLIENT_SECRET` | **Yes** | GitHub OAuth Application Client Secret (from Section 3) | e.g. `4f3a9e1b2c...` |
| `SSH_HOST` | Optional | Deployment VPS IP address or hostname (e.g. Contabo VPS) | `194.164.x.x` |
| `SSH_USER` | Optional | SSH username for deployment login (defaults to `root`) | `root` or `deploy` |
| `SSH_KEY` | Optional | Private SSH key matching the server's `~/.ssh/authorized_keys` | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `SSH_PORT` | Optional | SSH port on remote host (defaults to `22`) | `22` |
| `DEPLOY_PATH` | Optional | Absolute deployment directory on remote host | `/opt/cloud-logs` |

---

### 5.2. Why `_GITHUB_CLIENT_ID` and `_GITHUB_CLIENT_SECRET` Have a Leading Underscore

GitHub Actions enforces a strict platform naming rule:
> **"Secret names must not start with the `GITHUB_` prefix, which is reserved for GitHub Actions internal use."**

If you try to create a secret named `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET`, the GitHub settings UI will reject it with an error.

To resolve this limitation without friction:
1. **Repository Secret Naming**: Name the secrets with a leading underscore: `_GITHUB_CLIENT_ID` and `_GITHUB_CLIENT_SECRET`.
2. **Transparent Application Aliasing**: In `backend/app/config.py`, settings fields are configured with Pydantic `AliasChoices`:
   ```python
   github_client_id: str = Field(
       default="",
       validation_alias=AliasChoices(
           "GITHUB_CLIENT_ID",
           "_GITHUB_CLIENT_ID",
           "github_client_id",
           "_github_client_id",
       ),
   )
   github_client_secret: str = Field(
       default="",
       validation_alias=AliasChoices(
           "GITHUB_CLIENT_SECRET",
           "_GITHUB_CLIENT_SECRET",
           "github_client_secret",
           "_github_client_secret",
       ),
   )
   ```
   This allows FastAPI to seamlessly recognize either name without requiring hardcoded conversions.
3. **Automated Deployment Mapping**: The `deploy.yml` workflow writes both `GITHUB_CLIENT_ID` and `_GITHUB_CLIENT_ID` to `.env` and `docker-compose.yml`, guaranteeing compatibility with all tooling.

---

### 5.3. Managing Google Cloud Service Account Without Committing JSON Files

Committing private key JSON files to git repositories poses an extreme security hazard. The `.gitignore` configuration prevents `credentials/*.json` and `service_account*.json` from ever being staged or committed.

Cloud Logs provides two complementary, zero-commit approaches for supplying Google Drive service account credentials via the `GDRIVE_SERVICE_ACCOUNT_JSON` secret:

#### Opción A: Deployment File Generation (Recommended & Default for Docker Compose)
During workflow execution in `.github/workflows/deploy.yml`, the secret is written directly to the filesystem on the deployment host:
```bash
printf '%s\n' "$GDRIVE_SERVICE_ACCOUNT_JSON" > backend/credentials/service_account.json
chmod 600 backend/credentials/service_account.json
```
- Docker Compose mounts `./backend/credentials` into the container as a read-only volume (`/app/credentials:ro`).
- Inside the container, the application reads the file path configured in `GDRIVE_SERVICE_ACCOUNT_PATH=/app/credentials/service_account.json`.
- The credentials file exists strictly on the server filesystem with restricted permissions (`600`) and is never tracked by git.

#### Opción B: Direct In-Memory JSON String Injection
The backend (`backend/app/core/gdrive.py`) natively supports receiving the credentials directly via the `GDRIVE_SERVICE_ACCOUNT_JSON` environment variable:
```python
if self.service_account_json:
    sa_info = json.loads(self.service_account_json)
else:
    sa_info = json.loads(Path(self.service_account_path).read_text(encoding="utf-8"))
```
- If `GDRIVE_SERVICE_ACCOUNT_JSON` is passed into `.env` or container environment, `GoogleDriveService` deserializes the JSON string directly in memory upon startup.
- No credential files need to be written to disk.
- Both Opción A and Opción B work simultaneously and keep all credentials out of source control.

