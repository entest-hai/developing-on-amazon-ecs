// https://ilya.app/blog/servemux-and-path-traversal

package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {

		// read file
		content, error := os.ReadFile("index.html")

		if error != nil {
			fmt.Println(error)
		}

		w.Write(content)
	})

	// create web server
	server := &http.Server{
		Addr:    ":3000",
		Handler: mux,
	}

	// enable logging
	log.Fatal(server.ListenAndServe())

}
