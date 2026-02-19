package api

import (
	"database/sql"
	"net/http"

	"github.com/Hyperloop-UPV/cloud-logs/pkg/auth"
	"github.com/gin-gonic/gin"
)

type Handler struct{
	db *sql.DB
	passwordHash string
}

type LoginRequest struct {
	Password string `json:"password" binding:"required"`
}

func NewHandler(db *sql.DB, passwordHash string) *Handler {
	return &Handler{
		db: db, 
		passwordHash: passwordHash,
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

	c.JSON(http.StatusOK, gin.H{
		"access":  true,
		"message": "login successful",
	})
}