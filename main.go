package main

import "github.com/Hyperloop-UPV/cloud-logs/pkg/api"

func main() {
	r := api.NewRouter()
	r.Run(":8080")
}