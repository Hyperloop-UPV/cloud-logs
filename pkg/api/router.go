package api

import (
	"database/sql"
	"time"

	"github.com/gin-gonic/gin"
)

func NewRouter(db *sql.DB, passwordHash string, jwtSecret string, jwtTTL int64) *gin.Engine {
	r := gin.Default()

	h := NewHandler(db, passwordHash, jwtSecret, time.Duration(jwtTTL)*time.Second)
	r.POST("/auth/login", h.Login)

	logs := r.Group("/logs")
	// TDO: uncomment when logs saving and loading is implemented
	//logs.Use(AuthMiddleware(jwtSecret))
	logs.GET("/", h.ListUploadedArchives)
	logs.GET("/download/:id", h.DownloadLogsArchive)
	logs.POST("/upload", h.UploadArchive)

	return r
}
