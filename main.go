package main

import (
	"log"
	"os"
	"strconv"

	"github.com/Hyperloop-UPV/cloud-logs/pkg/api"
	"github.com/Hyperloop-UPV/cloud-logs/pkg/store"
	"github.com/joho/godotenv"
)

func main() {
	db, err := store.InitDb()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Load configuration from environment variables
	_ = godotenv.Load()
	passwordHash := os.Getenv("AUTH_PASSWORD_HASH")
	if passwordHash == "" {
		log.Fatal("AUTH_PASSWORD_HASH is required")
	}
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
	log.Fatal("JWT_SECRET is required")
	}
	v := os.Getenv("JWT_TTL_SECONDS")
	jwtTTLSeconds, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		log.Fatal("JWT_TTL_SECONDS is required")
	}

	r := api.NewRouter(db, passwordHash, jwtSecret, jwtTTLSeconds)
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}