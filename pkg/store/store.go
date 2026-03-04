package store

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/mattn/go-sqlite3"
)

type UploadedArchive struct {
	ID          int64  `json:"id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
	FileData    []byte `json:"-"`
}

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
	CREATE TABLE IF NOT EXISTS uploaded_archives (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filename TEXT NOT NULL,
		content_type TEXT NOT NULL,
		size_bytes INTEGER NOT NULL,
		file_data BLOB NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);`
	_, err := db.Exec(q)
	if err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	return nil
}

func ListUploadedArchives(db *sql.DB) ([]UploadedArchive, error) {
	rows, err := db.Query(`
		SELECT id, filename, content_type, size_bytes
		FROM uploaded_archives
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to list uploaded archives: %w", err)
	}

	archives := []UploadedArchive{}

	for rows.Next() {
		var archive UploadedArchive

		err := rows.Scan(&archive.ID, &archive.Filename, &archive.ContentType, &archive.SizeBytes)

		if err != nil {
			return nil, fmt.Errorf("failed to scan uploaded archive: %w", err)
		}

		archives = append(archives, archive)
	}
	rows.Close()

	return archives, nil
}

func UploadArchive(db *sql.DB, filename, contentType string, sizeBytes int64, fileData []byte) (int64, error) {
	result, err := db.Exec(`
		INSERT INTO uploaded_archives(filename, content_type, size_bytes, file_data)
		VALUES(?, ?, ?, ?)
	`, filename, contentType, sizeBytes, fileData)

	if err != nil {
		// Return id 0 as invalid db index
		return 0, fmt.Errorf("failed to save archive %s to database: %w", filename, err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		// Return id 0 as invalid db index
		return 0, fmt.Errorf("error getting last insert id: %w", err)
	}

	return id, nil
}

func GetArchiveByID(db *sql.DB, id int64) (*UploadedArchive, error) {
	row := db.QueryRow(`
		SELECT id, filename, content_type, size_bytes, file_data
		FROM uploaded_archives
		WHERE id = ?
	`, id)

	var archive UploadedArchive
	if err := row.Scan(
		&archive.ID,
		&archive.Filename,
		&archive.ContentType,
		&archive.SizeBytes,
		&archive.FileData,
	); err != nil {
		return nil, err
	}

	return &archive, nil
}
