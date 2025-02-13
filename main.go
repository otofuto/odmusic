package main

import (
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()
	mux.Handle("/", http.StripPrefix("/", http.FileServer(http.Dir("./static"))))
	log.Println("Serve :80")
	if err := http.ListenAndServe(":80", mux); err != nil {
		panic(err)
	}
}
