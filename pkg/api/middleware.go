package api

import (
	"net/http"
	"strings"

	"github.com/Hyperloop-UPV/cloud-logs/pkg/auth"
	"github.com/gin-gonic/gin"
)

func AuthMiddleware(jwtSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if h == "" || !strings.HasPrefix(h, "Bearer ") {
			WriteJSON(c, http.StatusUnauthorized, gin.H{
				"error": "missing bearer token",
			})
			c.Abort()
			return
		}

		token := strings.TrimPrefix(h, "Bearer ")
		if err := auth.ValidateToken(token, jwtSecret); err != nil {
			WriteJSON(c, http.StatusUnauthorized, gin.H{
				"error": "invalid token",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}