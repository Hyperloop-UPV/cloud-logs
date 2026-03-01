package api

import (
	"database/sql"
	"io"
	"net/http"
	"time"

	"github.com/Hyperloop-UPV/cloud-logs/pkg/auth"
	"github.com/Hyperloop-UPV/cloud-logs/pkg/store"
	"github.com/gin-gonic/gin"
)

type Handler struct{
	db *sql.DB
	passwordHash string

	jwtSecret string
	jwtTTL    time.Duration
}

type LoginRequest struct {
	Password string `json:"password" binding:"required"`
}

type SaveLogRequest struct {
	Message string `json:"message" binding:"required"`
}

type SaveDataLogRequest struct {
	Measurement       string  `json:"measurement" binding:"required"`
	RelativeTimestamp int64   `json:"relative_timestamp" binding:"required"`
	From              string  `json:"from" binding:"required"`
	To                string  `json:"to" binding:"required"`
	Value             float64 `json:"value" binding:"required"`
}

type SaveOrderLogRequest struct {
	RelativeTimestamp      int64  `json:"relative_timestamp" binding:"required"`
	From               	   string `json:"from" binding:"required"`
	To                 	   string `json:"to" binding:"required"`
	PacketID               string `json:"packet_id" binding:"required"`
	Values                 string `json:"values" binding:"required"`
	PacketTimestampRFC3339 string `json:"packet_timestamp_rfc3339" binding:"required"`
}

func NewHandler(db *sql.DB, passwordHash string, jwtSecret string, jwtTTL time.Duration) *Handler {
	return &Handler{
		db: db, 
		passwordHash: passwordHash,
		jwtSecret: jwtSecret,
		jwtTTL: jwtTTL,
	}
}

func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "password is required",
		})
		return
	}


	//fmt.Printf("login input received: %s\n", req.Password)

	if !auth.CheckPasswordHash(req.Password, h.passwordHash) {
		c.JSON(http.StatusUnauthorized, gin.H{
			"access":  false,
			"message": "invalid credentials",
		})
		return
	}

	token, expiresIn, err := auth.GenerateToken(h.jwtSecret, h.jwtTTL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access":       true,
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   expiresIn,
	})
}

func (h *Handler) UploadArchive(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "file is required",
		})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to open uploaded file",
		})
		return
	}
	defer file.Close()

	fileData, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to read uploaded file",
		})
		return
	}

	contentType := fileHeader.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	err = store.UploadArchive(h.db, fileHeader.Filename, contentType, fileHeader.Size, fileData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to save uploaded archive",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status":       "saved",
		"filename":     fileHeader.Filename,
		"size_bytes":   fileHeader.Size,
		"content_type": contentType,
	})
}

func (h *Handler) LoadDataLogs(c *gin.Context) {
	logs, err := store.GetAllDataLogs(h.db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load data logs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"count": len(logs), "logs": logs})
}

func (h *Handler) LoadOrderLogs(c *gin.Context) {
	logs, err := store.GetAllOrderLogs(h.db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load order logs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"count": len(logs), "logs": logs})
}