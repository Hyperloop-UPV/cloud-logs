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
8. Save the downloaded JSON key file securely on your server (e.g., under `credentials/service_account.json`).
9. Update your `.env` file with the path:
   ```env
   GDRIVE_SERVICE_ACCOUNT_PATH=credentials/service_account.json
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
