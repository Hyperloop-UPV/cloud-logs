package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/Hyperloop-UPV/cloud-logs/pkg/auth"
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