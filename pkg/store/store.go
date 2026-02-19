package store

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/mattn/go-sqlite3"
)

func InitDb() (*sql.DB, error) {
	dbPath := os.Getenv("DATABASE_PATH")
	if dbPath == "" {
		dbPath = "./cloud-logs.db"
	}

	db, err := NewSQLiteDB(dbPath)
	if err != nil {
		return nil, err
	}

	if err := InitSchema(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func NewSQLiteDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	return db, nil
}

func InitSchema(db *sql.DB) error {
	const q = `
	CREATE TABLE IF NOT EXISTS logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message TEXT NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);`
	_, err := db.Exec(q)
	if err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	return nil
}

func SaveLogMessage(db *sql.DB, message string) error {
	_, err := db.Exec(`INSERT INTO logs(message) VALUES(?)`, message)
	if err != nil {
		return fmt.Errorf("save log message: %w", err)
	}
	return nil
}