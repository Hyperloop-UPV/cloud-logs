package api

import (
	"database/sql"

	"github.com/gin-gonic/gin"
)

func NewRouter(db *sql.DB) *gin.Engine {
	r := gin.Default()

	h := NewHandler(db)
	r.POST("/auth/login", h.Login)

	return r
}