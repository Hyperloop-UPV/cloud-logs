# Build stage
FROM golang:1.24-alpine AS builder
WORKDIR /app

RUN apk add --no-cache gcc musl-dev

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o cloud-logs .

# Runtime stage
FROM alpine:3.20
WORKDIR /app

RUN apk add --no-cache ca-certificates sqlite

COPY --from=builder /app/cloud-logs /app/cloud-logs

# App data dir for sqlite file persistence
RUN mkdir -p /data
ENV DATABASE_PATH=/data/cloud-logs.db

EXPOSE 8080
CMD ["/app/cloud-logs"]
