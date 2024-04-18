package main

import (
	"log"
	"net/http"
	"time"
)


func main() {

	mux := http.NewServeMux()

	// home page
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "index.html")
	})

	// create web server
	server := &http.Server{
		Addr:           ":3000",
		Handler:        mux,
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   30 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}

	// enable logging
	log.Fatal(server.ListenAndServe())

}


