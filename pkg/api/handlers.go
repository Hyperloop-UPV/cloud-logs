package api

import (
	"database/sql"
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

func (h *Handler) SaveDataLog(c *gin.Context) {
	var req SaveDataLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "measurement, relative_timestamp, from, to, value are required",
		})
		return
	}

	err := store.SaveDataLog(h.db, store.DataLogRow{
		Measurement:       req.Measurement,
		RelativeTimestamp: req.RelativeTimestamp,
		From:         	   req.From,
		To:                req.To,
		Value:             req.Value,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save data log"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"status": "saved"})
}

func (h *Handler) SaveOrderLog(c *gin.Context) {
	var req SaveOrderLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_request",
			"message": "relative_timestamp, from, to, packet_id, values, packet_timestamp_rfc3339 are required",
		})
		return
	}

	err := store.SaveOrderLog(h.db, store.OrderLogRow{
		RelativeTimestamp:      req.RelativeTimestamp,
		FromNode:               req.From,
		ToNode:                 req.To,
		PacketID:               req.PacketID,
		Values:                 req.Values,
		PacketTimestampRFC3339: req.PacketTimestampRFC3339,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save order log"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"status": "saved"})
}

func (h *Handler) LoadLogs(c *gin.Context) {
	logs, err := store.GetAllLogs(h.db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"count": len(logs),
		"logs":  logs,
	})
}