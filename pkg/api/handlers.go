package api

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
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

func NewHandler(db *sql.DB, passwordHash string, jwtSecret string, jwtTTL time.Duration) *Handler {
	return &Handler{
		db: db, 
		passwordHash: passwordHash,
		jwtSecret: jwtSecret,
		jwtTTL: jwtTTL,
	}
}

func writeJSON(c *gin.Context, status int, payload any) {
	b, err := json.Marshal(payload)
	if err != nil {
		c.Data(http.StatusInternalServerError, "application/json; charset=utf-8", []byte(`{"error":"marshal_failed"}`+"\n"))
		return
	}
	c.Data(status, "application/json; charset=utf-8", append(b, '\n'))
}

func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		writeJSON(c, http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "password is required",
		})
		return
	}


	//fmt.Printf("login input received: %s\n", req.Password)

	if !auth.CheckPasswordHash(req.Password, h.passwordHash) {
		writeJSON(c, http.StatusUnauthorized, gin.H{
			"access":  false,
			"message": "invalid credentials",
		})
		return
	}

	token, expiresIn, err := auth.GenerateToken(h.jwtSecret, h.jwtTTL)
	if err != nil {
		writeJSON(c, http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	writeJSON(c, http.StatusOK, gin.H{
		"access":       true,
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   expiresIn,
	})
}

func (h *Handler) UploadLog(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		writeJSON(c, http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "file is required",
		})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		writeJSON(c, http.StatusInternalServerError, gin.H{
			"error": "failed to open uploaded file",
		})
		return
	}
	defer file.Close()

	fileData, err := io.ReadAll(file)
	if err != nil {
		writeJSON(c, http.StatusInternalServerError, gin.H{
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
		writeJSON(c, http.StatusInternalServerError, gin.H{
			"error": "failed to save uploaded archive",
		})
		return
	}

	writeJSON(c, http.StatusCreated, gin.H{
		"status":       "saved",
		"filename":     fileHeader.Filename,
		"size_bytes":   fileHeader.Size,
		"content_type": contentType,
	})
}

func (h *Handler) DownloadLogByID(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.ParseInt(idParam, 10, 64)
	if err != nil || id <= 0 {
		writeJSON(c, http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "invalid archive id",
		})
		return
	}

	archive, err := store.GetArchiveByID(h.db, id)
	if err != nil {
		if err == sql.ErrNoRows {
			writeJSON(c, http.StatusNotFound, gin.H{
				"error":   "not_found",
				"message": "archive not found",
			})
			return
		}

		writeJSON(c, http.StatusInternalServerError, gin.H{
			"error": "failed to load archive",
		})
		return
	}

	c.Header("Content-Type", archive.ContentType)
	c.Header("Content-Disposition", `attachment; filename="`+archive.Filename+`"`)
	c.Data(http.StatusOK, archive.ContentType, archive.FileData)
}

func (h *Handler) ListLogs(c *gin.Context) {
	logs, err := store.ListUploadedArchives(h.db)
	if err != nil {
		writeJSON(c, http.StatusInternalServerError, gin.H{"error": "failed to list downloadable logs"})
		return
	}

	writeJSON(c, http.StatusOK, gin.H{
		"count": len(logs),
		"logs":  logs,
	})
}