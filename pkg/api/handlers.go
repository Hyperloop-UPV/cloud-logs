package api

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"

	"github.com/Hyperloop-UPV/cloud-logs/pkg/store"
	"github.com/gin-gonic/gin"
)

type Handler struct{
	db *sql.DB
}

func NewHandler(db *sql.DB) *Handler {
	return &Handler{db: db}
}

func (h *Handler) Login(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	fmt.Printf("login input received: %s\n", string(body))

	if err := store.SaveLoginInput(h.db, string(body)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save login input"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}