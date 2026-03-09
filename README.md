# cloud-logs

## Summary
Light Go + Gin backend that:
- authenticates via unique password hash
- lists uploaded archives
- uploads compressed log archives
- downloads compressed log archives by id

Storage is SQLite.

## Steps

### 1) Env
Create `.env` in project root:

```env
AUTH_PASSWORD_HASH='$2a$10$REPLACE_WITH_BCRYPT_HASH'
JWT_SECRET='replace-with-a-strong-secret'
JWT_TTL_SECONDS=3600
```

Notes:
- `AUTH_PASSWORD_HASH` must be bcrypt hash (not plain text).

### 2) Run local

```bash
go run .
```

Server: `http://127.0.0.1:8080`

### 3) Docker

```bash
docker build -t cloud-logs:latest .
docker compose up -d
```

Stop:

```bash
docker compose down
```

## API paths
Base URL: `http://<host>:8080`

### POST `/auth/login`
Body:

```json
{"password":"test"}
```

Example:

```bash
curl -i -X POST http://127.0.0.1:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"test"}'
```

Tip to store token:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"test"}' | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
```

### POST `/logs/upload`
Multipart upload, field name: `file`.

Example:

```bash
curl -i -X POST http://127.0.0.1:8080/logs/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@logs.zip"
```

### GET `/logs/list`
Returns metadata list (`id`, `filename`, `content_type`, `size_bytes`).

Example:

```bash
curl -i http://127.0.0.1:8080/logs/list \
  -H "Authorization: Bearer $TOKEN"
```

### GET `/logs/download/:id`
Downloads archive binary by id.

Example:

```bash
curl -OJ http://127.0.0.1:8080/logs/download/1 \
  -H "Authorization: Bearer $TOKEN"
```