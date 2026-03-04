package api

import (
	"database/sql"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/Hyperloop-UPV/cloud-logs/pkg/auth"
	"github.com/Hyperloop-UPV/cloud-logs/pkg/store"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	db           *sql.DB
	passwordHash string

	jwtSecret string
	jwtTTL    time.Duration
}

type LoginRequest struct {
	Password string `json:"password" binding:"required"`
}

func NewHandler(db *sql.DB, passwordHash string, jwtSecret string, jwtTTL time.Duration) *Handler {
	return &Handler{
		db:           db,
		passwordHash: passwordHash,
		jwtSecret:    jwtSecret,
		jwtTTL:       jwtTTL,
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

func (h *Handler) ListUploadedArchives(c *gin.Context) {
	archives, err := store.ListUploadedArchives(h.db)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to list uploaded archives",
		})
		return
	}

	c.JSON(http.StatusOK, archives)
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

	id, err := store.UploadArchive(h.db, fileHeader.Filename, contentType, fileHeader.Size, fileData)
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
		"file_id":      id,
	})
}

func (h *Handler) DownloadLogsArchive(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.ParseInt(idParam, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "invalid archive id",
		})
		return
	}

	archive, err := store.GetArchiveByID(h.db, id)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{
				"error":   "not_found",
				"message": "archive not found",
			})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to load archive",
		})
		return
	}

	c.Header("Content-Type", archive.ContentType)
	c.Header("Content-Disposition", `attachment; filename="`+archive.Filename+`"`)
	c.Data(http.StatusOK, archive.ContentType, archive.FileData)
}
