package api

import "github.com/gin-gonic/gin"

func NewRouter() *gin.Engine {
	r := gin.Default()

	h := NewHandler()
	r.POST("/auth/login", h.Login)

	return r
}