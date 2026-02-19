package main

import (
	"log"

	"github.com/Hyperloop-UPV/cloud-logs/pkg/api"
	"github.com/Hyperloop-UPV/cloud-logs/pkg/store"
)

func main() {
	db, err := store.InitDb()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()


	r := api.NewRouter(db)
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}