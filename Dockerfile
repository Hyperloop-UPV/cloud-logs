# Production Dockerfile for Cloud-Logs API
FROM python:3.13-slim

# Optimize Python execution in containers
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000 \
    DATABASE_URL=sqlite+aiosqlite:////app/data/cloud_logs.db

# Install curl for container health checks
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Set up application directory and unprivileged system user
WORKDIR /app

RUN groupadd -g 1000 logsuser && \
    useradd -u 1000 -g logsuser -s /usr/sbin/nologin -M logsuser && \
    mkdir -p /app/data /app/credentials && \
    chown -R logsuser:logsuser /app

# Install dependencies first for Docker layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY --chown=logsuser:logsuser app/ ./app/

# Switch to non-root user
USER logsuser

# Expose HTTP port
EXPOSE 8000

# Container healthcheck against /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Start Uvicorn ASGI server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
