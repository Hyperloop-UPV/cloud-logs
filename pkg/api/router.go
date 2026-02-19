package api

import (
	"database/sql"

	"github.com/gin-gonic/gin"
)

func NewRouter(db *sql.DB, passwordHash string) *gin.Engine {
	r := gin.Default()

	h := NewHandler(db, passwordHash)
	r.POST("/auth/login", h.Login)

	return r
}