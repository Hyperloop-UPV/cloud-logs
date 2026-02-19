package main

import (
	"log"
	"os"

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

	_ = godotenv.Load()
	passwordHash := os.Getenv("AUTH_PASSWORD_HASH")
	if passwordHash == "" {
		log.Fatal("AUTH_PASSWORD_HASH is required")
	}

	r := api.NewRouter(db, passwordHash)
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}